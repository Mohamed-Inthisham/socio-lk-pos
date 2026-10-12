import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Sale } from './entities/sale.entity';
import { SaleLine } from './entities/sale-line.entity';
import { Payment } from './entities/payment.entity';
import { ProductUnit } from '../product-units/entities/product-unit.entity';
import { Product } from '../products/entities/product.entity';
import { ProductUnitStatus } from '../product-units/enums/product-unit-status.enum';
import { ProductUnitsService } from '../product-units/product-units.service';
import { SaleStatus } from './enums/sale-status.enum';
import { SaleType } from './enums/sale-type.enum';
import { DiscountType } from './enums/discount-type.enum';
import { PaymentMethod } from './enums/payment-method.enum';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { AddSaleLineDto } from './dto/add-sale-line.dto';
import { UpdateSaleLineDto } from './dto/update-sale-line.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { VoidSaleDto } from './dto/void-sale.dto';
import { Branch } from '../branches/entities/branch.entity';
import { User } from '../users/entities/user.entity';
import { ProductsService } from '../products/products.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { StockService } from '../stock/stock.service';
import { SaleNumberCountersService } from '../sale-number-counters/sale-number-counters.service';
import { CustomersService } from '../customers/customers.service';
import { PhonePurchasesService } from '../phone-purchases/phone-purchases.service';
import {
  PaginatedResponse,
  paginate,
} from '../common/dto/paginated-response.dto';

@Injectable()
export class SalesService {
  constructor(
    @InjectRepository(Sale)
    private readonly salesRepository: Repository<Sale>,
    @InjectRepository(SaleLine)
    private readonly saleLinesRepository: Repository<SaleLine>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(Branch)
    private readonly branchesRepository: Repository<Branch>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly productsService: ProductsService,
    private readonly suppliersService: SuppliersService,
    private readonly stockService: StockService,
    private readonly saleNumberCountersService: SaleNumberCountersService,
    private readonly customersService: CustomersService,
    private readonly productUnitsService: ProductUnitsService,
    private readonly phonePurchasesService: PhonePurchasesService,
  ) {}

  /**
   * Resolves a customer_id from client input, ensuring it references
   * an existing, non-deleted customer. Returns the customer_id unchanged
   * on success (for symmetry with future normalization needs) or throws
   * BadRequestException on invalid reference.
   *
   * Deliberately does NOT distinguish "nonexistent" from "soft-deleted"
   * in the error — clients don't need to know why a customer_id is
   * unusable, just that it is. Same 400 status for both matches the
   * codebase convention for cross-entity payload references (see
   * branch_id / product_id validation elsewhere).
   *
   * Throws NotFoundException? No — this is a payload validation on
   * POST/PATCH, not a URL parameter lookup. 400 matches the semantic:
   * the request payload references a nonexistent resource, so the
   * request itself is malformed.
   */
  private async assertCustomerReference(customerId: string): Promise<void> {
    try {
      const customer = await this.customersService.findOne(customerId);
      if (customer.deleted_at) {
        throw new BadRequestException(
          `customer_id ${customerId} refers to a deleted customer`,
        );
      }
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new BadRequestException(
          `customer_id ${customerId} does not exist`,
        );
      }
      throw err;
    }
  }

  /**
   * Create a new DRAFT sale. Called by an authenticated user via the
   * controller — the cashier_id comes from the JWT (never from the client
   * body), so a cashier cannot create a sale attributed to someone else.
   *
   * Cross-entity validation:
   *   - Branch must exist and be active
   *   - Cashier must exist and be active
   *   - Cashier's assigned branch (if any) must match branch_id — a
   *     cashier assigned to Branch A cannot open sales at Branch B.
   *     Admins have no branch assignment and can create at any branch.
   *
   * Sale starts as DRAFT with zeroed totals. Lines and payments are added
   * via sub-resource endpoints (POST /sales/:id/lines, etc — Slices D/E).
   */
  async create(dto: CreateSaleDto, cashierId: string): Promise<Sale> {
    // Validate cashier exists and is active
    const cashier = await this.usersRepository.findOne({
      where: { id: cashierId },
    });
    if (!cashier) {
      throw new NotFoundException('Cashier not found');
    }
    if (!cashier.is_active) {
      throw new ForbiddenException('Cashier account is inactive');
    }

    // Validate branch exists and is active
    const branch = await this.branchesRepository.findOne({
      where: { id: dto.branch_id },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
    if (!branch.is_active) {
      throw new BadRequestException(
        'Cannot create a sale at an inactive branch',
      );
    }

    // Cashier must be creating the sale at their own branch (unless admin).
    // Non-admin users always have branch_id set (enforced by CHK_users_branch_role
    // from Phase 6.2 Path A). Admins have branch_id = null and can transact anywhere.
    if (cashier.branch_id && cashier.branch_id !== dto.branch_id) {
      throw new ForbiddenException(
        'You can only create sales at your own branch',
      );
    }

    if (dto.customer_id) {
      await this.assertCustomerReference(dto.customer_id);
    }

    const sale = this.salesRepository.create({
      sale_type: SaleType.RETAIL,
      status: SaleStatus.DRAFT,
      branch_id: dto.branch_id,
      cashier_id: cashierId,
      customer_id: dto.customer_id ?? null,
      notes: dto.notes ?? null,
      // All money fields default to '0' at the DB level
    });

    return this.salesRepository.save(sale);
  }

  /**
   * List sales with pagination and optional filters.
   *
   * Sort order: created_at DESC (newest first). Cashiers looking at
   * "today's sales" want the most recent at top; dashboards want the
   * same. No opt-out yet — if we need ASC sorting later, add a ?sort
   * param then.
   *
   * Nested branch + cashier included via joins so the frontend can
   * render "Sale #INV-... by cashier X at branch Y" without extra
   * round trips. Follows the nested-response pattern from Phase 6.1.
   */
  async findAll(query: ListSalesQueryDto): Promise<PaginatedResponse<Sale>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.salesRepository
      .createQueryBuilder('sale')
      .leftJoinAndSelect('sale.branch', 'branch')
      .leftJoinAndSelect('sale.cashier', 'cashier');

    if (query.branchId) {
      qb.andWhere('sale.branch_id = :branchId', { branchId: query.branchId });
    }
    if (query.cashierId) {
      qb.andWhere('sale.cashier_id = :cashierId', {
        cashierId: query.cashierId,
      });
    }
    if (query.status) {
      qb.andWhere('sale.status = :status', { status: query.status });
    }
    if (query.from) {
      qb.andWhere('sale.created_at >= :from', { from: query.from });
    }
    if (query.to) {
      // If the client sends a date-only string like '2026-08-31', they
      // typically mean "up to end of that day inclusive". Convert to
      // exclusive upper bound at the start of the next day.
      const to = this.normalizeToUpperBound(query.to);
      qb.andWhere('sale.created_at < :to', { to });
    }

    qb.orderBy('sale.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    return paginate(rows, total, page, limit);
  }

  /**
   * Fetch one sale with nested branch + cashier + lines + payments.
   *
   * Lines are ordered by line_number ASC so the receipt/UI renders them
   * in the cashier's original ring-up order (gaps from removes are
   * preserved).
   *
   * Payments are ordered by created_at ASC — the tender-order matches
   * how a receipt shows split-tender payments (Rs. 400 card first, then
   * Rs. 550 cash, in the order the cashier processed them).
   *
   * Throws 404 if the sale doesn't exist.
   */
  async findOne(id: string): Promise<Sale> {
    const sale = await this.salesRepository.findOne({
      where: { id },
      relations: ['branch', 'cashier', 'lines', 'payments'],
      order: {
        lines: { line_number: 'ASC' },
        payments: { created_at: 'ASC' },
      },
    });
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }
    return sale;
  }
  /**
   * Partial update on a DRAFT sale. Only notes and customer_id can be
   * changed via this endpoint. Attempting to update a COMPLETED or
   * VOIDED sale returns 400 (completed sales are immutable historical
   * records — if the cashier made a mistake, they void and re-create).
   */
  async update(id: string, dto: UpdateSaleDto): Promise<Sale> {
    const sale = await this.findOne(id);

    if (sale.status !== SaleStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot update a ${sale.status} sale. Only DRAFT sales are mutable.`,
      );
    }

    // DTO layer trims strings and converts empty strings to null.
    // undefined = don't touch, null = clear, string = set.
    // If customer_id is being SET (not cleared), validate it references
    // an existing, non-deleted customer.
    if (dto.customer_id !== undefined) {
      if (dto.customer_id !== null) {
        await this.assertCustomerReference(dto.customer_id);
      }
      sale.customer_id = dto.customer_id;
    }
    if (dto.notes !== undefined) sale.notes = dto.notes;
    return this.salesRepository.save(sale);
  }

  /**
   * Discard a DRAFT sale. Hard delete — a DRAFT never became a real
   * financial record, so no history is lost. Attempting to delete
   * a COMPLETED or VOIDED sale returns 400.
   *
   * If the sale doesn't exist, throws 404 (via findOne).
   */
  async discardDraft(id: string): Promise<void> {
    const sale = await this.findOne(id);

    if (sale.status !== SaleStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot delete a ${sale.status} sale. Only DRAFT sales can be discarded.`,
      );
    }

    await this.salesRepository.remove(sale);
  }

  /**
   * Add a new line to a DRAFT sale. Called via the sub-resource endpoint
   * POST /sales/:id/lines.
   *
   * Three line modes, dispatched on (product.is_serialized,
   * dto.external_supplier_id):
   *
   *   IN_HOUSE_NON_SERIALIZED (default retail):
   *     - imei_snapshot must be null (Slice E rule)
   *     - unit_price / cost_price from Product
   *     - stored: product_unit_id=null, external_supplier_id=null
   *     - complete-time: stock decremented, no PU flip
   *
   *   IN_HOUSE_SERIALIZED (used phone / IMEI'd retail):
   *     - imei_snapshot required (looked up as IMEI)
   *     - quantity must be 1
   *     - resolves ProductUnit; Q3 failures produce distinct errors
   *     - unit_price: PU.selling_price → Product.selling_price → 400
   *     - cost_price: PU.buying_price always
   *     - stored: product_unit_id set, imei_snapshot from PU (authoritative)
   *     - complete-time: stock decremented, PU flipped IN_STOCK→SOLD
   *
   *   EXTERNAL (friendly-shop sourced, serialized or not):
   *     - supplier validated (existing behavior)
   *     - if product.is_serialized: imei_snapshot required (free text),
   *       quantity must be 1, IN_STOCK collision check (Q7)
   *     - if non-serialized: imei_snapshot must be null
   *     - unit_price / cost_price from Product
   *     - stored: product_unit_id=null, external_supplier_id set
   *     - complete-time: no stock touch, no PU flip
   *
   * Workflow (all inside a single transaction with sale row locked
   * pessimistic_write):
   *   1. Load + lock the sale, assert it's DRAFT
   *   2. Resolve product (exists, active, same branch as sale)
   *   3. Dispatch to per-mode validation + resolution — determines the
   *      four snapshot values (product_unit_id, imei_snapshot,
   *      unit_price, cost_price)
   *   4. Assign line_number as max + 1
   *   5. Resolve discount_amount from client (type, value)
   *   6. Compute line_total per the CHK formula
   *   7. Insert; recompute sale totals
   *
   * Returns the freshly inserted line WITHOUT relations loaded.
   */
  async addLine(
    saleId: string,
    dto: AddSaleLineDto,
    _cashierId: string,
  ): Promise<SaleLine> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Load + lock the sale
      const sale = await manager
        .createQueryBuilder(Sale, 'sale')
        .setLock('pessimistic_write')
        .where('sale.id = :id', { id: saleId })
        .getOne();
      if (!sale) {
        throw new NotFoundException('Sale not found');
      }
      if (sale.status !== SaleStatus.DRAFT) {
        throw new BadRequestException(
          `Cannot add a line to a ${sale.status} sale. Only DRAFT sales are mutable.`,
        );
      }

      // 2. Resolve the product — must exist, be active, and match the sale's branch
      const product = await this.productsService.findOne(dto.product_id);
      if (!product.is_active) {
        throw new BadRequestException(
          `Product "${product.name}" is not active`,
        );
      }
      if (product.branch_id !== sale.branch_id) {
        throw new BadRequestException(
          `Product "${product.name}" belongs to a different branch than this sale`,
        );
      }

      // 3. Per-mode resolution. These four values are the snapshot the
      //    insert step commits. Only the serialized-in-house branch
      //    overrides unit_price / cost_price / imei_snapshot from Product
      //    defaults; other modes fall through to the Product-based values.
      const clientImei = dto.imei_snapshot ?? null;
      let productUnitId: string | null = null;
      let imeiSnapshot: string | null = clientImei;
      let unitPrice: string = product.selling_price;
      let costPrice: string = product.buying_price;

      if (dto.external_supplier_id) {
        // EXTERNAL branch — resolve supplier (existing behavior)
        const supplier = await this.suppliersService.findOne(
          dto.external_supplier_id,
        );
        if (!supplier.is_active) {
          throw new BadRequestException(
            `Supplier "${supplier.name}" is not active`,
          );
        }

        if (product.is_serialized) {
          // EXTERNAL + serialized: IMEI required as free text,
          // quantity=1, IN_STOCK collision check per Q7.
          if (clientImei === null) {
            throw new BadRequestException(
              `imei_snapshot is required for serialized product "${product.name}"`,
            );
          }
          if (dto.quantity !== 1) {
            throw new BadRequestException(
              `quantity must be 1 for serialized product "${product.name}"`,
            );
          }
          await this.assertExternalSerializedImeiNotInStock(
            manager,
            clientImei,
          );
          // imeiSnapshot already set to clientImei above; leave product-
          // based prices in place (settlement with supplier in Phase 6.7
          // uses these to compute margin owed).
        } else {
          // EXTERNAL + non-serialized: no IMEI allowed.
          this.assertNoImeiOnNonSerializedLine(clientImei, product.name);
        }
      } else if (product.is_serialized) {
        // IN_HOUSE_SERIALIZED — resolve PU, all four Q3 checks, price fallback.
        if (clientImei === null) {
          throw new BadRequestException(
            `imei_snapshot is required for serialized product "${product.name}"`,
          );
        }
        if (dto.quantity !== 1) {
          throw new BadRequestException(
            `quantity must be 1 for serialized product "${product.name}"`,
          );
        }
        const resolved = await this.resolveInHouseSerializedLine(
          manager,
          sale.branch_id,
          product,
          clientImei,
        );
        productUnitId = resolved.productUnitId;
        imeiSnapshot = resolved.imeiSnapshot;
        unitPrice = resolved.unitPrice;
        costPrice = resolved.costPrice;
      } else {
        // IN_HOUSE_NON_SERIALIZED — no IMEI allowed.
        this.assertNoImeiOnNonSerializedLine(clientImei, product.name);
      }

      // 4. Assign line_number as max + 1 within this sale. The sale row
      //    is locked, so concurrent adds on the same sale serialize here.
      const maxRow = await manager
        .createQueryBuilder(SaleLine, 'line')
        .select('COALESCE(MAX(line.line_number), 0)', 'max')
        .where('line.sale_id = :saleId', { saleId })
        .getRawOne<{ max: string }>();
      const nextLineNumber = Number(maxRow?.max ?? 0) + 1;

      // 5. Resolve discount amount from client input (uses per-mode unit_price)
      const discountType = dto.discount_type ?? null;
      const discountValue = dto.discount_value ?? null;
      const discountAmount = this.resolveDiscountAmount(
        unitPrice,
        dto.quantity,
        discountType,
        discountValue,
      );

      // 6. Compute line_total (must match CHK_sale_lines_line_total exactly)
      const lineTotal = this.computeLineTotal(
        unitPrice,
        dto.quantity,
        discountAmount,
      );

      // 7. Insert the line with per-mode snapshot values
      const line = manager.create(SaleLine, {
        sale_id: saleId,
        line_number: nextLineNumber,
        product_id: product.id,
        product_sku_snapshot: product.sku,
        product_name_snapshot: product.name,
        unit_price: unitPrice,
        cost_price_snapshot: costPrice,
        quantity: dto.quantity,
        discount_type: discountType,
        discount_value:
          discountValue === null
            ? null
            : this.roundToCents(Number(discountValue)),
        discount_amount: discountAmount,
        line_total: lineTotal,
        external_supplier_id: dto.external_supplier_id ?? null,
        imei_snapshot: imeiSnapshot,
        product_unit_id: productUnitId,
      });
      const saved = await manager.save(line);

      // 8. Recompute sale totals
      await this.recomputeSaleTotals(manager, saleId);

      return saved;
    });
  }

  /**
   * Update an existing line on a DRAFT sale. Called via
   * PATCH /sales/:saleId/lines/:lineId.
   *
   * Mode-aware (Slice E Q8): what's mutable depends on the line's mode,
   * determined by the STORED product's is_serialized and the STORED
   * external_supplier_id — NOT what the DTO tries to change. Mode
   * changes are forbidden; to switch modes, removeLine + addLine.
   *
   *   Non-serialized (either sourcing):
   *     - quantity, discount, external_supplier_id: mutable
   *     - imei_snapshot: must be null (rejected if set)
   *
   *   Serialized in-house:
   *     - discount: mutable
   *     - quantity: frozen at 1 (rejected if != 1)
   *     - external_supplier_id: frozen (rejected if included at all —
   *       mode change would need PU un-link)
   *     - imei_snapshot: frozen (rejected if included at all — changing
   *       IMEI = changing physical phone = removeLine + addLine)
   *
   *   Serialized external:
   *     - discount, imei_snapshot: mutable (imei_snapshot re-runs the
   *       IN_STOCK collision check from Q7)
   *     - quantity: frozen at 1
   *     - external_supplier_id: frozen (mode change to in-house would
   *       need PU resolution)
   *
   * PATCH semantics preserved: undefined = don't touch, null = clear
   * (nullable fields), value = set. Frozen-field rejections fire only
   * when the field is INCLUDED in the DTO — silent "don't touch" is
   * always allowed.
   *
   * Runs inside a transaction with the parent sale row locked
   * pessimistic_write. Recomputes sale totals from source at the end.
   */
  async updateLine(
    saleId: string,
    lineId: string,
    dto: UpdateSaleLineDto,
  ): Promise<SaleLine> {
    return this.dataSource.transaction(async (manager) => {
      // Load + lock the sale
      const sale = await manager
        .createQueryBuilder(Sale, 'sale')
        .setLock('pessimistic_write')
        .where('sale.id = :id', { id: saleId })
        .getOne();
      if (!sale) {
        throw new NotFoundException('Sale not found');
      }
      if (sale.status !== SaleStatus.DRAFT) {
        throw new BadRequestException(
          `Cannot update a line on a ${sale.status} sale. Only DRAFT sales are mutable.`,
        );
      }

      // Load the line and confirm it belongs to this sale
      const line = await manager.findOne(SaleLine, {
        where: { id: lineId },
      });
      if (!line || line.sale_id !== saleId) {
        throw new NotFoundException('Sale line not found');
      }

      // Determine mode from STORED state. Load the product to check
      // is_serialized (not carried on SaleLine — snapshot has sku/name
      // but not is_serialized).
      const product = await this.productsService.findOne(line.product_id);
      const isSerialized = product.is_serialized;
      const isExternal = line.external_supplier_id !== null;

      // Mode-specific guards. Each guard checks only fields the client
      // actually included (undefined = don't touch, silently allowed).

      if (isSerialized) {
        // Serialized: quantity locked at 1, external_supplier_id frozen.
        if (dto.quantity !== undefined && dto.quantity !== 1) {
          throw new BadRequestException(
            `quantity must be 1 for serialized product "${product.name}"`,
          );
        }
        if (dto.external_supplier_id !== undefined) {
          throw new BadRequestException(
            `Cannot change external_supplier_id on a serialized line. ` +
              `Remove the line and add a new one to change sourcing.`,
          );
        }

        if (isExternal) {
          // External serialized: imei_snapshot editable with collision check.
          if (dto.imei_snapshot !== undefined && dto.imei_snapshot !== null) {
            await this.assertExternalSerializedImeiNotInStock(
              manager,
              dto.imei_snapshot,
            );
          }
          // Nulling imei_snapshot on external serialized is nonsensical
          // (it's the only IMEI record for the line) but the DB CHECK
          // constraint doesn't forbid it — leave to service:
          if (dto.imei_snapshot === null) {
            throw new BadRequestException(
              `imei_snapshot is required for serialized external-sourced line`,
            );
          }
        } else {
          // In-house serialized: imei_snapshot frozen entirely.
          if (dto.imei_snapshot !== undefined) {
            throw new BadRequestException(
              `Cannot change imei_snapshot on a serialized in-house line. ` +
                `Remove the line and add a new one to change the IMEI.`,
            );
          }
        }
      } else {
        // Non-serialized (either sourcing): imei_snapshot must be null.
        if (dto.imei_snapshot !== undefined && dto.imei_snapshot !== null) {
          throw new BadRequestException(
            `Product "${product.name}" is not serialized; ` +
              `imei_snapshot must not be set`,
          );
        }
        // Non-serialized allows external_supplier_id toggle (existing
        // behavior). Validate supplier if setting to a non-null value.
        if (dto.external_supplier_id) {
          const supplier = await this.suppliersService.findOne(
            dto.external_supplier_id,
          );
          if (!supplier.is_active) {
            throw new BadRequestException(
              `Supplier "${supplier.name}" is not active`,
            );
          }
        }
      }

      // Merge DTO onto current line state to get the "effective" values
      // for discount recompute. Same logic as before — mode guards above
      // already blocked the invalid touches.
      const nextQuantity = dto.quantity ?? line.quantity;

      const discountTypeTouched = dto.discount_type !== undefined;
      const discountValueTouched = dto.discount_value !== undefined;
      const nextDiscountType = discountTypeTouched
        ? dto.discount_type
        : line.discount_type;
      const nextDiscountValue = discountValueTouched
        ? dto.discount_value
        : line.discount_value === null
          ? null
          : Number(line.discount_value);

      if (discountTypeTouched !== discountValueTouched) {
        throw new BadRequestException(
          'discount_type and discount_value must be updated together',
        );
      }

      const nextDiscountAmount = this.resolveDiscountAmount(
        line.unit_price,
        nextQuantity,
        nextDiscountType ?? null,
        nextDiscountValue ?? null,
      );
      const nextLineTotal = this.computeLineTotal(
        line.unit_price,
        nextQuantity,
        nextDiscountAmount,
      );

      // Apply mutations. Only touch fields the DTO actually included,
      // plus the server-derived recomputes.
      if (dto.quantity !== undefined) line.quantity = nextQuantity;
      if (discountTypeTouched) line.discount_type = nextDiscountType ?? null;
      if (discountValueTouched) {
        line.discount_value =
          nextDiscountValue === null || nextDiscountValue === undefined
            ? null
            : this.roundToCents(nextDiscountValue);
      }
      if (dto.external_supplier_id !== undefined) {
        line.external_supplier_id = dto.external_supplier_id;
      }
      if (dto.imei_snapshot !== undefined) {
        line.imei_snapshot = dto.imei_snapshot;
      }
      line.discount_amount = nextDiscountAmount;
      line.line_total = nextLineTotal;

      const saved = await manager.save(line);

      // Recompute sale totals
      await this.recomputeSaleTotals(manager, saleId);

      return saved;
    });
  }

  /**
   * Remove a line from a DRAFT sale. Called via
   * DELETE /sales/:saleId/lines/:lineId (wired in Slice D3).
   *
   * Hard delete — a DRAFT line has no financial history to preserve. If
   * the parent sale ever completes, its remaining lines become immutable;
   * this endpoint only applies to lines on a DRAFT sale.
   *
   * line_number is NOT renumbered after remove. Gaps in the sequence
   * (e.g. 1, 2, 4 after deleting line 3) are intended — renumbering
   * would invalidate any receipt drafts, cashier scratchpads, or
   * frontend state that referenced the old numbers.
   *
   * Runs inside a transaction with the parent sale row locked and
   * recomputes sale totals from the resulting line set.
   */
  async removeLine(saleId: string, lineId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const sale = await manager
        .createQueryBuilder(Sale, 'sale')
        .setLock('pessimistic_write')
        .where('sale.id = :id', { id: saleId })
        .getOne();
      if (!sale) {
        throw new NotFoundException('Sale not found');
      }
      if (sale.status !== SaleStatus.DRAFT) {
        throw new BadRequestException(
          `Cannot remove a line from a ${sale.status} sale. Only DRAFT sales are mutable.`,
        );
      }

      const line = await manager.findOne(SaleLine, { where: { id: lineId } });
      if (!line || line.sale_id !== saleId) {
        throw new NotFoundException('Sale line not found');
      }

      await manager.remove(line);

      await this.recomputeSaleTotals(manager, saleId);
    });
  }

  /**
   * Add a new payment to a DRAFT sale. Called via the sub-resource endpoint
   * POST /sales/:id/payments (wired in Slice E3).
   *
   * Workflow, all inside a single transaction with the sale row locked
   * pessimistic_write:
   *   1. Load + lock the parent sale, assert it's DRAFT
   *   2. Validate method-specific field rules (CASH↔cash_received,
   *      reference required for non-CASH)
   *   3. Compute remaining balance = Sale.total - SUM(existing payments)
   *      and assert amount <= remaining (protects DB backstop
   *      CHK_sales_amount_paid_bounded from ever firing)
   *   4. Insert the payment
   *   5. Recompute sales.amount_paid and sales.change_due from all payments
   *
   * Returns the freshly inserted payment WITHOUT relations loaded — callers
   * that need the full nested shape can re-fetch via findOne (which is
   * exactly what the controller does in E3).
   */
  async addPayment(saleId: string, dto: AddPaymentDto): Promise<Payment> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Load + lock the sale
      const sale = await manager
        .createQueryBuilder(Sale, 'sale')
        .setLock('pessimistic_write')
        .where('sale.id = :id', { id: saleId })
        .getOne();
      if (!sale) {
        throw new NotFoundException('Sale not found');
      }
      if (sale.status !== SaleStatus.DRAFT) {
        throw new BadRequestException(
          `Cannot add a payment to a ${sale.status} sale. Only DRAFT sales are mutable.`,
        );
      }

      // 2. Validate the (method, amount, cash_received, reference_number)
      //    tuple. TRADE_IN gets its own branch inside this helper.
      this.assertPaymentFieldsConsistent(
        dto.payment_method,
        dto.amount,
        dto.cash_received ?? null,
        dto.reference_number ?? null,
      );

      // 2a. Validate trade-in field shape. Non-TRADE_IN payments must
      //     have no trade_in_* fields; TRADE_IN must have the required
      //     trio.
      this.assertTradeInFieldsPresenceMatchesMethod(dto.payment_method, dto);

      // 2b. TRADE_IN-specific downstream validation.
      if (dto.payment_method === PaymentMethod.TRADE_IN) {
        // Customer required — we're buying a phone FROM someone.
        if (sale.customer_id === null) {
          throw new BadRequestException(
            'TRADE_IN payment requires a customer on the sale; ' +
              'set the sale.customer_id first',
          );
        }

        // Amount must match buying_price (Q2 lock). Safe non-null
        // access: assertTradeInFieldsPresenceMatchesMethod already
        // guaranteed trade_in_buying_price is defined for TRADE_IN.
        this.assertTradeInAmountMatchesBuyingPrice(
          dto.amount,
          dto.trade_in_buying_price!,
        );

        // Product + IMEI references (best-effort UX pre-check per Q4).
        await this.assertTradeInPaymentReferencesValid(
          manager,
          dto.trade_in_product_id!,
          dto.trade_in_imei!,
          sale.branch_id,
        );
      }

      // 3. Assert amount does not overshoot remaining balance
      const remaining = await this.remainingBalance(
        manager,
        saleId,
        sale.total,
      );
      if (dto.amount > remaining) {
        throw new BadRequestException(
          `Payment amount ${dto.amount.toFixed(2)} exceeds remaining balance ${remaining.toFixed(2)}`,
        );
      }

      // 4. Insert. Trade-in fields populated only for TRADE_IN; all null
      //    for other methods (enforced by CHK constraints too).
      const isTradeIn = dto.payment_method === PaymentMethod.TRADE_IN;
      const payment = manager.create(Payment, {
        sale_id: saleId,
        payment_method: dto.payment_method,
        amount: this.roundToCents(dto.amount),
        cash_received:
          dto.cash_received === undefined
            ? null
            : this.roundToCents(dto.cash_received),
        reference_number: dto.reference_number ?? null,
        notes: dto.notes ?? null,
        trade_in_product_id: isTradeIn ? dto.trade_in_product_id! : null,
        trade_in_imei: isTradeIn ? dto.trade_in_imei! : null,
        trade_in_buying_price: isTradeIn
          ? this.roundToCents(dto.trade_in_buying_price!)
          : null,
        trade_in_selling_price:
          isTradeIn && dto.trade_in_selling_price !== undefined
            ? this.roundToCents(dto.trade_in_selling_price)
            : null,
        trade_in_notes: isTradeIn ? (dto.trade_in_notes ?? null) : null,
        trade_in_phone_purchase_id: null, // populated at completeSale
      });
      const saved = await manager.save(payment);

      // 5. Recompute sale totals from payments
      await this.recomputePaymentTotals(manager, saleId);

      return saved;
    });
  }

  /**
   * Update an existing payment on a DRAFT sale. Called via
   * PATCH /sales/:saleId/payments/:paymentId (wired in Slice E3).
   *
   * Updatable: amount, cash_received, reference_number, notes.
   * Frozen: payment_method, sale_id (see UpdatePaymentDto for reasoning).
   * TRADE_IN payments: only notes is updatable; see
   * assertNoTradeInFreezesViolated.
   *
   * PATCH semantics: undefined = don't touch, null = clear (nullable
   * fields), value = set.
   *
   * All cross-field validation runs against the MERGED (existing + DTO)
   * state, then the effective amount is bounded above by (Sale.total -
   * SUM of OTHER payments). "Other" excludes the payment being updated.
   */
  async updatePayment(
    saleId: string,
    paymentId: string,
    dto: UpdatePaymentDto,
  ): Promise<Payment> {
    return this.dataSource.transaction(async (manager) => {
      // Load + lock the sale
      const sale = await manager
        .createQueryBuilder(Sale, 'sale')
        .setLock('pessimistic_write')
        .where('sale.id = :id', { id: saleId })
        .getOne();
      if (!sale) {
        throw new NotFoundException('Sale not found');
      }
      if (sale.status !== SaleStatus.DRAFT) {
        throw new BadRequestException(
          `Cannot update a payment on a ${sale.status} sale. Only DRAFT sales are mutable.`,
        );
      }

      // Load the payment and confirm it belongs to this sale
      const payment = await manager.findOne(Payment, {
        where: { id: paymentId },
      });
      if (!payment || payment.sale_id !== saleId) {
        throw new NotFoundException('Payment not found');
      }

      // TRADE_IN payments are frozen except for notes; trade_in_* fields
      // are never patchable on any payment (Q2 lock).
      this.assertNoTradeInFreezesViolated(payment, dto);

      // Merge DTO onto current payment state
      const nextAmount = dto.amount ?? Number(payment.amount);
      const nextCashReceived =
        dto.cash_received !== undefined
          ? dto.cash_received
          : payment.cash_received === null
            ? null
            : Number(payment.cash_received);
      const nextReferenceNumber =
        dto.reference_number !== undefined
          ? dto.reference_number
          : payment.reference_number;

      // Validate the merged state (method is frozen so use existing value)
      this.assertPaymentFieldsConsistent(
        payment.payment_method,
        nextAmount,
        nextCashReceived,
        nextReferenceNumber,
      );

      // Bound nextAmount above by remaining balance excluding THIS payment.
      // We pass the current payment's amount as "excludeAmount" so it's
      // subtracted from the "already paid" total before computing remaining.
      const remaining = await this.remainingBalance(
        manager,
        saleId,
        sale.total,
        Number(payment.amount),
      );
      if (nextAmount > remaining) {
        throw new BadRequestException(
          `Payment amount ${nextAmount.toFixed(2)} exceeds remaining balance ${remaining.toFixed(2)}`,
        );
      }

      // Apply mutations. Only touch fields the DTO actually included.
      if (dto.amount !== undefined) {
        payment.amount = this.roundToCents(nextAmount);
      }
      if (dto.cash_received !== undefined) {
        payment.cash_received =
          nextCashReceived === null
            ? null
            : this.roundToCents(nextCashReceived);
      }
      if (dto.reference_number !== undefined) {
        payment.reference_number = dto.reference_number;
      }
      if (dto.notes !== undefined) {
        payment.notes = dto.notes;
      }

      const saved = await manager.save(payment);

      // Recompute sale totals
      await this.recomputePaymentTotals(manager, saleId);

      return saved;
    });
  }

  /**
   * Remove a payment from a DRAFT sale. Called via
   * DELETE /sales/:saleId/payments/:paymentId (wired in Slice E3).
   *
   * Hard delete — a DRAFT payment has no ledger commitment yet. If the
   * parent sale ever completes, its remaining payments become immutable;
   * this endpoint only applies to payments on a DRAFT sale.
   *
   * Runs inside a transaction with the parent sale row locked and
   * recomputes amount_paid + change_due from the resulting payment set.
   */
  async removePayment(saleId: string, paymentId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const sale = await manager
        .createQueryBuilder(Sale, 'sale')
        .setLock('pessimistic_write')
        .where('sale.id = :id', { id: saleId })
        .getOne();
      if (!sale) {
        throw new NotFoundException('Sale not found');
      }
      if (sale.status !== SaleStatus.DRAFT) {
        throw new BadRequestException(
          `Cannot remove a payment from a ${sale.status} sale. Only DRAFT sales are mutable.`,
        );
      }

      const payment = await manager.findOne(Payment, {
        where: { id: paymentId },
      });
      if (!payment || payment.sale_id !== saleId) {
        throw new NotFoundException('Payment not found');
      }

      await manager.remove(payment);

      await this.recomputePaymentTotals(manager, saleId);
    });
  }

  /**
   * Transition a DRAFT sale into COMPLETED. This is the point where a
   * cashier-facing "Complete Sale" button actually commits money and
   * inventory. Everything below happens atomically in a single
   * transaction — if any step fails, nothing persists.
   *
   * Preconditions (400 unless noted):
   *   - Sale exists (404)
   *   - Sale is DRAFT (400 — completed/voided sales are immutable)
   *   - Sale has at least one line (400 — client should never send this)
   *   - amount_paid === total, compared as numbers (400 — the invariant
   *     deferred from Slice E; DB CHK_sales_amount_paid_bounded stops
   *     overpayment, this stops underpayment)
   *
   * Steps, in order:
   *   1. Load + lock the sale (pessimistic_write on the sales row)
   *   2. Run guards above
   *   3. For each line where external_supplier_id IS NULL: decrement
   *      stock via StockService.decrementForSale, enlisted in this
   *      transaction. Lines sourced from friendly shops
   *      (external_supplier_id set) are NOT decremented from our stock —
   *      they were never our inventory. Insufficient stock throws 409
   *      and rolls the whole transaction back (see Slice F design pass).
   *   3b. For each TRADE_IN payment: materialize PhonePurchase +
   *      ProductUnit (IN_STOCK) + Stock increment via
   *      PhonePurchasesService.createForTradeIn, then stamp
   *      trade_in_phone_purchase_id on the payment. 400 if the sale's
   *      customer was cleared after the trade-in was added.
   *   4. Issue sale_number via SaleNumberCountersService.generateNext,
   *      enlisted in this transaction. If we roll back after this,
   *      the counter is burned (gap in sequence) — accepted trade-off
   *      per the counter service's own docstring.
   *   5. UPDATE sales SET status=COMPLETED, completed_at=now(),
   *      sale_number=<issued>.
   *
   * Returns void. The controller re-fetches via findOne to get the
   * fully-hydrated response — matches the pattern from addLine/addPayment.
   *
   * @Auditable('Sale', AuditAction.COMPLETE) lands on the controller
   * endpoint in Slice F2, not here (audit decorators are controller-level).
   */
  async completeSale(saleId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // 1. Load + lock the sale
      const sale = await manager
        .createQueryBuilder(Sale, 'sale')
        .setLock('pessimistic_write')
        .where('sale.id = :id', { id: saleId })
        .getOne();
      if (!sale) {
        throw new NotFoundException('Sale not found');
      }

      // 2a. Must be DRAFT
      if (sale.status !== SaleStatus.DRAFT) {
        throw new BadRequestException(
          `Cannot complete a ${sale.status} sale. Only DRAFT sales can be completed.`,
        );
      }

      // 2b. Must have at least one line. Loaded separately from the
      // sale (which was fetched without relations for locking) — we
      // need the lines below anyway for stock decrement, so this
      // doubles as the count check.
      const lines = await manager.find(SaleLine, {
        where: { sale_id: saleId },
        order: { line_number: 'ASC' },
      });
      if (lines.length === 0) {
        throw new BadRequestException(
          'Cannot complete a sale with no lines. Add at least one line first.',
        );
      }

      // 2c. amount_paid must equal total exactly. Both are numeric(12,2)
      // strings from Postgres, so Number() them and compare on cents to
      // avoid float-representation surprises. A mismatch by even 1 cent
      // is a real problem — the DB CHK stops overpayment, we stop under.
      const totalCents = Math.round(Number(sale.total) * 100);
      const paidCents = Math.round(Number(sale.amount_paid) * 100);
      if (paidCents !== totalCents) {
        throw new BadRequestException(
          `Cannot complete sale: amount_paid ${sale.amount_paid} does not equal total ${sale.total}`,
        );
      }

      // 3. Per-line state transitions for the sale being COMPLETED.
      //    Two orthogonal decisions per line (Slice E derived-from-Q4):
      //      Stock decrement: gated on `external_supplier_id === null`.
      //        External-supplier lines don't touch our inventory —
      //        settlement in Phase 6.7 tracks those separately.
      //      PU flip: gated on `product_unit_id !== null`.
      //        Set only on serialized in-house lines. External-sourced
      //        serialized has product_unit_id=null (imei_snapshot is
      //        free text); non-serialized always has it null.
      //
      //    Lock ordering per Q4: Stock row (coarser, per product+branch)
      //    before ProductUnit row (finer, per single unit). Any throw
      //    inside either call rolls back the whole transaction.
      //
      //    Non-IN_STOCK PU here fires the cross-DRAFT race conflict
      //    (Q5) — two DRAFTs held the same IMEI, another sale completed
      //    first, this one loses with 409 + existing_unit payload.
      for (const line of lines) {
        if (line.external_supplier_id === null) {
          await this.stockService.decrementForSale(
            manager,
            line.product_id,
            sale.branch_id,
            line.quantity,
            line.product_name_snapshot,
          );
        }
        if (line.product_unit_id !== null) {
          await this.productUnitsService.markSoldForSale(
            manager,
            line.product_unit_id,
          );
        }
      }

      // 3b. Materialize trade-ins (Slice G). During DRAFT a TRADE_IN
      //     payment only carries intake data; no PhonePurchase /
      //     ProductUnit / Stock exists yet. Here each one becomes real
      //     inventory via createForTradeIn (enlisted in this manager),
      //     and the PhonePurchase id is stamped back onto the payment.
      //     Runs after the outgoing loop so outgoing Stock/PU locks are
      //     taken first. An IMEI collision (409) or product change
      //     (400) rolls back the whole sale.
      const tradeInPayments = await manager.find(Payment, {
        where: { sale_id: saleId, payment_method: PaymentMethod.TRADE_IN },
        order: { created_at: 'ASC' },
      });
      if (tradeInPayments.length > 0 && sale.customer_id === null) {
        // addPayment requires a customer for TRADE_IN, but update() can
        // still clear it afterwards. PhonePurchase needs a customer.
        throw new BadRequestException(
          'Cannot complete sale: TRADE_IN payments require a customer on ' +
            'the sale; set sale.customer_id first',
        );
      }
      for (const payment of tradeInPayments) {
        // CHK_payments_trade_in_fields_consistent guarantees the trio is
        // non-null on TRADE_IN rows.
        const { phone_purchase } =
          await this.phonePurchasesService.createForTradeIn(manager, {
            customer_id: sale.customer_id!,
            branch_id: sale.branch_id,
            cashier_id: sale.cashier_id,
            product_id: payment.trade_in_product_id!,
            imei: payment.trade_in_imei!,
            buying_price: payment.trade_in_buying_price!,
            selling_price: payment.trade_in_selling_price,
            notes: payment.trade_in_notes,
          });
        await manager.query(
          `UPDATE payments
           SET trade_in_phone_purchase_id = $1,
               updated_at = now()
           WHERE id = $2`,
          [phone_purchase.id, payment.id],
        );
      }

      // 4. Issue the invoice number. Enlisted in this transaction so
      // a downstream rollback releases it (with a gap, which is fine).
      const saleNumber = await this.saleNumberCountersService.generateNext(
        sale.branch_id,
        manager,
      );

      // 5. Flip the sale to COMPLETED. Direct UPDATE rather than
      // manager.save(sale) so we set completed_at server-side via now()
      // and avoid a second round trip for the reload.
      await manager.query(
        `UPDATE sales
         SET status = $1,
             sale_number = $2,
             completed_at = now(),
             updated_at = now()
         WHERE id = $3`,
        [SaleStatus.COMPLETED, saleNumber, saleId],
      );
    });
  }

  /**
   * Transition a COMPLETED sale into VOIDED. This is the reversal of
   * completeSale — everything below happens atomically in a single
   * transaction. If any step fails, nothing persists: the sale stays
   * COMPLETED, stock stays where it was, payments stay live.
   *
   * Void is a financial reversal, not a deletion. The sale row stays
   * in the ledger forever with its original sale_number, cashier,
   * lines, and payments intact. What changes:
   *   - status: COMPLETED → VOIDED
   *   - voided_at: now() (DB clock, not app clock)
   *   - voided_by: the user who authorized the void
   *   - void_reason: the reason the user provided
   *   - stock: re-incremented for every in-house line
   *   - trade-ins: PU flipped to RETURNED, stock decremented
   *   - payments: reversed_at + reversal_reason stamped on every row
   *
   * completed_at is preserved (the sale WAS completed, that fact
   * doesn't change). sale_number is preserved (invoice numbers are
   * forever, gaps are how audits detect tampering). Lines are
   * untouched — the void reason lives at sale level, not per-line.
   *
   * Preconditions:
   *   - Sale exists (404)
   *   - Sale is COMPLETED (400 — can't void DRAFT that never was real,
   *     can't void VOIDED — VOIDED is terminal by design)
   *   - void_reason is present and non-blank (enforced at DTO + here
   *     as a defense-in-depth guard for internal callers)
   *
   * Steps, in order, all inside a single transaction with the sale
   * row locked pessimistic_write:
   *
   *   1. Load + lock the sale (serializes against concurrent complete/void
   *      on the same row).
   *   2. Guard sale is COMPLETED.
   *   3. Guard void_reason is non-blank after trim.
   *   4. Load all lines and payments for this sale (need both for the
   *      mutations below; single-fetch each rather than one-by-one).
   *   5. For each line where external_supplier_id IS NULL: re-increment
   *      stock via StockService.incrementForReversal. External-supplier
   *      lines were never decremented from our stock, so nothing to
   *      reverse — symmetric to completeSale's skip.
   *   5b. For each TRADE_IN payment: flip its ProductUnit IN_STOCK →
   *      RETURNED via ProductUnitsService.markReturnedForVoid, then
   *      decrement Stock via StockService.decrementForVoidedTradeIn.
   *      409 if the trade-in phone was resold on a later sale (Q7).
   *   6. UPDATE payments SET reversed_at=now(), reversal_reason=<trimmed>
   *      for all payments on this sale. Single UPDATE statement rather
   *      than a loop — payments don't need per-row logic, and this
   *      keeps the round trip count down.
   *   7. UPDATE sales SET status=VOIDED, voided_at=now(),
   *      voided_by=<userId>, void_reason=<trimmed>. Direct UPDATE so
   *      timestamps come from the DB clock, same pattern as completeSale.
   *
   * Returns void. Controller re-fetches via findOne to get the
   * fully-hydrated response.
   *
   * @Auditable('Sale', AuditAction.VOID) lands on the controller endpoint
   * in Step 7, not here (audit decorators are controller-level).
   */
  async voidSale(
    saleId: string,
    voidedById: string,
    dto: VoidSaleDto,
  ): Promise<void> {
    // Defense-in-depth trim + non-blank check. DTO already does this,
    // but internal callers (future queues, admin scripts) may skip the
    // DTO layer. Same-value redundancy — DB CHK is the final backstop.
    const trimmedReason = dto.void_reason?.trim() ?? '';
    if (trimmedReason.length < 3) {
      throw new BadRequestException(
        'void_reason is required (min 3 characters after trimming)',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      // 1. Load + lock the sale
      const sale = await manager
        .createQueryBuilder(Sale, 'sale')
        .setLock('pessimistic_write')
        .where('sale.id = :id', { id: saleId })
        .getOne();
      if (!sale) {
        throw new NotFoundException('Sale not found');
      }

      // 2. Must be COMPLETED. DRAFT can't be voided (it never was a
      //    real financial record — use DELETE to discard). VOIDED is
      //    terminal — the enum docstring is authoritative.
      if (sale.status !== SaleStatus.COMPLETED) {
        throw new BadRequestException(
          `Cannot void a ${sale.status} sale. Only COMPLETED sales can be voided.`,
        );
      }

      // 3. reason already validated at DTO + line above; nothing more to check.

      // 4. Load lines and payments. Lines are needed for the stock
      //    re-increment loop; payments are read implicitly by the UPDATE
      //    below (no need to materialize them into JS objects — but we
      //    do want to know if there are any, for a hypothetical future
      //    early-exit optimization).
      const lines = await manager.find(SaleLine, {
        where: { sale_id: saleId },
      });
      // Any COMPLETED sale has at least one line — enforced by
      // completeSale's own guard — so we don't check length here.

      // 5. Per-line state REVERSALS for the sale being VOIDED. Symmetric
      //    to completeSale's step 3, in the same lock order (Stock first,
      //    then PU). Same two orthogonal gates:
      //      Stock re-increment: gated on `external_supplier_id === null`.
      //      PU flip SOLD → IN_STOCK: gated on `product_unit_id !== null`.
      //
      //    Sequential (not Promise.all) so pessimistic_write locks
      //    serialize cleanly per (product, branch) and per PU, matching
      //    the completeSale pattern.
      //
      //    Non-SOLD PU here is a 500 integrity error — a COMPLETED
      //    sale's serialized in-house lines MUST have their PUs in
      //    SOLD status (completeSale flipped them). Any other status
      //    means the state machine was bypassed.
      for (const line of lines) {
        if (line.external_supplier_id === null) {
          await this.stockService.incrementForReversal(
            manager,
            line.product_id,
            sale.branch_id,
            line.quantity,
          );
        }
        if (line.product_unit_id !== null) {
          await this.productUnitsService.markAvailableForReversal(
            manager,
            line.product_unit_id,
          );
        }
      }

      // 5b. Reverse trade-in intake (Slice G). Symmetric to completeSale's
      //     step 3b: each TRADE_IN payment's ProductUnit flips IN_STOCK →
      //     RETURNED and its Stock is decremented. Same lock order as
      //     intake (PU, then Stock). A SOLD PU means the trade-in phone
      //     was resold on a later sale (Q7) — markReturnedForVoid throws
      //     409 and the whole void rolls back. The PhonePurchase row
      //     stays as history; the payment is reversed by step 6 below.
      const tradeInPayments = await manager.find(Payment, {
        where: { sale_id: saleId, payment_method: PaymentMethod.TRADE_IN },
        order: { created_at: 'ASC' },
      });
      for (const payment of tradeInPayments) {
        // Checked explicitly: TypeORM may drop a null where-condition,
        // which would match an arbitrary unit.
        if (payment.trade_in_phone_purchase_id === null) {
          throw new Error(
            `TRADE_IN payment ${payment.id} on COMPLETED sale ${saleId} ` +
              `has no trade_in_phone_purchase_id. completeSale should ` +
              `have stamped it — data integrity issue.`,
          );
        }
        const linkedUnit = await manager.findOne(ProductUnit, {
          where: { phone_purchase_id: payment.trade_in_phone_purchase_id },
        });
        if (!linkedUnit) {
          throw new Error(
            `No ProductUnit linked to phone purchase ` +
              `${payment.trade_in_phone_purchase_id} (payment ${payment.id}). ` +
              `Data integrity issue — createForTradeIn creates both together.`,
          );
        }
        const unit = await this.productUnitsService.markReturnedForVoid(
          manager,
          linkedUnit.id,
        );
        await this.stockService.decrementForVoidedTradeIn(
          manager,
          unit.product_id,
          unit.branch_id,
          1,
        );
      }

      // 6. Mark every payment on this sale as reversed. Single UPDATE
      //    rather than looping per-payment — payments don't need any
      //    per-row logic here, and a single round trip is cheaper.
      //    reversal_reason is copied from the sale's void_reason (design
      //    decision — cashier enters the reason once at sale level,
      //    every payment inherits it). The CHK_payments_reversal_consistency
      //    is satisfied by setting both columns together.
      await manager.query(
        `UPDATE payments
         SET reversed_at = now(),
             reversal_reason = $1,
             updated_at = now()
         WHERE sale_id = $2`,
        [trimmedReason, saleId],
      );

      // 7. Flip the sale to VOIDED. Direct UPDATE for DB-clock timestamps
      //    and single round trip, same as completeSale. All four void
      //    fields set together — CHK_sales_voided_consistency verifies
      //    the biconditional.
      await manager.query(
        `UPDATE sales
         SET status = $1,
             voided_at = now(),
             voided_by = $2,
             void_reason = $3,
             updated_at = now()
         WHERE id = $4`,
        [SaleStatus.VOIDED, voidedById, trimmedReason, saleId],
      );
    });
  }

  /**
   * Convert an ISO date/timestamp to an exclusive upper bound for
   * a created_at range filter.
   *
   * If the input is date-only ('2026-08-31'), returns the start of the
   * next day ('2026-09-01T00:00:00Z') so the day is fully included.
   *
   * If the input already has a time component, returns it as-is.
   *
   * Kept private and simple; no timezone shifting (Postgres timestamps
   * are stored in UTC). If a client wants Colombo-local end-of-day
   * boundaries, they can pass an ISO string with explicit offset.
   */
  private normalizeToUpperBound(input: string): string {
    // Detect date-only ISO format YYYY-MM-DD (exactly 10 chars, no T)
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      const date = new Date(input + 'T00:00:00Z');
      date.setUTCDate(date.getUTCDate() + 1);
      return date.toISOString();
    }
    return input;
  }
  /**
   * Round a JavaScript Number to 2 decimal places, half-up, returned as
   * a string in the Postgres numeric(_,2) format the DB expects.
   *
   * The `+ Number.EPSILON` guards against classic float representation
   * bugs where e.g. 1.005 is actually stored as 1.00499999..., which
   * would then round DOWN to 1.00 instead of the intended half-up 1.01.
   * EPSILON is 2.22e-16 — vanishingly small next to any real LKR value,
   * so it never affects legitimate math, only nudges edge cases the
   * right way.
   *
   * Assumes non-negative input. Discount math in this service is always
   * non-negative (enforced by DTOs and DB CHECKs), so half-up on the
   * absolute value is the same as half-up on the signed value.
   */
  private roundToCents(value: number): string {
    return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
  }

  /**
   * Resolve the absolute LKR discount amount for a line from the raw
   * client input. The client sends {discount_type, discount_value}; the
   * server owns the resulting discount_amount.
   *
   * Enforces the both-or-neither invariant (type and value must be
   * consistently set or consistently null) — same as
   * CHK_sale_lines_discount_consistency at the DB, but surfaces a clean
   * 400 rather than a 500.
   *
   * AMOUNT: value is LKR off the line, must not exceed unit_price * qty.
   * Overrunning throws 400 rather than silently clamping — clamping would
   * hide UI bugs and produce charges the cashier didn't intend.
   *
   * PERCENT: value is 0–100, applied to unit_price * qty. DTO already
   * enforces the 0–100 range; the redundant guard here protects against
   * service-level callers that skip the DTO (tests, future internal APIs).
   */
  private resolveDiscountAmount(
    unitPrice: string,
    quantity: number,
    discountType: DiscountType | null,
    discountValue: string | number | null,
  ): string {
    // No discount at all
    if (discountType === null && discountValue === null) {
      return '0.00';
    }
    // Inconsistent — one set, other null
    if (discountType === null || discountValue === null) {
      throw new BadRequestException(
        'discount_type and discount_value must both be set or both be null',
      );
    }

    const value =
      typeof discountValue === 'string' ? Number(discountValue) : discountValue;
    const lineSubtotal = Number(unitPrice) * quantity;

    if (discountType === DiscountType.AMOUNT) {
      if (value > lineSubtotal) {
        throw new BadRequestException(
          `Discount amount ${value.toFixed(2)} exceeds line subtotal ${lineSubtotal.toFixed(2)}`,
        );
      }
      return this.roundToCents(value);
    }

    // PERCENT
    if (value < 0 || value > 100) {
      throw new BadRequestException(
        `Percent discount value must be between 0 and 100 (got ${value})`,
      );
    }
    return this.roundToCents((lineSubtotal * value) / 100);
  }

  /**
   * Compute line_total = (unit_price * quantity) - discount_amount,
   * rounded half-up to 2 decimals. Must match the formula enforced by
   * CHK_sale_lines_line_total exactly, or inserts/updates will fail.
   */
  private computeLineTotal(
    unitPrice: string,
    quantity: number,
    discountAmount: string,
  ): string {
    return this.roundToCents(
      Number(unitPrice) * quantity - Number(discountAmount),
    );
  }

  /**
   * Recompute Sale.subtotal, discount_total, and total from the actual
   * sale_lines rows and write them back to the Sale in one round trip.
   *
   * Called after every line mutation (add / update / remove). Recomputes
   * from source rather than doing incremental delta math — if our
   * arithmetic ever drifts due to a bug, the next mutation resets
   * everything to truth. Self-healing beats fast-but-wrong.
   *
   * total is recomputed as subtotal - discount_total + tax_total so the
   * formula still holds once tax lands in a later phase. tax_total,
   * amount_paid, and change_due are NOT touched by line mutations.
   *
   * COALESCE handles the "sale has zero lines" case (SUM returns NULL
   * on empty input, we need 0).
   *
   * Must be called inside a transaction — the caller is expected to
   * have already locked the sale row with pessimistic_write.
   */
  private async recomputeSaleTotals(
    manager: EntityManager,
    saleId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE sales
       SET subtotal = agg.subtotal,
           discount_total = agg.discount_total,
           total = agg.subtotal - agg.discount_total + sales.tax_total,
           updated_at = now()
       FROM (
         SELECT
           COALESCE(SUM(unit_price * quantity), 0) AS subtotal,
           COALESCE(SUM(discount_amount), 0) AS discount_total
         FROM sale_lines
         WHERE sale_id = $1
       ) agg
       WHERE sales.id = $1`,
      [saleId],
    );
  }
  /**
   * Recompute Sale.amount_paid and Sale.change_due from the actual
   * payments rows and write them back to the Sale in one round trip.
   *
   * Called after every payment mutation (add / update / remove).
   * Recomputes from source rather than incremental delta math — if our
   * arithmetic ever drifts due to a bug, the next mutation resets
   * everything to truth. Self-healing beats fast-but-wrong.
   *
   * Formulas:
   *   amount_paid = SUM(amount) across all payments
   *   change_due  = SUM(cash_received - amount) across CASH payments only
   *
   * The CHK_payments_cash_received_covers_amount constraint guarantees
   * cash_received >= amount for CASH rows, so change_due is always >= 0.
   * FILTER (WHERE payment_method = 'CASH') scopes the change sum to only
   * cash tenders — non-cash payments have cash_received IS NULL and
   * would otherwise poison the sum.
   *
   * subtotal, discount_total, total, and tax_total are NOT touched by
   * payment mutations. Different aggregate, different recompute helper.
   *
   * COALESCE handles the "sale has zero payments" case (SUM returns NULL
   * on empty input, we need 0).
   *
   * Must be called inside a transaction — the caller is expected to
   * have already locked the sale row with pessimistic_write.
   */
  private async recomputePaymentTotals(
    manager: EntityManager,
    saleId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE sales
       SET amount_paid = agg.amount_paid,
           change_due = agg.change_due,
           updated_at = now()
       FROM (
         SELECT
           COALESCE(SUM(amount), 0) AS amount_paid,
           COALESCE(
             SUM(cash_received - amount) FILTER (WHERE payment_method = 'CASH'),
             0
           ) AS change_due
         FROM payments
         WHERE sale_id = $1
       ) agg
       WHERE sales.id = $1`,
      [saleId],
    );
  }
  /**
   * Enforce cross-field payment invariants at the service. These rules
   * span method + amount + cash_received + reference — too complex for
   * DTO validators, too critical to leave to just the DB CHECKs.
   *
   * Rules:
   *   - CASH: cash_received required, must be >= amount
   *   - Non-CASH: cash_received forbidden (must be null)
   *   - Non-CASH: reference_number required (bank/provider reconciliation)
   *
   * The DB CHK_payments_cash_received_only_for_cash and
   * CHK_payments_cash_received_covers_amount backstop the CASH rules;
   * this method surfaces clean 400s with actionable messages instead of
   * letting the DB throw check violations as 500s.
   */
  /**
   * Assert the (method, amount, cash_received, reference_number) tuple
   * is internally consistent. CASH-specific rules (cash_received present
   * and covering amount), TRADE_IN-specific rules (no cash_received, no
   * reference_number), and non-CASH/non-TRADE_IN rules (no cash_received,
   * reference_number required).
   *
   * TRADE_IN's own required fields (product_id, imei, buying_price) are
   * validated separately by assertTradeInFieldsPresenceMatchesMethod
   * because they aren't part of this helper's narrow tuple signature.
   */
  private assertPaymentFieldsConsistent(
    method: PaymentMethod,
    amount: number,
    cashReceived: number | null,
    referenceNumber: string | null,
  ): void {
    if (method === PaymentMethod.CASH) {
      if (cashReceived === null) {
        throw new BadRequestException(
          'cash_received is required for CASH payments',
        );
      }
      if (cashReceived < amount) {
        throw new BadRequestException(
          `cash_received ${cashReceived.toFixed(2)} must be >= amount ${amount.toFixed(2)}`,
        );
      }
    } else if (method === PaymentMethod.TRADE_IN) {
      if (cashReceived !== null) {
        throw new BadRequestException(
          'cash_received must not be set for TRADE_IN payments',
        );
      }
      if (referenceNumber !== null) {
        throw new BadRequestException(
          'reference_number must not be set for TRADE_IN payments',
        );
      }
    } else {
      if (cashReceived !== null) {
        throw new BadRequestException(
          `cash_received must not be set for ${method} payments`,
        );
      }
      if (!referenceNumber) {
        throw new BadRequestException(
          `reference_number is required for ${method} payments`,
        );
      }
    }
  }

  /**
   * Guard the presence-shape of trade-in fields on an AddPaymentDto
   * against the payment method. Non-TRADE_IN payments MUST leave all
   * trade_in_* fields absent (sending them is a client-side bug).
   * TRADE_IN payments MUST include the required trio
   * (product_id, imei, buying_price); optional fields (selling_price,
   * notes) may be undefined.
   *
   * Pure shape check — no DB. Called AFTER assertPaymentFieldsConsistent
   * so the (method, amount, cash, ref) tuple is already validated by
   * the time we look at trade-in fields.
   *
   * The amount-matches-buying_price invariant (Q2) is checked by
   * assertTradeInAmountMatchesBuyingPrice — separate helper because
   * it needs the amount too and I want each helper to have one job.
   */
  private assertTradeInFieldsPresenceMatchesMethod(
    method: PaymentMethod,
    dto: AddPaymentDto,
  ): void {
    const trioPresent =
      dto.trade_in_product_id !== undefined ||
      dto.trade_in_imei !== undefined ||
      dto.trade_in_buying_price !== undefined;
    const auxPresent =
      dto.trade_in_selling_price !== undefined ||
      dto.trade_in_notes !== undefined;

    if (method !== PaymentMethod.TRADE_IN) {
      if (trioPresent || auxPresent) {
        throw new BadRequestException(
          `trade_in_* fields must not be set for ${method} payments`,
        );
      }
      return;
    }

    // method === TRADE_IN — required trio must be present.
    if (
      dto.trade_in_product_id === undefined ||
      dto.trade_in_imei === undefined ||
      dto.trade_in_buying_price === undefined
    ) {
      throw new BadRequestException(
        'TRADE_IN payments require trade_in_product_id, trade_in_imei, ' +
          'and trade_in_buying_price',
      );
    }
  }

  /**
   * Assert the payment amount equals the trade-in buying price to the
   * cent (Q2 lock). Compared on integer cents to avoid float
   * representation surprises, same pattern as completeSale's
   * amount_paid === total check.
   *
   * Only called when method === TRADE_IN; the DTO validator guarantees
   * both values are numbers with at most 2 decimal places by the time
   * we get here.
   */
  private assertTradeInAmountMatchesBuyingPrice(
    amount: number,
    buyingPrice: number,
  ): void {
    const amountCents = Math.round(amount * 100);
    const buyingCents = Math.round(buyingPrice * 100);
    if (amountCents !== buyingCents) {
      throw new BadRequestException(
        `TRADE_IN payment amount ${amount.toFixed(2)} must equal ` +
          `trade_in_buying_price ${buyingPrice.toFixed(2)}`,
      );
    }
  }

  /**
   * Enforce the updatePayment freeze rules for trade-ins (Q2 lock).
   *
   * - Any payment: trade_in_* fields are never patchable. UpdatePaymentDto
   *   doesn't declare them, so detection uses Object.hasOwn on the raw
   *   DTO (catches explicit nulls too). On non-TRADE_IN payments this
   *   also prevents the DB CHK_payments_trade_in_fields_null_when_not_trade_in
   *   from surfacing as a 500.
   * - TRADE_IN payments: amount, cash_received, and reference_number are
   *   frozen too. Only notes is editable. Renegotiating a trade-in means
   *   removing the payment and adding a new one.
   *
   * Declared fields use `!== undefined` rather than Object.hasOwn because
   * class-transformer may materialize absent optional properties as
   * own-undefined.
   */
  private assertNoTradeInFreezesViolated(
    payment: Payment,
    dto: UpdatePaymentDto,
  ): void {
    const tradeInFields = [
      'trade_in_product_id',
      'trade_in_imei',
      'trade_in_buying_price',
      'trade_in_selling_price',
      'trade_in_notes',
      'trade_in_phone_purchase_id',
    ];
    const smuggled = tradeInFields.filter((field) => Object.hasOwn(dto, field));
    if (smuggled.length > 0) {
      throw new BadRequestException(
        `${smuggled.join(', ')} cannot be updated; trade-in fields are ` +
          'frozen. Remove the payment and add a new one instead.',
      );
    }

    if (payment.payment_method !== PaymentMethod.TRADE_IN) {
      return;
    }

    const frozen = (
      ['amount', 'cash_received', 'reference_number'] as const
    ).filter((field) => dto[field] !== undefined);
    if (frozen.length > 0) {
      throw new BadRequestException(
        `${frozen.join(', ')} cannot be updated on a TRADE_IN payment; ` +
          'only notes is editable. Remove the payment and add a new one ' +
          'to renegotiate the trade-in.',
      );
    }
  }

  /**
   * Validate that a trade-in payment's product and IMEI references are
   * currently valid. Runs against the caller's transaction manager so
   * reads see the same consistent snapshot as the surrounding addPayment
   * work.
   *
   * Product must exist, belong to the sale's branch, and be serialized.
   * IMEI must not collide with any existing ProductUnit — 409 with the
   * same existing_unit payload shape as PhonePurchasesService and
   * ProductUnitsService.
   *
   * This is best-effort at addPayment time: a concurrent intake could
   * insert the same IMEI between this check and completeSale's
   * createForTradeIn. That race is the same one Slice E accepted for
   * outgoing serialized lines, arbitrated at complete-time by the
   * global unique index on product_units.imei.
   *
   * Duplicates the logic of PhonePurchasesService.assertProductReference
   * and .assertImeiAvailable — see the docstring on createForTradeIn
   * for the rationale (keeping those private on the phone-purchases
   * class rather than exposing them). FOLLOWUP: unify into a shared
   * serialized-inventory helper.
   */
  private async assertTradeInPaymentReferencesValid(
    manager: EntityManager,
    productId: string,
    imei: string,
    branchId: string,
  ): Promise<void> {
    // Product check
    const product = await manager.findOne(Product, {
      where: { id: productId },
    });
    if (!product) {
      throw new BadRequestException(
        `Trade-in product ${productId} not found or inactive`,
      );
    }
    if (product.branch_id !== branchId) {
      throw new BadRequestException(
        `Trade-in product ${productId} does not belong to branch ${branchId}`,
      );
    }
    if (!product.is_serialized) {
      throw new BadRequestException(
        `Trade-in product ${productId} is not a serialized SKU; ` +
          `trade-ins require is_serialized = true`,
      );
    }

    // IMEI availability (best-effort UX pre-check)
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

  /**
   * Compute the remaining balance on a sale: Sale.total - SUM(payments).
   *
   * `excludeAmount` (used by updatePayment) subtracts the current
   * payment's OLD amount from the sum before computing remaining, so
   * that "the amount I'm about to overwrite" doesn't count against me.
   * Without this, updating a Rs. 500 payment to Rs. 500 would fail
   * because SUM would already include the 500 being replaced.
   *
   * Returns a Number (not string) because the caller compares it against
   * the DTO's `amount: number`. Sale.total comes back as a string from
   * TypeORM (Postgres numeric), so we Number() it here.
   */
  private async remainingBalance(
    manager: EntityManager,
    saleId: string,
    saleTotal: string,
    excludeAmount = 0,
  ): Promise<number> {
    const result = await manager
      .createQueryBuilder(Payment, 'payment')
      .select('COALESCE(SUM(payment.amount), 0)', 'sum')
      .where('payment.sale_id = :saleId', { saleId })
      .getRawOne<{ sum: string }>();
    const paidSoFar = Number(result?.sum ?? 0) - excludeAmount;
    return Number(saleTotal) - paidSoFar;
  }

  /**
   * Guard for serialized in-house lines: assert the client didn't send
   * imei_snapshot on a non-serialized product line, and (for
   * external-sourced non-serialized) same rule.
   *
   * The three legal shapes (see Slice E Q1 CHECK constraint reasoning):
   *   Non-serialized (external or in-house): imei_snapshot MUST be null.
   *   Serialized in-house: imei_snapshot required (looked up as IMEI).
   *   Serialized external: imei_snapshot required (stored as free text).
   *
   * This method covers only the non-serialized rejection. The serialized
   * "required" checks live inside the mode-specific resolve helpers so
   * their error messages can be mode-specific.
   */
  private assertNoImeiOnNonSerializedLine(
    imeiSnapshot: string | null,
    productName: string,
  ): void {
    if (imeiSnapshot !== null) {
      throw new BadRequestException(
        `Product "${productName}" is not serialized; imei_snapshot must not be set`,
      );
    }
  }

  /**
   * Guard for external-sourced serialized lines: reject if the free-text
   * imei_snapshot happens to match a ProductUnit currently in IN_STOCK.
   *
   * Rationale (Slice E Q7): catches the specific inventory-drift failure
   * mode where a UI bug or misclick sets external_supplier_id on a line
   * that should be in-house. Without this check, the sale completes,
   * skips stock decrement AND skips PU flip — physical phone leaves the
   * shop but both stock and PU status say we still have it.
   *
   * Only IN_STOCK is diagnostic. SOLD/RETURNED/WRITTEN_OFF matches are
   * historical coincidences (or genuine IMEI-uniqueness violations
   * outside our control) and not something to block a sale on.
   *
   * Runs inside the caller's transaction, so the collision check and the
   * subsequent insert both see the same snapshot.
   */
  private async assertExternalSerializedImeiNotInStock(
    manager: EntityManager,
    imei: string,
  ): Promise<void> {
    const conflicting = await manager
      .createQueryBuilder(ProductUnit, 'unit')
      .where('unit.imei = :imei', { imei })
      .andWhere('unit.status = :status', {
        status: ProductUnitStatus.IN_STOCK,
      })
      .getOne();

    if (conflicting) {
      throw new ConflictException({
        message:
          `IMEI '${imei}' is currently in your stock (status: IN_STOCK). ` +
          `If you meant to sell your own inventory, remove external_supplier_id.`,
        existing_unit: {
          id: conflicting.id,
          product_id: conflicting.product_id,
          branch_id: conflicting.branch_id,
        },
      });
    }
  }

  /**
   * Resolve the ProductUnit for a serialized in-house sale line and
   * return the four snapshot values addLine needs: product_unit_id,
   * imei_snapshot (from the PU, not the client — PU is source of truth),
   * unit_price (PU.selling_price → Product.selling_price → 400), and
   * cost_price (always PU.buying_price, no fallback).
   *
   * Four failure modes per Slice E Q3:
   *   1. IMEI not found          → BadRequest 400 (payload-referenced entity)
   *   2. Product mismatch        → BadRequest 400 (payload integrity)
   *   3. Branch mismatch         → BadRequest 400 (payload integrity, NOT
   *                                Forbidden — the cashier is at their
   *                                own branch; the IMEI just isn't there)
   *   4. Non-IN_STOCK status     → Conflict 409 with existing_unit payload
   *                                (mirrors Slice D IMEI collision shape)
   *
   * Price fallback per Slice E Q6:
   *   PU.selling_price → Product.selling_price → 400 "no selling price set"
   *   Handles both used-phone (per-unit price required, Product has 0)
   *   and new-serialized-phone (Product list price is authoritative, PU
   *   price left null) cases correctly.
   *
   * cost_price is ALWAYS PU.buying_price. No fallback — used phones cost
   * varies per unit; averaging via Product.buying_price would corrupt
   * margin reports.
   *
   * Query is by imei alone (no product/branch/status filter) so we can
   * distinguish failure modes for actionable error messages. Runs inside
   * caller's transaction; no lock — the complete-time markSoldForSale
   * lock is the sole gate (Slice E Q5).
   */
  private async resolveInHouseSerializedLine(
    manager: EntityManager,
    saleBranchId: string,
    product: Product,
    imei: string,
  ): Promise<{
    productUnitId: string;
    imeiSnapshot: string;
    unitPrice: string;
    costPrice: string;
  }> {
    const unit = await manager.findOne(ProductUnit, {
      where: { imei },
    });

    // 1. Not found
    if (!unit) {
      throw new BadRequestException(`IMEI '${imei}' is not in stock`);
    }

    // 2. Product mismatch — payload integrity
    if (unit.product_id !== product.id) {
      throw new BadRequestException(
        `IMEI '${imei}' does not belong to product "${product.name}"`,
      );
    }

    // 3. Branch mismatch — payload integrity, not a cross-branch
    //    authorization issue (the cashier IS at their own branch).
    if (unit.branch_id !== saleBranchId) {
      throw new BadRequestException(
        `IMEI '${imei}' is not available at this branch`,
      );
    }

    // 4. Non-IN_STOCK — state conflict, structured payload
    if (unit.status !== ProductUnitStatus.IN_STOCK) {
      throw new ConflictException({
        message: `IMEI '${imei}' is not available (status: ${unit.status})`,
        existing_unit: {
          id: unit.id,
          status: unit.status,
          product_id: unit.product_id,
          branch_id: unit.branch_id,
        },
      });
    }

    // Price resolution: PU.selling_price → Product.selling_price → 400
    const unitPrice = unit.selling_price ?? product.selling_price ?? null;
    if (unitPrice === null) {
      throw new BadRequestException(
        `Cannot price IMEI '${imei}' — no selling price set on unit or product`,
      );
    }

    return {
      productUnitId: unit.id,
      imeiSnapshot: unit.imei, // PU is source of truth
      unitPrice,
      costPrice: unit.buying_price,
    };
  }
}
