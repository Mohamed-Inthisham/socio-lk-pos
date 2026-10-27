import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ProductUnitStatus } from './enums/product-unit-status.enum';
import { ProductUnit } from './entities/product-unit.entity';
import { TrackingMethod } from '../products/enums/tracking-method.enum';
import { ListProductUnitsQueryDto } from './dto/list-product-units-query.dto';
import { isLiveImeiConflict } from './live-imei';
import {
  paginate,
  PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import { StockService } from '../stock/stock.service';
import { lockInventoryRows } from '../stock/lock-inventory-rows';
import { UserRole } from '../users/enums/user-role.enum';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import {
  AuditActor,
  writeAuditEntry,
} from '../audit-log/utils/write-audit-entry';

/**
 * Relations eagerly hydrated on findOne / findAll. Includes the parent
 * Product, Branch, and PhonePurchase (with its customer, so admins can
 * see who we bought the phone from without a second lookup).
 */
const PRODUCT_UNIT_RELATIONS = [
  'product',
  'branch',
  'phone_purchase',
  'phone_purchase.customer',
  'sale_lines',
  'sale_lines.sale',
] as const;

/**
 * Why a void is blocked by a later transaction (Phase 6.4 P6-22), sent as
 * `reason` on the void 409s so the till can word it and link the sale:
 * - RESOLD: this sale's trade-in phone was sold on a later sale.
 * - TAKEN_BACK_ON_SALE: a phone this sale sold was traded back in on a
 *   later sale.
 * - BOUGHT_BACK_ON_PURCHASE: a phone this sale sold was bought back on a
 *   later phone purchase. Permanent: a purchase is never reversed.
 * null when only the live-IMEI index saw the later acquisition (a race).
 */
export type VoidBlockReason =
  | 'RESOLD'
  | 'TAKEN_BACK_ON_SALE'
  | 'BOUGHT_BACK_ON_PURCHASE';

/** The later sale a void 409 points at: void it first. */
type LaterSale = { id: string; sale_number: string };

/** 409 NOT_IN_INSPECTION unless the unit is waiting for a check (P7-7). */
const assertInInspection = (unit: ProductUnit, identifierLabel = 'IMEI'): void => {
  if (unit.status !== ProductUnitStatus.INSPECTION) {
    throw new ConflictException({
      message:
        `This item (${identifierLabel} ${unit.imei}) is not waiting for inspection ` +
        `(status: ${unit.status}).`,
      code: 'NOT_IN_INSPECTION',
      status: unit.status,
    });
  }
};

@Injectable()
export class ProductUnitsService {
  constructor(
    @InjectRepository(ProductUnit)
    private readonly productUnitsRepository: Repository<ProductUnit>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly stockService: StockService,
  ) {}

  /**
   * Paginated list of ProductUnits with optional filters.
   * Admin/Manager only per Q6 decision — cashiers interact with
   * ProductUnits implicitly via IMEI at ring-up (Slice E), not
   * through browse.
   *
   * Sorted by created_at DESC (newest first).
   */
  async findAll(
    query: ListProductUnitsQueryDto,
  ): Promise<PaginatedResponse<ProductUnit>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.productUnitsRepository
      .createQueryBuilder('unit')
      .leftJoinAndSelect('unit.product', 'product')
      .leftJoinAndSelect('unit.branch', 'branch')
      .leftJoinAndSelect('unit.phone_purchase', 'phone_purchase')
      .leftJoinAndSelect('phone_purchase.customer', 'customer')
      .leftJoinAndSelect('unit.sale_lines', 'sale_line')
      .leftJoinAndSelect('sale_line.sale', 'sale');

    if (query.productId) {
      qb.andWhere('unit.product_id = :productId', {
        productId: query.productId,
      });
    }
    if (query.branchId) {
      qb.andWhere('unit.branch_id = :branchId', {
        branchId: query.branchId,
      });
    }
    if (query.status) {
      qb.andWhere('unit.status = :status', { status: query.status });
    }
    if (query.imei) {
      qb.andWhere('unit.imei = :imei', { imei: query.imei });
    }

    qb.orderBy('unit.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, page, limit);
  }

  /**
   * Get one ProductUnit by ID with all relations hydrated.
   * NotFound if the ID doesn't exist.
   */
  async findOne(id: string): Promise<ProductUnit> {
    const unit = await this.productUnitsRepository.findOne({
      where: { id },
      relations: [...PRODUCT_UNIT_RELATIONS],
    });
    if (!unit) {
      throw new NotFoundException('Product unit not found');
    }
    return unit;
  }

  /**
   * POST /product-units/:id/inspection-pass (Phase 6.4 P7-7): a returned
   * phone checked and found without fault goes back on sale. INSPECTION →
   * IN_STOCK, stock +1, audited (INSPECTION_PASSED). A faulty phone stays
   * in INSPECTION until the supplier-receiving phase.
   *
   * 1. Checks without locks, so a pass that can't happen changes nothing:
   *    404 unknown unit; 403 INSPECTION_WRONG_BRANCH for a manager of
   *    another branch (admins: any branch); 409 NOT_IN_INSPECTION.
   * 2. One transaction, in the global lock order (lockInventoryRows):
   *    the unit's Stock row, then the unit. Re-check INSPECTION under the
   *    lock (a second pass at the same moment gets the same 409), flip
   *    the status, add the phone back to stock, write the audit row.
   *
   * Returns the unit as GET /product-units/:id does.
   */
  async passInspection(
    id: string,
    user: AuditActor & { role: UserRole; branch_id: string | null },
    ip?: string | null,
  ): Promise<ProductUnit> {
    const unit = await this.productUnitsRepository.findOne({
      where: { id },
      relations: ['product'],
    });
    if (!unit) {
      throw new NotFoundException('Product unit not found');
    }
    const identifierLabel =
      unit.product?.tracking_method === TrackingMethod.SERIAL_NUMBER
        ? 'Serial number'
        : 'IMEI';
    if (user.role !== UserRole.ADMIN && user.branch_id !== unit.branch_id) {
      throw new ForbiddenException({
        message: 'You can only pass inspection for phones at your own branch.',
        code: 'INSPECTION_WRONG_BRANCH',
      });
    }
    assertInInspection(unit, identifierLabel);

    await this.dataSource.transaction(async (manager) => {
      await lockInventoryRows(manager, {
        stock: [{ productId: unit.product_id, branchId: unit.branch_id }],
        unitIds: [unit.id],
      });
      const locked = await manager.findOneOrFail(ProductUnit, {
        where: { id },
      });
      assertInInspection(locked, identifierLabel);

      await manager.query(
        `UPDATE product_units
         SET status = $1,
             updated_at = now()
         WHERE id = $2`,
        [ProductUnitStatus.IN_STOCK, id],
      );
      await this.stockService.incrementForReversal(
        manager,
        unit.product_id,
        unit.branch_id,
        1,
      );
      await writeAuditEntry(manager, {
        actor: user,
        action: AuditAction.INSPECTION_PASSED,
        entityType: 'ProductUnit',
        entityId: id,
        description:
          `Inspection passed: ${identifierLabel} ${unit.imei}` +
          (unit.product ? ` (${unit.product.name})` : '') +
          ` back in stock`,
        changes: {
          status: {
            old: ProductUnitStatus.INSPECTION,
            new: ProductUnitStatus.IN_STOCK,
          },
        },
        ip,
      });
    });

    return this.findOne(id);
  }

  /**
   * Flip a ProductUnit from IN_STOCK to SOLD as part of a larger
   * transaction (typically SalesService.completeSale). Enlists in the
   * caller's EntityManager so that if the outer transaction rolls back
   * — for any reason, including a later line failing or the sale
   * COMPLETE UPDATE itself failing — this status flip rolls back with
   * it. Never opens its own transaction.
   *
   * Behavior:
   *   - If no ProductUnit row exists for `unitId`: raw Error → 500. The
   *     caller (completeSale) got this ID from a SaleLine.product_unit_id
   *     that was validated at addLine time. Its absence at complete time
   *     means the row was deleted out from under us, which the RESTRICT
   *     FK explicitly prevents. Fail loudly — this is data integrity,
   *     not business.
   *
   *   - If status is not IN_STOCK: throw 409 ConflictException with a
   *     structured payload (existing_unit: {id, status, product_id,
   *     branch_id}) mirroring Slice D's IMEI-collision shape. This is
   *     the cross-DRAFT race outcome — two DRAFT sales both referenced
   *     this PU (allowed at addLine per Q5), the first to complete
   *     wins, the second gets this error. Message includes the current
   *     status so the frontend can render actionable feedback.
   *
   *   - Otherwise: UPDATE product_units SET status = SOLD, updated_at = now().
   *
   * Concurrency:
   *   We SELECT ... FOR UPDATE the PU row first. Serializes concurrent
   *   flips of the same PU (which would only happen under the very
   *   narrow cross-DRAFT-race window). The loser waits, re-reads under
   *   lock, sees status = SOLD, and gets the 409.
   *
   * Must be called inside a transaction; will throw if `manager` is
   * outside one (TypeORM's setLock enforces this).
   */
  async markSoldForSale(manager: EntityManager, unitId: string): Promise<void> {
    const unit = await manager
      .createQueryBuilder(ProductUnit, 'unit')
      .setLock('pessimistic_write')
      .where('unit.id = :unitId', { unitId })
      .getOne();

    if (!unit) {
      // Data integrity failure — a SaleLine's product_unit_id FK to a
      // row that no longer exists means the RESTRICT FK was bypassed.
      throw new Error(
        `ProductUnit ${unitId} not found at complete time. ` +
          `This indicates a data integrity issue — the RESTRICT FK on ` +
          `sale_lines.product_unit_id should prevent this.`,
      );
    }

    if (unit.status !== ProductUnitStatus.IN_STOCK) {
      throw new ConflictException({
        message:
          `Cannot sell unit identifier '${unit.imei}': status is ${unit.status}, ` +
          `expected IN_STOCK. Another sale may have completed with this ` +
          `unit while yours was being drafted.`,
        existing_unit: {
          id: unit.id,
          status: unit.status,
          product_id: unit.product_id,
          branch_id: unit.branch_id,
        },
      });
    }

    await manager
      .createQueryBuilder()
      .update(ProductUnit)
      .set({ status: ProductUnitStatus.SOLD })
      .where('id = :id', { id: unit.id })
      .execute();
  }

  /**
   * Reverse markSoldForSale: flip a ProductUnit from SOLD back to
   * IN_STOCK as part of a larger transaction (typically
   * SalesService.voidSale). Symmetric to StockService.incrementForReversal.
   *
   * Behavior:
   *   - If no ProductUnit row exists for `unitId`: raw Error → 500,
   *     same reasoning as markSoldForSale (FK RESTRICT prevents deletion).
   *
   *   - If status is not SOLD: raw Error → 500. A COMPLETED sale being
   *     voided MUST have every serialized in-house line's PU in SOLD
   *     status, because completeSale flipped them all at complete time.
   *     Any other status here means someone bypassed the flow (admin
   *     hand-edit? separate return endpoint we haven't built yet?). We
   *     don't have a business path that legitimately produces this, so
   *     fail loudly — the operator needs to see this in the logs.
   *
   *   - If the same IMEI was acquired again after this sale (buy-back:
   *     a NEWER unit row exists that isn't RETURNED): 409 with that
   *     unit as existing_unit. The phone is no longer the voided
   *     customer's to return — it's back in our stock, or sold on. The
   *     operator voids the later sale first (mirrors the Q7 resale rule
   *     in markReturnedForVoid). A newer RETURNED row means that later
   *     trade-in was itself voided, so the chain is clear.
   *
   *   - Otherwise: UPDATE product_units SET status = IN_STOCK, updated_at = now().
   *     A concurrent re-acquisition between the check and the UPDATE
   *     hits uq_product_units_imei_live and is mapped to the same 409.
   *
   * Note: does NOT transition to RETURNED or INSPECTION. A customer
   * physically returning the phone is a return, not a void: P7 returns
   * (step 0b) move it SOLD → INSPECTION (Phase 6.4 P7-6), and a sale with
   * a return can't be voided (P7-11).
   *
   * Concurrency: same setLock pattern as markSoldForSale.
   *
   * Must be called inside a transaction.
   */
  async markAvailableForReversal(
    manager: EntityManager,
    unitId: string,
  ): Promise<void> {
    const unit = await manager
      .createQueryBuilder(ProductUnit, 'unit')
      .setLock('pessimistic_write')
      .where('unit.id = :unitId', { unitId })
      .getOne();

    if (!unit) {
      throw new Error(
        `ProductUnit ${unitId} not found at void time. ` +
          `This indicates a data integrity issue — stock and PU rows ` +
          `for voided sale lines must exist at void time.`,
      );
    }

    if (unit.status !== ProductUnitStatus.SOLD) {
      // A COMPLETED sale's PU MUST be SOLD at void time. Any other
      // status means the state machine was bypassed.
      throw new Error(
        `ProductUnit ${unitId} has status ${unit.status} at void time, ` +
          `expected SOLD. The PU state machine was bypassed by an ` +
          `unknown code path.`,
      );
    }

    const reacquired = await this.findLaterAcquisition(manager, unit);
    if (reacquired) {
      throw await this.reacquiredConflict(manager, unit.imei, reacquired);
    }

    try {
      await manager
        .createQueryBuilder()
        .update(ProductUnit)
        .set({ status: ProductUnitStatus.IN_STOCK })
        .where('id = :id', { id: unit.id })
        .execute();
    } catch (err) {
      if (isLiveImeiConflict(err)) {
        throw await this.reacquiredConflict(manager, unit.imei, null);
      }
      throw err;
    }
  }

  /**
   * 409 for voiding a sale whose phone was acquired again later, with
   * `imei`, `reason` and `later_sale` (Phase 6.4 P6-22). The later unit's
   * phone purchase tells which: a TRADE_IN payment stamped with it means a
   * later sale took the phone back (void that sale first); none means an
   * outright phone purchase, which blocks the void for good (later_sale
   * null).
   *
   * `later` is null when the re-acquisition raced the void (only the
   * unique index saw it, and the aborted transaction can't be queried):
   * the generic message, with reason and later_sale null. A later unit
   * without a phone purchase can't happen (every unit comes from one) and
   * gets the same generic answer.
   */
  private async reacquiredConflict(
    manager: EntityManager,
    imei: string,
    later: ProductUnit | null,
  ): Promise<ConflictException> {
    const { reason, laterSale } = await this.laterAcquisitionDetail(
      manager,
      later,
    );

    return new ConflictException({
      message:
        reason === 'BOUGHT_BACK_ON_PURCHASE'
          ? `This sale can't be voided: the phone (IMEI ${imei}) was ` +
            `bought back on a later purchase.`
          : `Cannot void this sale: the phone (IMEI '${imei}') was taken ` +
            `back into stock on a later sale or purchase. Void that sale ` +
            `first, or contact an administrator.`,
      imei,
      reason,
      later_sale: laterSale,
      existing_unit: later && {
        id: later.id,
        status: later.status,
        product_id: later.product_id,
        branch_id: later.branch_id,
      },
    });
  }

  /**
   * A newer acquisition of the same IMEI that isn't RETURNED (buy-back):
   * the phone came back into the shop after `unit` was sold, on a later
   * sale's trade-in or a phone purchase. null when there is none. A newer
   * RETURNED row means that later trade-in was itself voided.
   */
  private findLaterAcquisition(
    manager: EntityManager,
    unit: ProductUnit,
  ): Promise<ProductUnit | null> {
    return manager
      .createQueryBuilder(ProductUnit, 'later')
      .where('later.imei = :imei', { imei: unit.imei })
      .andWhere('later.id != :id', { id: unit.id })
      .andWhere('later.created_at > :createdAt', {
        createdAt: unit.created_at,
      })
      .andWhere('later.status != :returned', {
        returned: ProductUnitStatus.RETURNED,
      })
      .orderBy('later.created_at', 'DESC')
      .getOne();
  }

  /**
   * How a later acquisition happened (P6-22): a TRADE_IN payment stamped
   * with its phone purchase means a later sale took the phone back; none
   * means an outright phone purchase. Both null when `later` is null (a
   * race only the unique index saw) or has no phone purchase.
   */
  private async laterAcquisitionDetail(
    manager: EntityManager,
    later: ProductUnit | null,
  ): Promise<{ reason: VoidBlockReason | null; laterSale: LaterSale | null }> {
    if (!later?.phone_purchase_id) return { reason: null, laterSale: null };
    const rows: LaterSale[] = await manager.query(
      `SELECT s.id, s.sale_number
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
        WHERE p.trade_in_phone_purchase_id = $1
        LIMIT 1`,
      [later.phone_purchase_id],
    );
    const laterSale = rows[0] ?? null;
    return {
      reason: laterSale ? 'TAKEN_BACK_ON_SALE' : 'BOUGHT_BACK_ON_PURCHASE',
      laterSale,
    };
  }

  /**
   * 409 PHONE_TAKEN_BACK for returning a phone that came back into the
   * shop after this sale (Phase 6.4 P7-13): the customer no longer has it
   * to return. `reason` and `later_sale` as on the void 409 (P6-22); both
   * null when only the live-IMEI index saw the later acquisition.
   */
  private async takenBackConflict(
    manager: EntityManager,
    imei: string,
    later: ProductUnit | null,
  ): Promise<ConflictException> {
    const { reason, laterSale } = await this.laterAcquisitionDetail(
      manager,
      later,
    );
    const how =
      reason === 'BOUGHT_BACK_ON_PURCHASE'
        ? 'it was bought back on a later purchase'
        : reason === 'TAKEN_BACK_ON_SALE'
          ? `it was traded back in on ${laterSale!.sale_number}`
          : 'it was taken back into stock on a later sale or purchase';
    return new ConflictException({
      message: `This phone (IMEI ${imei}) can't be returned on this sale: ${how}.`,
      code: 'PHONE_TAKEN_BACK',
      imei,
      reason,
      later_sale: laterSale,
    });
  }

  /**
   * The return's "taken back later" check (P7-13), without a change:
   * SaleReturnsService runs it before the approval PIN, and
   * markInspectionForReturn runs it again under the unit's lock.
   */
  async assertNotTakenBackForReturn(
    manager: EntityManager,
    unit: ProductUnit,
  ): Promise<void> {
    const later = await this.findLaterAcquisition(manager, unit);
    if (later) {
      throw await this.takenBackConflict(manager, unit.imei, later);
    }
  }

  /**
   * A customer returns a phone this sale sold (Phase 6.4 P7-6): SOLD →
   * INSPECTION, inside the return's transaction (the caller locked the
   * unit through lockInventoryRows). The same unit row is reused; stock
   * doesn't move until the phone passes inspection.
   *
   *   - Missing unit, or not SOLD: raw Error (500). The return checked
   *     returned_quantity first, so a sold line's unit is always SOLD
   *     here; anything else means the state machine was bypassed.
   *   - Taken back on a later sale or purchase: 409 PHONE_TAKEN_BACK.
   *     A concurrent take-back caught only by uq_product_units_imei_live
   *     gets the same 409 with reason and later_sale null.
   *
   * Must be called inside a transaction.
   */
  async markInspectionForReturn(
    manager: EntityManager,
    unitId: string,
  ): Promise<void> {
    const unit = await manager
      .createQueryBuilder(ProductUnit, 'unit')
      .setLock('pessimistic_write')
      .where('unit.id = :unitId', { unitId })
      .getOne();

    if (!unit) {
      throw new Error(
        `ProductUnit ${unitId} not found at return time. ` +
          `This indicates a data integrity issue — the RESTRICT FK on ` +
          `sale_lines.product_unit_id should prevent this.`,
      );
    }
    if (unit.status !== ProductUnitStatus.SOLD) {
      throw new Error(
        `ProductUnit ${unitId} has status ${unit.status} at return time, ` +
          `expected SOLD. The PU state machine was bypassed by an ` +
          `unknown code path.`,
      );
    }

    await this.assertNotTakenBackForReturn(manager, unit);

    try {
      await manager.query(
        `UPDATE product_units
         SET status = $1,
             updated_at = now()
         WHERE id = $2`,
        [ProductUnitStatus.INSPECTION, unit.id],
      );
    } catch (err) {
      if (isLiveImeiConflict(err)) {
        throw await this.takenBackConflict(manager, unit.imei, null);
      }
      throw err;
    }
  }

  /**
   * Flip a ProductUnit from IN_STOCK to RETURNED as part of voiding a
   * sale that had a TRADE_IN payment. Enlists in the caller's
   * EntityManager (typically SalesService.voidSale) so any downstream
   * failure rolls it back with the rest of the void transaction. Never
   * opens its own transaction.
   *
   * This is the third variant in the mark* family, with a hybrid error
   * shape drawn from both siblings:
   *
   *   - IN_STOCK: happy path, flip to RETURNED and return the unit.
   *
   *   - SOLD: business-legit conflict. The trade-in phone was intook
   *     via this sale's createForTradeIn, but has since been sold on a
   *     SUBSEQUENT sale. Voiding this sale would leave the ledger
   *     inconsistent (this sale VOIDED "returning" a phone that's now
   *     with another customer via the newer sale). Throw
   *     ConflictException with a structured payload mirroring
   *     markSoldForSale's shape, so voidSale can surface a clear 409
   *     to the operator: "void the subsequent sale first." The payload
   *     names that sale (`later_sale`, reason RESOLD; Phase 6.4 P6-22).
   *
   *   - RETURNED or WRITTEN_OFF: integrity error, raw 500. A
   *     COMPLETED sale being voided should NEVER have its trade-in
   *     PU in RETURNED (double-void?) or WRITTEN_OFF (some path we
   *     don't have yet). Fail loudly.
   *
   *   - Missing PU: integrity error, raw 500. FK RESTRICT should
   *     prevent this.
   *
   * Return value: the ProductUnit (deliberately diverges from the
   * void-returning siblings — the caller needs product_id and branch_id
   * for the paired stockService.decrementForVoidedTradeIn call, and a
   * second read to hydrate them would be wasteful).
   *
   * Note: this is the only path that transitions a PU to RETURNED
   * ("trade-in reversed; the phone is back with the customer"). A
   * customer bringing a sold phone back for a refund is a different
   * flow: P7 returns (step 0b) move it SOLD → INSPECTION, a live status,
   * and passInspection moves it on to IN_STOCK (Phase 6.4 P7-6, P7-7).
   *
   * Concurrency: same setLock pattern as the siblings. Serializes
   * concurrent operations on the same PU (e.g. two operators trying
   * to void two different sales that both touch this PU).
   *
   * Must be called inside a transaction.
   */
  async markReturnedForVoid(
    manager: EntityManager,
    unitId: string,
  ): Promise<ProductUnit> {
    const unit = await manager
      .createQueryBuilder(ProductUnit, 'unit')
      .setLock('pessimistic_write')
      .where('unit.id = :unitId', { unitId })
      .getOne();

    if (!unit) {
      // Data integrity failure — FK RESTRICT prevents deletion.
      throw new Error(
        `ProductUnit ${unitId} not found at trade-in-void time. ` +
          `This indicates a data integrity issue — the RESTRICT FK on ` +
          `product_units.phone_purchase_id should prevent this.`,
      );
    }

    if (unit.status === ProductUnitStatus.SOLD) {
      // Business-legit: the trade-in phone was resold before this void.
      // Block-the-void per Q7. Operator must void the subsequent sale
      // first, so the 409 names it (P6-22): the most recently completed
      // sale with a line on this unit.
      const rows: LaterSale[] = await manager.query(
        `SELECT s.id, s.sale_number
           FROM sale_lines l
           JOIN sales s ON s.id = l.sale_id
          WHERE l.product_unit_id = $1
            AND s.status = 'COMPLETED'
          ORDER BY s.completed_at DESC
          LIMIT 1`,
        [unit.id],
      );
      throw new ConflictException({
        message:
          `Cannot void this sale: trade-in phone (IMEI '${unit.imei}') ` +
          `has been resold in a subsequent sale. Void the subsequent ` +
          `sale first, or contact an administrator.`,
        imei: unit.imei,
        reason: 'RESOLD' satisfies VoidBlockReason,
        later_sale: rows[0] ?? null,
        existing_unit: {
          id: unit.id,
          status: unit.status,
          product_id: unit.product_id,
          branch_id: unit.branch_id,
        },
      });
    }

    if (unit.status !== ProductUnitStatus.IN_STOCK) {
      // RETURNED or WRITTEN_OFF at void time is state-machine bypass.
      // A COMPLETED sale's trade-in PU MUST be IN_STOCK (its
      // createForTradeIn created it that way) or SOLD (handled above).
      // Anything else means an unknown code path touched it.
      throw new Error(
        `ProductUnit ${unitId} has status ${unit.status} at ` +
          `trade-in-void time, expected IN_STOCK or SOLD. The PU state ` +
          `machine was bypassed by an unknown code path.`,
      );
    }

    await manager
      .createQueryBuilder()
      .update(ProductUnit)
      .set({ status: ProductUnitStatus.RETURNED })
      .where('id = :id', { id: unit.id })
      .execute();

    // Return the (pre-update) unit so the caller has product_id and
    // branch_id for the paired stockService.decrementForVoidedTradeIn.
    // The status field on the returned object is stale (still IN_STOCK)
    // — the caller must not rely on it. Callers today (voidSale) only
    // read product_id/branch_id, so this is safe.
    return unit;
  }
}
