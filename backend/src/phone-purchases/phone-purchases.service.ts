import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { PhonePurchase } from './entities/phone-purchase.entity';
import { ProductUnit } from '../product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../product-units/enums/product-unit-status.enum';
import {
  isLiveImeiConflict,
  LIVE_UNIT_STATUSES,
} from '../product-units/live-imei';
import { Customer } from '../customers/entities/customer.entity';
import { Branch } from '../branches/entities/branch.entity';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { StockService } from '../stock/stock.service';
import { CreatePhonePurchaseDto } from './dto/create-phone-purchase.dto';
import { PHONE_PURCHASE_NEEDS_NIC } from './customer-nic';
import { ListPhonePurchasesQueryDto } from './dto/list-phone-purchases-query.dto';
import {
  paginate,
  PaginatedResponse,
} from '../common/dto/paginated-response.dto';

/**
 * Relations to eagerly hydrate on findOne / findAll. Includes customer,
 * branch, cashier metadata plus the associated ProductUnit (there's
 * exactly one per PhonePurchase in Slice D, but the schema allows
 * many — the plural relation is future-proof).
 */
const PHONE_PURCHASE_RELATIONS = [
  'customer',
  'branch',
  'cashier',
  'product_units',
] as const;

@Injectable()
export class PhonePurchasesService {
  constructor(
    @InjectRepository(PhonePurchase)
    private readonly phonePurchasesRepository: Repository<PhonePurchase>,
    private readonly dataSource: DataSource,
    private readonly stockService: StockService,
  ) {}

  /**
   * Create a PhonePurchase and its associated ProductUnit + Stock
   * increment, all in one atomic transaction.
   *
   * Transaction steps:
   *   1. Load cashier (need branch_id for access check)
   *   2. Branch access check (403 for cross-branch by non-admin)
   *   3. Payload reference validations (customer — with an NIC on file,
   *      P4-13 — branch, product, IMEI)
   *   4. Insert PhonePurchase row
   *   5. Insert ProductUnit row (status IN_STOCK, linked to purchase)
   *   6. Increment Stock row for (product_id, branch_id) under
   *      pessimistic lock (delegated to StockService)
   *
   * Any failure rolls back the entire transaction — no partial state.
   * Returns a fully-hydrated PhonePurchase via a fresh read after commit
   * (matches SalesService.findOne pattern — transaction-independent
   * hydration).
   */
  async create(
    dto: CreatePhonePurchaseDto,
    cashierId: string,
  ): Promise<PhonePurchase> {
    const savedId = await this.dataSource.transaction(async (manager) => {
      // 1. Load cashier record. Won't normally fail with a valid JWT
      //    but defensive against edge cases (user soft-deleted mid-session).
      const cashier = await manager.findOne(User, {
        where: { id: cashierId },
      });
      if (!cashier) {
        throw new NotFoundException('Cashier not found');
      }

      // 2. Branch access check. Matches SalesService.create pattern:
      //    cashiers/managers are pinned to their branch (branch_id set);
      //    admins have branch_id = null and can transact anywhere.
      this.assertBranchAccess(cashier.branch_id, dto.branch_id);

      // 3. Payload reference validations. Each throws the appropriate
      //    exception type; NestJS's exception filters map to HTTP status.
      const customer = await this.assertCustomerReference(
        dto.customer_id,
        manager,
      );
      // The seller's NIC must be on file (P4-13).
      if (!customer.nic) {
        throw new BadRequestException(PHONE_PURCHASE_NEEDS_NIC);
      }
      await this.assertBranchReference(dto.branch_id, manager);
      await this.assertProductReference(dto.product_id, dto.branch_id, manager);
      await this.assertImeiAvailable(dto.imei, manager);

      // 4. Create the PhonePurchase row. total_amount equals buying_price
      //    for single-unit purchases (all Slice D supports).
      const purchase = manager.create(PhonePurchase, {
        customer_id: dto.customer_id,
        branch_id: dto.branch_id,
        cashier_id: cashierId,
        total_amount: dto.buying_price.toFixed(2),
        notes: dto.notes ?? null,
      });
      const savedPurchase = await manager.save(purchase);

      // 5. Create the ProductUnit row.
      const unit = manager.create(ProductUnit, {
        product_id: dto.product_id,
        branch_id: dto.branch_id,
        imei: dto.imei,
        status: ProductUnitStatus.IN_STOCK,
        buying_price: dto.buying_price.toFixed(2),
        selling_price:
          dto.selling_price != null ? dto.selling_price.toFixed(2) : null,
        phone_purchase_id: savedPurchase.id,
      });
      await this.saveUnitOrRejectLiveImei(manager, unit);

      // 6. Increment stock. Pessimistic lock on the Stock row is
      //    inside StockService.incrementForReversal (see Phase 6.3).
      //    The method throws if the Stock row is missing — a data
      //    integrity invariant (every Product has a Stock row per
      //    Phase 6.1's ProductsService.create → createForNewProduct).
      await this.stockService.incrementForReversal(
        manager,
        dto.product_id,
        dto.branch_id,
        1,
      );

      return savedPurchase.id;
    });

    // Fresh hydrated read after commit. Same pattern as SalesService
    // for post-mutation reads.
    return this.findOne(savedId);
  }

  /**
   * Paginated list of PhonePurchases with optional customer/branch
   * filters. Sorted by created_at DESC (newest first).
   *
   * Multi-branch list scoping ("only my branch") is deferred to R9,
   * matching Sales precedent — cashiers can currently see all
   * purchases. Frontend can pass branchId explicitly when the UX
   * wants scoping.
   */
  async findAll(
    query: ListPhonePurchasesQueryDto,
  ): Promise<PaginatedResponse<PhonePurchase>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.phonePurchasesRepository
      .createQueryBuilder('purchase')
      .leftJoinAndSelect('purchase.customer', 'customer')
      .leftJoinAndSelect('purchase.branch', 'branch')
      .leftJoinAndSelect('purchase.cashier', 'cashier')
      .leftJoinAndSelect('purchase.product_units', 'product_units');

    if (query.customer_id) {
      qb.andWhere('purchase.customer_id = :customerId', {
        customerId: query.customer_id,
      });
    }
    if (query.branchId) {
      qb.andWhere('purchase.branch_id = :branchId', {
        branchId: query.branchId,
      });
    }

    qb.orderBy('purchase.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, page, limit);
  }

  /**
   * Get one PhonePurchase by ID with all relations hydrated.
   * Transaction-independent — uses the injected repository, matches
   * SalesService.findOne pattern.
   */
  async findOne(id: string): Promise<PhonePurchase> {
    const purchase = await this.phonePurchasesRepository.findOne({
      where: { id },
      relations: [...PHONE_PURCHASE_RELATIONS],
    });
    if (!purchase) {
      throw new NotFoundException('Phone purchase not found');
    }
    return purchase;
  }

  /**
   * Materialize a trade-in inside a caller's transaction: create a
   * PhonePurchase + ProductUnit (IN_STOCK) + Stock increment, atomically.
   * Enlists in the caller's EntityManager (typically
   * SalesService.completeSale) — never opens its own transaction.
   *
   * This is the payment-time sibling of create(), scoped for the
   * TRADE_IN payment lifecycle: during DRAFT the trade-in fields live
   * on the Payment row; at completeSale we materialize them via this
   * method and stamp the resulting PhonePurchase id back onto the
   * Payment (see SalesService.completeSale).
   *
   * Differences from create() and their rationale:
   *
   *   - No cashier lookup, no branch access check. The parent Sale
   *     has already been through both at addLine / addPayment /
   *     completeSale time. Re-checking here would create weird failure
   *     modes if the sale's cashier was soft-deleted between draft and
   *     complete.
   *
   *   - No customer / branch re-validation. Both come from the parent
   *     Sale, which validated them at its own creation time (Sale
   *     customer_id is only settable via the sale, branch_id is pinned
   *     at draft time). Product and IMEI ARE re-validated here — those
   *     could legitimately change (product deactivated, IMEI intook
   *     via another path) between DRAFT and complete.
   *
   *   - Takes fully-resolved input rather than a DTO. The caller has
   *     already validated the DTO at addPayment time and stored the
   *     values on the Payment row; we take them from the row.
   *     buying_price / selling_price come in as numeric-string (the
   *     entity type) rather than number, since they're read straight
   *     off the Payment row.
   *
   *   - Returns { phone_purchase, product_unit } instead of a
   *     hydrated PhonePurchase. Relations are NOT hydrated — the
   *     caller (completeSale) only needs phone_purchase.id to stamp
   *     on the Payment and product_unit's identity for potential
   *     future logging. Callers that need a hydrated view should
   *     `findOne` after their transaction commits.
   *
   * Steps:
   *   1. assertProductReference (product exists, at branch, serialized)
   *   2. assertImeiAvailable (409 + existing_unit payload on collision)
   *   3. Insert PhonePurchase row (total_amount = buying_price for
   *      single-unit purchases, same as create())
   *   4. Insert ProductUnit row (IN_STOCK, linked to purchase)
   *   5. Increment Stock via stockService.incrementForReversal (the
   *      existing dual-purpose method: intake AND void-reversal use it)
   *
   * Any throw rolls back the caller's entire transaction (per
   * TypeORM's transaction semantics). uq_product_units_imei_live is
   * the ultimate race arbiter — the pre-check in step 2 is best-effort
   * UX; a concurrent intake between step 2 and step 4 hits the index at
   * step 4, which saveUnitOrRejectLiveImei maps to a 409.
   *
   * Must be called inside a transaction; StockService.incrementForReversal
   * uses setLock which throws if the manager isn't in one.
   */
  async createForTradeIn(
    manager: EntityManager,
    input: {
      customer_id: string;
      branch_id: string;
      cashier_id: string;
      product_id: string;
      imei: string;
      buying_price: string;
      selling_price: string | null;
      notes: string | null;
    },
  ): Promise<{ phone_purchase: PhonePurchase; product_unit: ProductUnit }> {
    // 1. Product must exist, be at this branch, and be serialized.
    //    Cheap check; catches product deactivation between DRAFT and
    //    complete.
    await this.assertProductReference(
      input.product_id,
      input.branch_id,
      manager,
    );

    // 2. IMEI availability best-effort pre-check. Same helper as
    //    create(); returns the same 409 + existing_unit payload shape
    //    on collision. uq_product_units_imei_live backstops any race.
    await this.assertImeiAvailable(input.imei, manager);

    // 3. Insert PhonePurchase. total_amount = buying_price (single
    //    unit per purchase). buying_price is already a numeric string
    //    from the Payment row, so no .toFixed() reformatting needed.
    const purchase = manager.create(PhonePurchase, {
      customer_id: input.customer_id,
      branch_id: input.branch_id,
      cashier_id: input.cashier_id,
      total_amount: input.buying_price,
      notes: input.notes,
    });
    const savedPurchase = await manager.save(purchase);

    // 4. Insert ProductUnit (IN_STOCK), linked to the PhonePurchase.
    const unit = manager.create(ProductUnit, {
      product_id: input.product_id,
      branch_id: input.branch_id,
      imei: input.imei,
      status: ProductUnitStatus.IN_STOCK,
      buying_price: input.buying_price,
      selling_price: input.selling_price,
      phone_purchase_id: savedPurchase.id,
    });
    const savedUnit = await this.saveUnitOrRejectLiveImei(manager, unit);

    // 5. Increment Stock. Reuses the existing dual-purpose
    //    incrementForReversal (already used for both intake via
    //    create() and void reversal). Locks the Stock row internally.
    await this.stockService.incrementForReversal(
      manager,
      input.product_id,
      input.branch_id,
      1,
    );

    return { phone_purchase: savedPurchase, product_unit: savedUnit };
  }

  // ---- Private validation helpers ----
  //
  // Each helper throws the appropriate NestJS exception for its
  // failure mode. Called from within the create() transaction; all
  // take the transaction's EntityManager so reads see the same
  // consistent snapshot.

  /**
   * Non-admin cashiers (those with a branch_id set) can only intake at
   * their own branch. Admins (branch_id = null) can intake anywhere.
   * Mirrors SalesService.create's branch access check.
   */
  private assertBranchAccess(
    cashierBranchId: string | null,
    dtoBranchId: string,
  ): void {
    if (cashierBranchId && cashierBranchId !== dtoBranchId) {
      throw new ForbiddenException(
        'You can only intake phones at your own branch',
      );
    }
  }

  /**
   * Customer must exist and not be soft-deleted. Slice A's soft-delete
   * is done via @DeleteDateColumn — the default query already filters
   * deleted rows, so a plain findOne miss covers both "never existed"
   * and "soft-deleted" cases. 400 (not 404) because this is a payload
   * reference, not a URL-path lookup — matches codebase convention.
   */
  private async assertCustomerReference(
    customerId: string,
    manager: EntityManager,
  ): Promise<Customer> {
    const customer = await manager.findOne(Customer, {
      where: { id: customerId },
    });
    if (!customer) {
      throw new BadRequestException(
        `Customer ${customerId} not found or inactive`,
      );
    }
    return customer;
  }

  /**
   * Branch must exist. Branches also have an is_active flag (from
   * Phase 6.1 branches module) — reject inactive too.
   */
  private async assertBranchReference(
    branchId: string,
    manager: EntityManager,
  ): Promise<void> {
    const branch = await manager.findOne(Branch, {
      where: { id: branchId },
    });
    if (!branch) {
      throw new BadRequestException(`Branch ${branchId} not found`);
    }
    if (!branch.is_active) {
      throw new BadRequestException(`Branch ${branchId} is inactive`);
    }
  }

  /**
   * Product must:
   *   - exist, not be soft-deleted, and be active (is_active = true)
   *   - belong to the same branch as the purchase (branch match)
   *   - have is_serialized = true (used-phone SKUs are serialized;
   *     admin flips this via PATCH /products/:id)
   */
  private async assertProductReference(
    productId: string,
    branchId: string,
    manager: EntityManager,
  ): Promise<void> {
    const product = await manager.findOne(Product, {
      where: { id: productId },
    });
    if (!product || !product.is_active) {
      throw new BadRequestException(
        `Product ${productId} not found or inactive`,
      );
    }
    if (product.branch_id !== branchId) {
      throw new BadRequestException(
        `Product ${productId} does not belong to branch ${branchId}`,
      );
    }
    if (!product.is_serialized) {
      throw new BadRequestException(
        `Product ${productId} is not a serialized SKU; ` +
          `phone intake requires is_serialized = true`,
      );
    }
  }

  /**
   * IMEI must not belong to a unit the shop holds (LIVE_UNIT_STATUSES:
   * IN_STOCK, WRITTEN_OFF). SOLD and RETURNED units are history, so a
   * phone we sold, or whose trade-in was voided, can be acquired again
   * as a new unit row (buy-back). Returns 409 with a structured
   * existing_unit payload so the frontend can render status-aware
   * messaging.
   *
   * Race condition note: between this pre-check and the INSERT, a
   * concurrent tx could make the same IMEI live. The partial unique
   * index catches it; saveUnitOrRejectLiveImei maps it to a 409.
   */
  private async assertImeiAvailable(
    imei: string,
    manager: EntityManager,
  ): Promise<void> {
    const existing = await manager.findOne(ProductUnit, {
      where: { imei, status: In([...LIVE_UNIT_STATUSES]) },
    });
    if (existing) {
      throw new ConflictException({
        message: 'IMEI already exists in inventory',
        existing_unit: {
          id: existing.id,
          status: existing.status,
          product_id: existing.product_id,
        },
      });
    }
  }

  /**
   * Insert a new IN_STOCK unit. A concurrent intake of the same IMEI
   * that got past assertImeiAvailable violates uq_product_units_imei_live;
   * map that one violation to the same 409 the pre-check gives (without
   * existing_unit — the aborted transaction can't read the other row).
   * Anything else propagates unchanged.
   */
  private async saveUnitOrRejectLiveImei(
    manager: EntityManager,
    unit: ProductUnit,
  ): Promise<ProductUnit> {
    try {
      return await manager.save(unit);
    } catch (err) {
      if (isLiveImeiConflict(err)) {
        throw new ConflictException({
          message: 'IMEI already exists in inventory',
          existing_unit: null,
        });
      }
      throw err;
    }
  }
}
