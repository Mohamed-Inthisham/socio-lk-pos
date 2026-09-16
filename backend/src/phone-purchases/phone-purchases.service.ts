import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PhonePurchase } from './entities/phone-purchase.entity';
import { ProductUnit } from '../product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../product-units/enums/product-unit-status.enum';
import { Customer } from '../customers/entities/customer.entity';
import { Branch } from '../branches/entities/branch.entity';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { StockService } from '../stock/stock.service';
import { CreatePhonePurchaseDto } from './dto/create-phone-purchase.dto';
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
   *   3. Payload reference validations (customer, branch, product, IMEI)
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
      await this.assertCustomerReference(dto.customer_id, manager);
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
      await manager.save(unit);

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
  ): Promise<void> {
    const customer = await manager.findOne(Customer, {
      where: { id: customerId },
    });
    if (!customer) {
      throw new BadRequestException(
        `Customer ${customerId} not found or inactive`,
      );
    }
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
   *   - exist and not be soft-deleted
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
    if (!product) {
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
   * IMEI must not collide with any existing ProductUnit — regardless
   * of that unit's status. Returns 409 with a structured existing_unit
   * payload so the frontend can render status-aware messaging (e.g.
   * "This IMEI was sold on 2025-03-14 — buy-back flow coming soon").
   *
   * Race condition note: between this pre-check and the INSERT,
   * a concurrent tx could insert the same IMEI. The unique index
   * catches it as a fallback (raw 500). Rare — see Slice D followup.
   */
  private async assertImeiAvailable(
    imei: string,
    manager: EntityManager,
  ): Promise<void> {
    const existing = await manager.findOne(ProductUnit, {
      where: { imei },
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
}
