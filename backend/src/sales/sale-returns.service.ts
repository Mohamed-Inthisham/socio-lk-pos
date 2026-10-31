import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { Sale } from './entities/sale.entity';
import { SaleLine } from './entities/sale-line.entity';
import { Payment } from './entities/payment.entity';
import { SaleReturn } from './entities/sale-return.entity';
import { SaleReturnLine } from './entities/sale-return-line.entity';
import { SaleRefund, RefundMethod } from './entities/sale-refund.entity';
import { SaleStatus } from './enums/sale-status.enum';
import { PaymentMethod } from './enums/payment-method.enum';
import { ReturnCondition } from './enums/return-condition.enum';
import { ReturnDisposition } from './enums/return-disposition.enum';
import { CreateSaleReturnDto } from './dto/create-sale-return.dto';
import { SalesService } from './sales.service';
import { refundShareCents, tradeInShareCents } from './return-math';
import { Stock } from '../stock/entities/stock.entity';
import { StockService } from '../stock/stock.service';
import {
  StockMovementReferenceType,
  StockMovementType,
} from '../stock/enums/stock-movement-type.enum';
import { lockInventoryRows } from '../stock/lock-inventory-rows';
import { assertDayOpen } from '../cash-days/day-gate';
import { ProductUnit } from '../product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../product-units/enums/product-unit-status.enum';
import { ProductUnitsService } from '../product-units/product-units.service';
import { SaleNumberCountersService } from '../sale-number-counters/sale-number-counters.service';
import { SaleNumberKind } from '../sale-number-counters/enums/sale-number-kind.enum';
import {
  ApprovalCaller,
  ApprovalsService,
  Approver,
} from '../approvals/approvals.service';
import { UserRole } from '../users/enums/user-role.enum';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { writeAuditEntry } from '../audit-log/utils/write-audit-entry';
import { fromCents, toCents } from '../common/utils/money';

/** What POST /sales/:id/returns answers: 201 when made, 200 on a resend. */
export interface CreateReturnResult {
  created: boolean;
  return_id: string;
  sale: Sale;
}

/** A phone waiting for inspection, with the return that brought it back. */
export interface InspectionRow {
  product_unit: {
    id: string;
    imei: string;
    product_name: string;
    product: { tracking_method: string };
  };
  return_id: string;
  return_number: string;
  sale_id: string;
  sale_number: string;
  returned_at: Date;
}

/** One returned line, as the checks worked it out. */
interface PlannedLine {
  line: SaleLine;
  quantity: number;
  disposition: ReturnDisposition;
  shareCents: number;
  outOfWarranty: boolean;
}

/** The return as the checks worked it out, before anything is written. */
interface ReturnPlan {
  lines: PlannedLine[];
  refundDueCents: number;
  refundTotalCents: number;
  outOfWarranty: boolean;
  payments: Payment[];
}

const CLIENT_REQUEST_ID_KEY = 'UQ_sale_returns_client_request_id';

/** True only for a clash on the till's client_request_id (P7-24). */
const isClientRequestIdClash = (err: unknown): boolean =>
  err instanceof QueryFailedError &&
  (err.driverError as { constraint?: string }).constraint ===
    CLIENT_REQUEST_ID_KEY;

/** 400 SALE_NOT_COMPLETED unless the sale is COMPLETED (R4, P7-12). */
const assertCompleted = (sale: Sale): void => {
  if (sale.status !== SaleStatus.COMPLETED) {
    throw new BadRequestException({
      message: `Cannot return items on a ${sale.status} sale. Only completed sales take returns.`,
      code: 'SALE_NOT_COMPLETED',
    });
  }
};

/**
 * Returns and refunds on completed sales (Phase 6.4 P7), and the list of
 * returned phones waiting for inspection. Planning doc section 8 "P7
 * decision log" is the reference; docs/backend/returns.md describes it.
 *
 * A return is checked in two passes over the same rules. The first runs
 * without locks, before the manager's PIN, so a return that can't go
 * through never spends a PIN attempt. The second runs inside the
 * return's transaction, under the sale row and the inventory locks, and
 * repeats every rule a concurrent request could change.
 */
@Injectable()
export class SaleReturnsService {
  constructor(
    @InjectRepository(Sale)
    private readonly salesRepository: Repository<Sale>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly salesService: SalesService,
    private readonly stockService: StockService,
    private readonly productUnitsService: ProductUnitsService,
    private readonly saleNumberCountersService: SaleNumberCountersService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  /**
   * POST /sales/:id/returns. In order (the R-numbers of the planning doc's
   * error table; P7-27, P7-34):
   *
   *   R2 404; R3 client_request_id already used (same sale and user: the
   *   recorded return, 200, nothing else checked, no PIN; otherwise 409);
   *   R4 not COMPLETED; R5 wrong branch; today's cash day open (409
   *   DAY_NOT_OPEN / DAY_CLOSED, P9-9); then the plan (R6 – R12, with the
   *   condition check after R6); then ApprovalsService.verify in its own
   *   committed transaction; then the return's transaction.
   *
   * A simultaneous second send of the same client_request_id on the same
   * sale waits on the sale lock and is answered as R3 from inside the
   * transaction; on another sale, the unique key catches it.
   */
  async createReturn(
    saleId: string,
    dto: CreateSaleReturnDto,
    requestedBy: ApprovalCaller,
    ip?: string | null,
  ): Promise<CreateReturnResult> {
    const sale = await this.salesRepository.findOne({ where: { id: saleId } });
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }

    if (
      requestedBy.role !== UserRole.ADMIN &&
      requestedBy.branch_id !== sale.branch_id
    ) {
      throw new ForbiddenException({
        message: 'You can only make returns on sales at your own branch.',
        code: 'RETURN_WRONG_BRANCH',
      });
    }

    const recorded = await this.findRecorded(
      this.dataSource.manager,
      saleId,
      dto.client_request_id,
      requestedBy,
    );
    if (recorded) return this.respond(false, saleId, recorded);

    assertCompleted(sale);
    // Today's cash day must be open (P9-9), so a closed or unopened day
    // never spends a PIN attempt; applyReturn checks again under its lock.
    await assertDayOpen(this.dataSource.manager, sale.branch_id, {
      lock: false,
    });
    await this.plan(this.dataSource.manager, sale, dto);

    const approver = await this.approvalsService.verify({
      approverId: dto.approval.approver_id,
      pin: dto.approval.pin,
      action: 'SALE_RETURN',
      branchId: sale.branch_id,
      requestedBy,
      ip,
    });

    let outcome: { created: boolean; returnId: string };
    try {
      outcome = await this.dataSource.transaction((manager) =>
        this.applyReturn(manager, saleId, dto, approver, requestedBy, ip),
      );
    } catch (err) {
      if (!isClientRequestIdClash(err)) throw err;
      // Sent at the same moment on another sale (or by another user):
      // the other request's return is committed, so R3 decides.
      const clash = await this.findRecorded(
        this.dataSource.manager,
        saleId,
        dto.client_request_id,
        requestedBy,
      );
      if (!clash) throw err;
      return this.respond(false, saleId, clash);
    }
    return this.respond(outcome.created, saleId, outcome.returnId);
  }

  /**
   * GET /sale-returns/inspection (P7-7, P7-33): the branch's phones in
   * INSPECTION, each with the latest return that brought it back (a unit
   * passed, sold again and returned again has several), oldest first.
   * Admins: any branch; managers: their own (403 otherwise).
   */
  async listInspection(
    caller: ApprovalCaller,
    branchId: string,
  ): Promise<InspectionRow[]> {
    if (caller.role !== UserRole.ADMIN && caller.branch_id !== branchId) {
      throw new ForbiddenException({
        message: 'You can only list phones to check at your own branch.',
        code: 'INSPECTION_WRONG_BRANCH',
      });
    }
    const rows: {
      unit_id: string;
      imei: string;
      product_name: string;
      tracking_method: string;
      return_id: string;
      return_number: string;
      sale_id: string;
      sale_number: string;
      returned_at: Date;
    }[] = await this.dataSource.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (u.id)
                u.id AS unit_id, u.imei, p.name AS product_name,
                p.tracking_method,
                r.id AS return_id, r.return_number,
                s.id AS sale_id, s.sale_number,
                r.created_at AS returned_at
           FROM product_units u
           JOIN products p ON p.id = u.product_id
           JOIN sale_return_lines rl
             ON rl.product_unit_id = u.id AND rl.disposition = $3
           JOIN sale_returns r ON r.id = rl.sale_return_id
           JOIN sales s ON s.id = r.sale_id
          WHERE u.branch_id = $1 AND u.status = $2
          ORDER BY u.id, r.created_at DESC
       ) latest
       ORDER BY returned_at ASC, unit_id ASC`,
      [branchId, ProductUnitStatus.INSPECTION, ReturnDisposition.INSPECTION],
    );
    return rows.map((row) => ({
      product_unit: {
        id: row.unit_id,
        imei: row.imei,
        product_name: row.product_name,
        product: { tracking_method: row.tracking_method },
      },
      return_id: row.return_id,
      return_number: row.return_number,
      sale_id: row.sale_id,
      sale_number: row.sale_number,
      returned_at: row.returned_at,
    }));
  }

  /**
   * R3 (P7-15, P7-24): the return already recorded with this
   * client_request_id, if it was this sale's and this user's; null when
   * the id is new. Another sale's or user's is 409, and nothing about
   * that return is revealed.
   */
  private async findRecorded(
    manager: EntityManager,
    saleId: string,
    clientRequestId: string,
    requestedBy: ApprovalCaller,
  ): Promise<string | null> {
    const existing = await manager.findOne(SaleReturn, {
      where: { client_request_id: clientRequestId },
      select: { id: true, sale_id: true, requested_by: true },
    });
    if (!existing) return null;
    if (
      existing.sale_id !== saleId ||
      existing.requested_by !== requestedBy.id
    ) {
      throw new ConflictException({
        message:
          'This return request id was already used for another return. ' +
          'Start the return again.',
        code: 'CLIENT_REQUEST_ID_CONFLICT',
      });
    }
    return existing.id;
  }

  private async respond(
    created: boolean,
    saleId: string,
    returnId: string,
  ): Promise<CreateReturnResult> {
    return {
      created,
      return_id: returnId,
      sale: await this.salesService.findOne(saleId),
    };
  }

  /**
   * The checks R6 – R12 (P7-27 between R6 and R7), in that order, and the
   * return they describe. Runs twice: before the PIN with the data
   * source's manager (no locks), and in the transaction under its locks,
   * where returned_quantity, the warranty date, prior refunds, a phone's
   * later acquisition and stock tracking may have moved on (P7-28, P7-29).
   * Writes nothing.
   */
  private async plan(
    manager: EntityManager,
    sale: Sale,
    dto: CreateSaleReturnDto,
  ): Promise<ReturnPlan> {
    const saleLines = await manager.find(SaleLine, {
      where: { sale_id: sale.id },
    });
    const byId = new Map(saleLines.map((line) => [line.id, line]));

    // R6: every line is this sale's.
    for (const req of dto.lines) {
      if (!byId.has(req.sale_line_id)) {
        throw new BadRequestException({
          message: "A line in this return isn't on this sale.",
          code: 'LINE_NOT_ON_SALE',
          sale_line_id: req.sale_line_id,
        });
      }
    }
    const requested = dto.lines.map((req) => ({
      req,
      line: byId.get(req.sale_line_id)!,
    }));

    // Condition (P7-27, P7-29): where each line goes. Another shop's line,
    // a phone and an untracked product take no condition; our tracked
    // non-phone items need one.
    const stockProductIds = [
      ...new Set(
        requested
          .filter(
            ({ line }) =>
              line.external_supplier_id === null &&
              line.product_unit_id === null,
          )
          .map(({ line }) => line.product_id),
      ),
    ];
    const stocks =
      stockProductIds.length > 0
        ? await manager.find(Stock, {
            where: {
              product_id: In(stockProductIds),
              branch_id: sale.branch_id,
            },
          })
        : [];
    const dispositions = requested.map(({ req, line }) => {
      let fixed: ReturnDisposition | null = null;
      if (line.external_supplier_id !== null) {
        fixed = ReturnDisposition.NOT_OUR_STOCK;
      } else if (line.product_unit_id !== null) {
        fixed = ReturnDisposition.INSPECTION;
      } else {
        const stock = stocks.find((s) => s.product_id === line.product_id);
        if (!stock) {
          throw new Error(
            `No Stock row for product ${line.product_id} at branch ` +
              `${sale.branch_id} (sale line ${line.id}). Data integrity ` +
              `issue — products get a stock row when created.`,
          );
        }
        if (!stock.manage_stock) fixed = ReturnDisposition.UNTRACKED;
      }
      if (fixed === null && !req.condition) {
        throw new BadRequestException({
          message:
            `"${line.product_name_snapshot}" needs a condition: ` +
            'RESALEABLE (back to stock) or DAMAGED.',
          code: 'RETURN_CONDITION_INVALID',
          sale_line_id: line.id,
        });
      }
      if (fixed !== null && req.condition) {
        throw new BadRequestException({
          message: `"${line.product_name_snapshot}" takes no condition (${fixed}).`,
          code: 'RETURN_CONDITION_INVALID',
          sale_line_id: line.id,
        });
      }
      return (
        fixed ??
        (req.condition === ReturnCondition.RESALEABLE
          ? ReturnDisposition.RESTOCKED
          : ReturnDisposition.DAMAGED)
      );
    });

    // R7: no more than is left to return.
    for (const { req, line } of requested) {
      const returnable = line.quantity - line.returned_quantity;
      if (req.quantity > returnable) {
        throw new ConflictException({
          message:
            `Only ${returnable} of "${line.product_name_snapshot}" can ` +
            'still be returned.',
          code: 'RETURN_QTY_EXCEEDED',
          sale_line_id: line.id,
          returnable,
        });
      }
    }

    // R8: a phone taken back later (buy-back) can't be returned (P7-13).
    const unitIds = requested
      .map(({ line }) => line.product_unit_id)
      .filter((id): id is string => id !== null);
    if (unitIds.length > 0) {
      const units = await manager.find(ProductUnit, {
        where: { id: In(unitIds) },
      });
      for (const unitId of unitIds) {
        const unit = units.find((u) => u.id === unitId);
        if (!unit || unit.status !== ProductUnitStatus.SOLD) {
          throw new Error(
            `ProductUnit ${unitId} is ${unit ? unit.status : 'missing'} ` +
              `on a COMPLETED sale's unreturned line, expected SOLD. The PU ` +
              `state machine was bypassed by an unknown code path.`,
          );
        }
        await this.productUnitsService.assertNotTakenBackForReturn(
          manager,
          unit,
        );
      }
    }

    // R9: within warranty (P7-22) is today in Colombo, by the database
    // clock, on or before warranty_until; NO_WARRANTY and CHECKING have
    // none. Outside needs the override reason (P7-23).
    const warranty: { id: string; within: boolean }[] = await manager.query(
      `SELECT id,
              (warranty_until IS NOT NULL
               AND (now() AT TIME ZONE 'Asia/Colombo')::date <= warranty_until)
                AS within
         FROM sale_lines
        WHERE id = ANY($1::uuid[])`,
      [requested.map(({ line }) => line.id)],
    );
    const outside = requested
      .filter(({ line }) => !warranty.find((w) => w.id === line.id)?.within)
      .map(({ line }) => line.id);
    if (outside.length > 0 && !dto.override_reason) {
      throw new BadRequestException({
        message:
          'An item is outside warranty: a manager or admin must give an ' +
          'override reason.',
        code: 'OVERRIDE_REASON_REQUIRED',
        sale_line_ids: outside,
      });
    }

    // R10 (P7-3, P7-28): never more than what was paid for these units.
    const lines: PlannedLine[] = requested.map(({ req, line }, i) => ({
      line,
      quantity: req.quantity,
      disposition: dispositions[i],
      shareCents: refundShareCents(
        toCents(line.line_total),
        line.quantity,
        line.returned_quantity,
        req.quantity,
      ),
      outOfWarranty: outside.includes(line.id),
    }));
    const refundDueCents = lines.reduce((sum, l) => sum + l.shareCents, 0);
    const refundTotalCents = dto.refunds.reduce(
      (sum, r) => sum + toCents(r.amount),
      0,
    );
    if (refundTotalCents > refundDueCents) {
      throw new BadRequestException({
        message: `The refunds add up to more than the LKR ${fromCents(refundDueCents)} due.`,
        code: 'REFUND_TOO_HIGH',
        refund_due: fromCents(refundDueCents),
      });
    }

    // R11 (P7-4): cash, or back to a non-cash payment of this sale with
    // the same method; never TRADE_IN.
    const payments = await manager.find(Payment, {
      where: { sale_id: sale.id },
    });
    for (const refund of dto.refunds) {
      const payment =
        refund.method === PaymentMethod.CASH
          ? null
          : payments.find((p) => p.id === refund.original_payment_id);
      const allowed =
        refund.method === PaymentMethod.CASH ||
        (refund.method !== PaymentMethod.TRADE_IN &&
          payment !== undefined &&
          payment !== null &&
          payment.payment_method === refund.method);
      if (!allowed) {
        throw new BadRequestException({
          message:
            'A refund goes back as cash, or to a card, bank transfer, Koko ' +
            'or Mintpay payment of this sale with the same method.',
          code: 'REFUND_METHOD_NOT_ALLOWED',
          method: refund.method,
          original_payment_id: refund.original_payment_id ?? null,
        });
      }
    }

    // R12 (P7-4): never more back to a payment than is left of it.
    const prior: { payment_id: string; refunded: string }[] =
      await manager.query(
        `SELECT f.original_payment_id AS payment_id,
                SUM(f.amount)::text AS refunded
           FROM sale_refunds f
           JOIN sale_returns r ON r.id = f.sale_return_id
          WHERE r.sale_id = $1 AND f.original_payment_id IS NOT NULL
          GROUP BY f.original_payment_id`,
        [sale.id],
      );
    const asked = new Map<string, number>();
    for (const refund of dto.refunds) {
      if (!refund.original_payment_id) continue;
      asked.set(
        refund.original_payment_id,
        (asked.get(refund.original_payment_id) ?? 0) + toCents(refund.amount),
      );
    }
    for (const [paymentId, askedCents] of asked) {
      const payment = payments.find((p) => p.id === paymentId)!;
      const already = toCents(
        prior.find((p) => p.payment_id === paymentId)?.refunded ?? 0,
      );
      const refundableCents = toCents(payment.amount) - already;
      if (askedCents > refundableCents) {
        throw new ConflictException({
          message: `Only LKR ${fromCents(refundableCents)} can still go back to that payment.`,
          code: 'REFUND_EXCEEDS_PAYMENT',
          payment_id: paymentId,
          refundable: fromCents(refundableCents),
        });
      }
    }

    return {
      lines,
      refundDueCents,
      refundTotalCents,
      outOfWarranty: outside.length > 0,
      payments,
    };
  }

  /**
   * The return's transaction, in the global lock order (docs/backend/
   * sales.md "Lock order"): the sale row; then every Stock row going back
   * to stock and every returned phone (lockInventoryRows); then today's
   * cash day FOR SHARE (assertDayOpen, P9-10); then the
   * re-checks (plan), the changes, the RET- number, the rows and the
   * RETURN audit row. The PIN was checked before it opened.
   */
  private async applyReturn(
    manager: EntityManager,
    saleId: string,
    dto: CreateSaleReturnDto,
    approver: Approver,
    requestedBy: ApprovalCaller,
    ip?: string | null,
  ): Promise<{ created: boolean; returnId: string }> {
    const sale = await manager
      .createQueryBuilder(Sale, 'sale')
      .setLock('pessimistic_write')
      .where('sale.id = :id', { id: saleId })
      .getOne();
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }

    // A second send that waited on the sale lock now sees the first one's
    // return: R3 answers it, and nothing is written.
    const recorded = await this.findRecorded(
      manager,
      saleId,
      dto.client_request_id,
      requestedBy,
    );
    if (recorded) return { created: false, returnId: recorded };

    assertCompleted(sale);

    // Lock targets come from fields frozen on a completed sale's lines.
    const conditions = new Map(
      dto.lines.map((req) => [req.sale_line_id, req.condition]),
    );
    const requested = await manager.find(SaleLine, {
      where: { sale_id: saleId, id: In([...conditions.keys()]) },
    });
    // Stock rows: a resaleable item's (it goes back to stock) and a phone's
    // (the ledger records its move to INSPECTION in that row's chain,
    // Phase 1 T1).
    await lockInventoryRows(manager, {
      stock: requested
        .filter(
          (line) =>
            line.external_supplier_id === null &&
            (line.product_unit_id !== null ||
              conditions.get(line.id) === ReturnCondition.RESALEABLE),
        )
        .map((line) => ({
          productId: line.product_id,
          branchId: sale.branch_id,
        })),
      unitIds: requested
        .map((line) => line.product_unit_id)
        .filter((id): id is string => id !== null),
    });

    // Today's cash day: FOR SHARE, lock-order step 4 (P9-10), then 409
    // DAY_NOT_OPEN / DAY_CLOSED (P9-9).
    await assertDayOpen(manager, sale.branch_id, { lock: true });

    const plan = await this.plan(manager, sale, dto);

    const returnNumber = await this.saleNumberCountersService.generateNext(
      sale.branch_id,
      manager,
      SaleNumberKind.RETURN,
    );

    const earlier: { total: string }[] = await manager.query(
      `SELECT COALESCE(SUM(refund_total), 0)::text AS total
         FROM sale_returns
        WHERE sale_id = $1`,
      [saleId],
    );
    const earlierRefundsCents = toCents(earlier[0].total);
    if (earlierRefundsCents + plan.refundTotalCents > toCents(sale.total)) {
      // Can't happen: every refund_share is a share of a line_total.
      throw new Error(
        `Refunds on sale ${saleId} would exceed its total ${sale.total}. ` +
          `Data integrity issue in the refund arithmetic.`,
      );
    }

    const overrideReason = plan.outOfWarranty ? dto.override_reason! : null;
    const saved = await manager.save(
      manager.create(SaleReturn, {
        return_number: returnNumber,
        sale_id: saleId,
        branch_id: sale.branch_id,
        reason: dto.reason,
        refund_due: fromCents(plan.refundDueCents),
        refund_total: fromCents(plan.refundTotalCents),
        out_of_warranty: plan.outOfWarranty,
        override_reason: overrideReason,
        approved_by: approver.id,
        requested_by: requestedBy.id,
        client_request_id: dto.client_request_id,
      }),
    );
    const savedLines = await manager.save(
      plan.lines.map((planned) =>
        manager.create(SaleReturnLine, {
          sale_return_id: saved.id,
          sale_line_id: planned.line.id,
          quantity: planned.quantity,
          refund_share: fromCents(planned.shareCents),
          out_of_warranty: planned.outOfWarranty,
          disposition: planned.disposition,
          product_unit_id:
            planned.disposition === ReturnDisposition.INSPECTION
              ? planned.line.product_unit_id
              : null,
        }),
      ),
    );

    // The inventory, after the return lines exist: the stock ledger
    // references each one (Phase 1 T1), with the requester and the
    // approver. All rows were locked above, so the order is free.
    for (const [index, planned] of plan.lines.entries()) {
      await manager.query(
        `UPDATE sale_lines
         SET returned_quantity = returned_quantity + $1,
             updated_at = now()
         WHERE id = $2`,
        [planned.quantity, planned.line.id],
      );
      const movement = {
        type: StockMovementType.CUSTOMER_RETURN,
        referenceType: StockMovementReferenceType.SALE_RETURN_LINE,
        referenceId: savedLines[index].id,
        createdById: requestedBy.id,
        approvedById: approver.id,
      };
      if (planned.disposition === ReturnDisposition.RESTOCKED) {
        await this.stockService.incrementForReversal(
          manager,
          planned.line.product_id,
          sale.branch_id,
          planned.quantity,
          movement,
        );
      } else if (planned.disposition === ReturnDisposition.INSPECTION) {
        const unitId = planned.line.product_unit_id!;
        await this.productUnitsService.markInspectionForReturn(manager, unitId);
        await this.stockService.recordUnitEvent(
          manager,
          planned.line.product_id,
          sale.branch_id,
          {
            ...movement,
            unit: {
              id: unitId,
              from: ProductUnitStatus.SOLD,
              to: ProductUnitStatus.INSPECTION,
            },
          },
        );
      }
    }
    // One at a time, stamped with clock_timestamp(): now() is the same for
    // the whole transaction, and GET /sales/:id lists refunds in the order
    // they were recorded.
    for (const refund of dto.refunds) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(SaleRefund)
        .values({
          sale_return_id: saved.id,
          method: refund.method as RefundMethod,
          amount: fromCents(toCents(refund.amount)),
          original_payment_id: refund.original_payment_id ?? null,
          reference_number: refund.reference_number ?? null,
          created_at: () => 'clock_timestamp()',
        })
        .execute();
    }

    const nonTradeInPaidCents = plan.payments
      .filter((p) => p.payment_method !== PaymentMethod.TRADE_IN)
      .reduce((sum, p) => sum + toCents(p.amount), 0);
    const tradeInCents = tradeInShareCents(
      plan.refundTotalCents,
      nonTradeInPaidCents,
      earlierRefundsCents,
    );
    await writeAuditEntry(manager, {
      actor: requestedBy,
      action: AuditAction.RETURN,
      entityType: 'Sale',
      entityId: saleId,
      description: this.describe(
        returnNumber,
        sale,
        approver,
        requestedBy,
        plan,
        dto,
        tradeInCents,
        overrideReason,
      ),
      changes: {
        approved_by: { old: null, new: approver.id },
        requested_by: { old: null, new: requestedBy.id },
        refund_due: { old: null, new: fromCents(plan.refundDueCents) },
        refund_total: { old: null, new: fromCents(plan.refundTotalCents) },
        out_of_warranty: { old: null, new: plan.outOfWarranty },
      },
      ip,
    });

    return { created: true, returnId: saved.id };
  }

  /** The RETURN audit row's description (P7-14, P7-35). Never the PIN. */
  private describe(
    returnNumber: string,
    sale: Sale,
    approver: Approver,
    requestedBy: ApprovalCaller,
    plan: ReturnPlan,
    dto: CreateSaleReturnDto,
    tradeInCents: number,
    overrideReason: string | null,
  ): string {
    const lines = plan.lines
      .map(
        (p) =>
          `${p.quantity} × ${p.line.product_name_snapshot}` +
          (p.line.imei_snapshot ? ` (IMEI ${p.line.imei_snapshot})` : '') +
          ` → ${p.disposition}`,
      )
      .join('; ');
    const refunds = dto.refunds
      .map((r) =>
        r.method === PaymentMethod.CASH
          ? `CASH ${fromCents(toCents(r.amount))}`
          : `${r.method} ${fromCents(toCents(r.amount))} ref ${r.reference_number}`,
      )
      .join('; ');
    return (
      `Return ${returnNumber} on ${sale.sale_number}: approved by ` +
      `${approver.full_name} (${approver.id}); requested by ` +
      `${requestedBy.full_name} (${requestedBy.id}). Lines: ${lines}. ` +
      `Refund LKR ${fromCents(plan.refundTotalCents)} of LKR ` +
      `${fromCents(plan.refundDueCents)} due` +
      (tradeInCents > 0
        ? `, includes LKR ${fromCents(tradeInCents)} from a trade-in`
        : '') +
      (refunds ? ` (${refunds})` : '') +
      `. Reason: ${dto.reason}` +
      (overrideReason ? `. Outside warranty: ${overrideReason}` : '')
    );
  }
}
