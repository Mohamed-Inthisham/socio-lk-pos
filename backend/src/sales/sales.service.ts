import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Sale } from './entities/sale.entity';
import { SaleLine } from './entities/sale-line.entity';
import { Payment } from './entities/payment.entity';
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
import { Branch } from '../branches/entities/branch.entity';
import { User } from '../users/entities/user.entity';
import { ProductsService } from '../products/products.service';
import { SuppliersService } from '../suppliers/suppliers.service';
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
  ) {}

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
   * Fetch one sale with nested branch + cashier + lines. Lines are
   * ordered by line_number ASC so the receipt/UI renders them in the
   * cashier's original ring-up order (gaps from removes are preserved).
   *
   * Payments will join here when Slice E lands.
   *
   * Throws 404 if the sale doesn't exist.
   */
  async findOne(id: string): Promise<Sale> {
    const sale = await this.salesRepository.findOne({
      where: { id },
      relations: ['branch', 'cashier', 'lines'],
      order: { lines: { line_number: 'ASC' } },
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
    if (dto.customer_id !== undefined) sale.customer_id = dto.customer_id;
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
   * POST /sales/:id/lines (wired in Slice D3).
   *
   * Workflow, all inside a single transaction with the sale row locked
   * pessimistic_write:
   *   1. Load + lock the parent sale, assert it's DRAFT
   *   2. Resolve the product (must exist, be active, belong to same branch)
   *   3. If external_supplier_id set, resolve the supplier (must exist + active)
   *   4. Compute next line_number as max + 1 within this sale
   *   5. Resolve discount_amount from the client's (type, value) input
   *   6. Compute line_total from the reconciliation formula
   *   7. Insert the line, snapshotting product identity + pricing
   *   8. Recompute sale totals from the resulting line set
   *
   * Snapshot columns (sku, name, unit_price, cost_price) are frozen from
   * the product at THIS moment. Later product edits do not retroactively
   * change what the customer was charged.
   *
   * Returns the freshly inserted line WITHOUT relations loaded — callers
   * that need the full nested shape can re-fetch. Keeps the transaction
   * short.
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

      // 3. Resolve external supplier if provided
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

      // 4. Assign line_number as max + 1 within this sale. The sale row
      // is locked, so concurrent adds on the same sale serialize here.
      const maxRow = await manager
        .createQueryBuilder(SaleLine, 'line')
        .select('COALESCE(MAX(line.line_number), 0)', 'max')
        .where('line.sale_id = :saleId', { saleId })
        .getRawOne<{ max: string }>();
      const nextLineNumber = Number(maxRow?.max ?? 0) + 1;

      // 5. Resolve discount amount from client input
      const discountType = dto.discount_type ?? null;
      const discountValue = dto.discount_value ?? null;
      const discountAmount = this.resolveDiscountAmount(
        product.selling_price,
        dto.quantity,
        discountType,
        discountValue,
      );

      // 6. Compute line_total (must match CHK_sale_lines_line_total exactly)
      const lineTotal = this.computeLineTotal(
        product.selling_price,
        dto.quantity,
        discountAmount,
      );

      // 7. Insert the line
      const line = manager.create(SaleLine, {
        sale_id: saleId,
        line_number: nextLineNumber,
        product_id: product.id,
        product_sku_snapshot: product.sku,
        product_name_snapshot: product.name,
        unit_price: product.selling_price,
        cost_price_snapshot: product.buying_price,
        quantity: dto.quantity,
        discount_type: discountType,
        discount_value:
          discountValue === null
            ? null
            : this.roundToCents(Number(discountValue)),
        discount_amount: discountAmount,
        line_total: lineTotal,
        external_supplier_id: dto.external_supplier_id ?? null,
        imei_snapshot: dto.imei_snapshot ?? null,
      });
      const saved = await manager.save(line);

      // 8. Recompute sale totals
      await this.recomputeSaleTotals(manager, saleId);

      return saved;
    });
  }

  /**
   * Update an existing line on a DRAFT sale. Called via
   * PATCH /sales/:saleId/lines/:lineId (wired in Slice D3).
   *
   * Updatable fields: quantity, discount (both type+value together),
   * external_supplier_id, imei_snapshot. Snapshot fields (sku, name,
   * unit_price, cost_price) and line_number are frozen — see
   * UpdateSaleLineDto for the reasoning.
   *
   * PATCH semantics: undefined = don't touch, null = clear (for
   * nullable fields), value = set.
   *
   * Discount is a two-field unit: both discount_type and discount_value
   * must be updated together (both to null to clear, or both to values).
   * Sending only one raises 400. This is enforced against the MERGED
   * state (existing + DTO) so a caller changing only the type of an
   * already-discounted line without touching the value would fail here —
   * intended, because "change type but keep value" is almost always a
   * mistake (percent 500 means something very different from amount 500).
   *
   * Runs inside a transaction with the parent sale row locked. Recomputes
   * sale totals from source at the end.
   */
  async updateLine(
    saleId: string,
    lineId: string,
    dto: UpdateSaleLineDto,
  ): Promise<SaleLine> {
    return this.dataSource.transaction(async (manager) => {
      // Load + lock the sale (same pattern as addLine)
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

      // Validate external supplier if being changed to a non-null value
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

      // Merge DTO onto current line state to get the "effective" values.
      // For each field: undefined means keep existing, otherwise apply.
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

      // If exactly one of the discount fields was touched, that's an
      // inconsistent update. Both together, or neither, are the only
      // valid options.
      if (discountTypeTouched !== discountValueTouched) {
        throw new BadRequestException(
          'discount_type and discount_value must be updated together',
        );
      }

      // Recompute discount_amount + line_total against the merged state.
      // unit_price never changes on update, so use line.unit_price.
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

      // 2. Validate method-specific rules against the proposed payment
      this.assertPaymentFieldsConsistent(
        dto.payment_method,
        dto.amount,
        dto.cash_received ?? null,
        dto.reference_number ?? null,
      );

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

      // 4. Insert
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
}
