import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { CashDay } from './entities/cash-day.entity';
import { OpenCashDayDto } from './dto/open-cash-day.dto';
import { CloseCashDayDto } from './dto/close-cash-day.dto';
import { ListCashDaysQueryDto } from './dto/list-cash-days-query.dto';
import {
  CashDayBreakdown,
  MethodTotalRow,
  centsByMethod,
  describeDifference,
  expectedCents,
  settleReason,
  tenderTotals,
} from './cash-day-math';
import { Branch } from '../branches/entities/branch.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { PaymentMethod } from '../sales/enums/payment-method.enum';
import { readDraftSnapshots } from '../sales/draft-snapshot';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { writeAuditEntry } from '../audit-log/utils/write-audit-entry';
import { fromCents, toCents } from '../common/utils/money';
import { formatColomboTime } from '../common/utils/colombo-time';
import {
  PaginatedResponse,
  paginate,
} from '../common/dto/paginated-response.dto';

/** The session user, as the cash day needs it (AuthenticatedUser fits). */
export interface CashDayCaller {
  id: string;
  full_name: string;
  role: UserRole;
  branch_id: string | null;
}

export interface PersonRef {
  id: string;
  full_name: string;
}

/** A cash day as the API answers it: money as 2-decimal strings. */
export interface CashDayView {
  id: string;
  branch_id: string;
  business_date: string;
  opening_balance: string;
  opened_by: PersonRef;
  opened_at: Date;
  cash_sales: string | null;
  cash_refunds: string | null;
  cash_voids_earlier: string | null;
  expected_balance: string | null;
  counted_balance: string | null;
  difference: string | null;
  difference_reason: string | null;
  summary: CashDayBreakdown | null;
  closed_by: PersonRef | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * GET /cash-days/:id/summary: the close dialog's figures. Live for an
 * open day; the snapshot for a closed one (P9-6: the two always match).
 */
export interface CashDaySummary {
  cash_day_id: string;
  business_date: string;
  closed: boolean;
  opening_balance: string;
  cash_sales: string;
  cash_refunds: string;
  cash_voids_earlier: string;
  expected_balance: string;
  summary: CashDayBreakdown;
}

/** GET /cash-days/current (P9-7, P9-8): what the day gate reads. */
export interface CurrentCashDay {
  business_date: string;
  today: CashDayView | null;
  earlier_open: { id: string; business_date: string } | null;
  last_closed: { business_date: string; counted_balance: string } | null;
}

/** What POST /cash-days/open answers: 201 when made, 200 on a resend. */
export interface OpenCashDayResult {
  created: boolean;
  day: CashDayView;
}

const OPEN_KEY = 'UQ_cash_days_open_client_request_id';
const CLOSE_KEY = 'UQ_cash_days_close_client_request_id';
const DATE_KEY = 'UQ_cash_days_branch_date';

/** True only for a clash on the named unique key. */
const isClash = (err: unknown, key: string): boolean =>
  err instanceof QueryFailedError &&
  (err.driverError as { constraint?: string }).constraint === key;

// Today in Colombo by the database clock (P9-4): the transaction's now(),
// the same value that stamps completed_at, voided_at and returns. Also
// read by the day gate (day-gate.ts).
export const TODAY_SQL = `SELECT to_char((now() AT TIME ZONE 'Asia/Colombo')::date, 'YYYY-MM-DD') AS today`;

// The branch's draft sales ($1: the branch id). Close takes it exclusive
// before it lists the drafts it discards; SalesService.create takes it
// shared around its INSERT, so no draft is made between that list and the
// close's commit. Held to the end of the transaction.
const DRAFTS_LOCK_KEY = `hashtext('sale_drafts:' || $1::text)`;
export const DRAFTS_LOCK_SQL = `SELECT pg_advisory_xact_lock(${DRAFTS_LOCK_KEY})`;
export const DRAFTS_SHARED_LOCK_SQL = `SELECT pg_advisory_xact_lock_shared(${DRAFTS_LOCK_KEY})`;

const DISCARD_REASON = 'AUTO_DISCARD_ON_DAY_CLOSE';

// The day's bounds for $2 (a date), as timestamptz: Colombo midnights, the
// same instants as "+05:30" bounds. Constant within a query, so the range
// conditions use the (branch_id, <timestamp>) indexes.
const LO = `(($2::date)::timestamp AT TIME ZONE 'Asia/Colombo')`;
const HI = `((($2::date) + 1)::timestamp AT TIME ZONE 'Asia/Colombo')`;

// Payments of sales completed on the day and not voided on it (P9-5). A
// sale voided on a later day still counts here; its cash goes back on the
// day of the void (P9-6). idx_sales_branch_completed_at, idx_payments_sale_id.
const SALES_SQL = `-- cash day: sales
SELECT p.payment_method AS method, SUM(p.amount)::text AS total
  FROM sales s
  JOIN payments p ON p.sale_id = s.id
 WHERE s.branch_id = $1
   AND s.completed_at >= ${LO} AND s.completed_at < ${HI}
   AND (s.voided_at IS NULL OR s.voided_at >= ${HI})
 GROUP BY p.payment_method`;

// Refund rows of returns made on the day, dated by the return's
// transaction time. idx_sale_returns_branch_created_at,
// idx_sale_refunds_sale_return_id.
const REFUNDS_SQL = `-- cash day: refunds
SELECT f.method AS method, SUM(f.amount)::text AS total
  FROM sale_returns r
  JOIN sale_refunds f ON f.sale_return_id = r.id
 WHERE r.branch_id = $1
   AND r.created_at >= ${LO} AND r.created_at < ${HI}
 GROUP BY f.method`;

// Payments of earlier days' sales voided on the day (P9-6).
// idx_sales_branch_voided_at.
const EARLIER_VOIDS_SQL = `-- cash day: earlier voids
SELECT p.payment_method AS method, SUM(p.amount)::text AS total
  FROM sales s
  JOIN payments p ON p.sale_id = s.id
 WHERE s.branch_id = $1
   AND s.voided_at >= ${LO} AND s.voided_at < ${HI}
   AND s.completed_at < ${LO}
 GROUP BY p.payment_method`;

const COUNTS_SQL = `-- cash day: counts
SELECT
  (SELECT count(*)::int FROM sales
    WHERE branch_id = $1 AND completed_at >= ${LO} AND completed_at < ${HI})
    AS sales_completed,
  (SELECT count(*)::int FROM sale_returns
    WHERE branch_id = $1 AND created_at >= ${LO} AND created_at < ${HI})
    AS returns,
  (SELECT count(*)::int FROM sales
    WHERE branch_id = $1 AND voided_at >= ${LO} AND voided_at < ${HI})
    AS voids`;

const PEOPLE = { opener: true, closer: true } as const;

const person = (user: User | null | undefined): PersonRef | null =>
  user ? { id: user.id, full_name: user.full_name } : null;

/** 403 CASH_DAY_WRONG_BRANCH unless an admin or at the branch (C2). */
const assertBranch = (caller: CashDayCaller, branchId: string): void => {
  if (caller.role !== UserRole.ADMIN && caller.branch_id !== branchId) {
    throw new ForbiddenException({
      message:
        'You can only open, close and view cash days at your own branch.',
      code: 'CASH_DAY_WRONG_BRANCH',
    });
  }
};

/**
 * The daily opening and closing balance (Phase 6.4 P9). Planning doc
 * section 8 "P9 decision log" is the reference; docs/backend/cash-days.md
 * describes it.
 *
 * The summary query lives here and nowhere else (computeSummary): every
 * amount is dated by when it happened, on the database clock, so a closed
 * day's live figures always equal its snapshot.
 */
@Injectable()
export class CashDaysService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /** GET /cash-days/current (P9-7, P9-8). */
  async current(
    caller: CashDayCaller,
    branchId: string,
  ): Promise<CurrentCashDay> {
    assertBranch(caller, branchId);
    const manager = this.dataSource.manager;
    await this.assertBranchExists(manager, branchId);

    const [{ today }]: { today: string }[] = await manager.query(TODAY_SQL);
    const day = await manager.findOne(CashDay, {
      where: { branch_id: branchId, business_date: today },
      relations: PEOPLE,
    });
    const earlier = await this.earlierOpen(manager, branchId, today);
    const last: { business_date: string; counted_balance: string }[] =
      await manager.query(
        `SELECT to_char(business_date, 'YYYY-MM-DD') AS business_date,
                counted_balance::text AS counted_balance
           FROM cash_days
          WHERE branch_id = $1 AND closed_at IS NOT NULL
          ORDER BY business_date DESC
          LIMIT 1`,
        [branchId],
      );
    return {
      business_date: today,
      today: day ? this.toView(day) : null,
      earlier_open: earlier,
      last_closed: last[0] ?? null,
    };
  }

  /**
   * POST /cash-days/open. In order: C1 (the DTO); C3 client_request_id
   * already used (same user and branch: the recorded day, 200, nothing
   * else checked; otherwise 409); C2 wrong branch; 404 branch; then the
   * transaction (applyOpen).
   */
  async open(
    dto: OpenCashDayDto,
    caller: CashDayCaller,
    ip?: string | null,
  ): Promise<OpenCashDayResult> {
    const manager = this.dataSource.manager;
    const recorded = await this.findRecordedOpen(manager, dto, caller);
    if (recorded) {
      return { created: false, day: await this.view(manager, recorded) };
    }
    assertBranch(caller, dto.branch_id);
    await this.assertBranchExists(manager, dto.branch_id);

    let outcome: { created: boolean; id: string };
    try {
      outcome = await this.dataSource.transaction((tx) =>
        this.applyOpen(tx, dto, caller, ip),
      );
    } catch (err) {
      if (isClash(err, OPEN_KEY)) {
        const clash = await this.findRecordedOpen(manager, dto, caller);
        if (!clash) throw err;
        return { created: false, day: await this.view(manager, clash) };
      }
      if (isClash(err, DATE_KEY)) {
        // Unreachable while opens hold the branch's advisory lock; kept so
        // a clash still answers C4, not 500.
        const [{ today }]: { today: string }[] = await manager.query(TODAY_SQL);
        const existing = await manager.findOne(CashDay, {
          where: { branch_id: dto.branch_id, business_date: today },
        });
        if (existing) throw this.alreadyOpen(existing);
      }
      throw err;
    }
    return {
      created: outcome.created,
      day: await this.view(manager, outcome.id),
    };
  }

  /**
   * POST /cash-days/:id/close. In order: C1 (the DTO); C6 404; C3
   * client_request_id already used (same user and day: the closed day,
   * nothing else checked; otherwise 409); C2 wrong branch; then the
   * transaction (applyClose). Always 200.
   */
  async close(
    dayId: string,
    dto: CloseCashDayDto,
    caller: CashDayCaller,
    ip?: string | null,
  ): Promise<CashDayView> {
    const manager = this.dataSource.manager;
    const day = await manager.findOne(CashDay, { where: { id: dayId } });
    if (!day) {
      throw new NotFoundException('Cash day not found');
    }
    const recorded = await this.findRecordedClose(
      manager,
      dayId,
      dto.client_request_id,
      caller,
    );
    if (recorded) return this.view(manager, dayId);
    assertBranch(caller, day.branch_id);

    try {
      await this.dataSource.transaction((tx) =>
        this.applyClose(tx, dayId, dto, caller, ip),
      );
    } catch (err) {
      if (!isClash(err, CLOSE_KEY)) throw err;
      // Sent at the same moment for another day: C3 decides (409).
      const clash = await this.findRecordedClose(
        manager,
        dayId,
        dto.client_request_id,
        caller,
      );
      if (!clash) throw err;
    }
    return this.view(manager, dayId);
  }

  /** GET /cash-days/:id/summary: live while open, the snapshot once closed. */
  async summary(caller: CashDayCaller, dayId: string): Promise<CashDaySummary> {
    const day = await this.dataSource.manager.findOne(CashDay, {
      where: { id: dayId },
    });
    if (!day) {
      throw new NotFoundException('Cash day not found');
    }
    assertBranch(caller, day.branch_id);
    return day.closed_at
      ? this.snapshot(day)
      : this.computeSummary(this.dataSource.manager, day);
  }

  /** GET /cash-days/:id: the record, with who opened and closed it. */
  async findOne(caller: CashDayCaller, dayId: string): Promise<CashDayView> {
    const day = await this.dataSource.manager.findOne(CashDay, {
      where: { id: dayId },
      relations: PEOPLE,
    });
    if (!day) {
      throw new NotFoundException('Cash day not found');
    }
    assertBranch(caller, day.branch_id);
    return this.toView(day);
  }

  /** GET /cash-days: the branch's days, open ones included, newest first. */
  async list(
    caller: CashDayCaller,
    query: ListCashDaysQueryDto,
  ): Promise<PaginatedResponse<CashDayView>> {
    assertBranch(caller, query.branchId);
    const manager = this.dataSource.manager;
    await this.assertBranchExists(manager, query.branchId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const [days, total] = await manager.findAndCount(CashDay, {
      where: {
        branch_id: query.branchId,
        ...(query.date ? { business_date: query.date } : {}),
      },
      relations: PEOPLE,
      order: { business_date: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return paginate(
      days.map((d) => this.toView(d)),
      total,
      page,
      limit,
    );
  }

  /**
   * The day's figures, worked out now from sales, payments, returns and
   * refunds (P9-5, P9-6, P9-15). For the day's own date, whether it is
   * today or earlier; close runs it under the day's FOR UPDATE lock.
   */
  async computeSummary(
    manager: EntityManager,
    day: Pick<
      CashDay,
      'id' | 'branch_id' | 'business_date' | 'opening_balance' | 'closed_at'
    >,
  ): Promise<CashDaySummary> {
    const params = [day.branch_id, day.business_date];
    const salesRows: MethodTotalRow[] = await manager.query(SALES_SQL, params);
    const refundRows: MethodTotalRow[] = await manager.query(
      REFUNDS_SQL,
      params,
    );
    const voidRows: MethodTotalRow[] = await manager.query(
      EARLIER_VOIDS_SQL,
      params,
    );
    const [counts]: CashDayBreakdown['counts'][] = await manager.query(
      COUNTS_SQL,
      params,
    );
    const sales = centsByMethod(salesRows);
    const refunds = centsByMethod(refundRows);
    const earlierVoids = centsByMethod(voidRows);

    const cashSalesCents = sales.get(PaymentMethod.CASH) ?? 0;
    const cashRefundsCents = refunds.get(PaymentMethod.CASH) ?? 0;
    const cashVoidsEarlierCents = earlierVoids.get(PaymentMethod.CASH) ?? 0;
    return {
      cash_day_id: day.id,
      business_date: day.business_date,
      closed: day.closed_at !== null,
      opening_balance: fromCents(toCents(day.opening_balance)),
      cash_sales: fromCents(cashSalesCents),
      cash_refunds: fromCents(cashRefundsCents),
      cash_voids_earlier: fromCents(cashVoidsEarlierCents),
      expected_balance: fromCents(
        expectedCents({
          openingCents: toCents(day.opening_balance),
          cashSalesCents,
          cashRefundsCents,
          cashVoidsEarlierCents,
        }),
      ),
      summary: {
        non_cash_sales: tenderTotals(sales),
        non_cash_refunds: tenderTotals(refunds),
        earlier_voids_non_cash: tenderTotals(earlierVoids),
        trade_in_value: fromCents(sales.get(PaymentMethod.TRADE_IN) ?? 0),
        counts: {
          sales_completed: counts.sales_completed,
          returns: counts.returns,
          voids: counts.voids,
        },
      },
    };
  }

  /**
   * The open's transaction: the branch's advisory lock first, so two
   * opens for one branch run one after the other (around midnight too);
   * then today, C3 again (a simultaneous resend), C4, C5, the row and the
   * DAY_OPEN audit row.
   */
  private async applyOpen(
    tx: EntityManager,
    dto: OpenCashDayDto,
    caller: CashDayCaller,
    ip?: string | null,
  ): Promise<{ created: boolean; id: string }> {
    await tx.query(
      `SELECT pg_advisory_xact_lock(hashtext('cash_days:' || $1::text))`,
      [dto.branch_id],
    );
    const [{ today }]: { today: string }[] = await tx.query(TODAY_SQL);

    const recorded = await this.findRecordedOpen(tx, dto, caller);
    if (recorded) return { created: false, id: recorded };

    const existing = await tx.findOne(CashDay, {
      where: { branch_id: dto.branch_id, business_date: today },
    });
    if (existing) throw this.alreadyOpen(existing);

    const earlier = await this.earlierOpen(tx, dto.branch_id, today);
    if (earlier) {
      throw new ConflictException({
        message: `${earlier.business_date} was not closed. Close it before opening today.`,
        code: 'EARLIER_DAY_NOT_CLOSED',
        business_date: earlier.business_date,
        cash_day_id: earlier.id,
      });
    }

    const opening = fromCents(toCents(dto.opening_balance));
    const [{ id }]: { id: string }[] = await tx.query(
      `INSERT INTO cash_days
         (branch_id, business_date, opening_balance, opened_by, opened_at,
          open_client_request_id)
       VALUES ($1, $2::date, $3, $4, now(), $5)
       RETURNING id`,
      [dto.branch_id, today, opening, caller.id, dto.client_request_id],
    );
    await writeAuditEntry(tx, {
      actor: caller,
      action: AuditAction.DAY_OPEN,
      entityType: 'CashDay',
      entityId: id,
      description:
        `Day ${today} opened with LKR ${opening} by ${caller.full_name} ` +
        `(${caller.id}).`,
      changes: {
        business_date: { old: null, new: today },
        opening_balance: { old: null, new: opening },
      },
      ip,
    });
    return { created: true, id };
  }

  /**
   * The close's transaction: the branch's draft lock, then every DRAFT
   * sale at the branch locked; a draft with any payment blocks close
   * (OPEN_SALES). Then FOR UPDATE on the day's row, selected by id with no
   * closed_at filter; C3 again, C7; the summary after the lock; C8; the
   * difference and C9; the unpaid drafts discarded, one DRAFT_DISCARDED
   * row each; the snapshot; the DAY_CLOSE audit row. Every rejection comes
   * before the discard, and all of it commits or rolls back together.
   */
  private async applyClose(
    tx: EntityManager,
    dayId: string,
    dto: CloseCashDayDto,
    caller: CashDayCaller,
    ip?: string | null,
  ): Promise<void> {
    const dayRef = await tx.findOne(CashDay, {
      where: { id: dayId },
      select: { id: true, branch_id: true, opened_at: true },
    });
    if (!dayRef) {
      throw new NotFoundException('Cash day not found');
    }

    // A close request that already succeeded stays idempotent, even if a
    // later empty or active draft exists on the branch.
    const recordedBeforeDraftCheck = await this.findRecordedClose(
      tx,
      dayId,
      dto.client_request_id,
      caller,
    );
    if (recordedBeforeDraftCheck) return;

    // Every draft at the branch, of any age and any cashier, is discarded
    // with the close unless it has a payment. The draft lock first, so no
    // draft is created after the list below; then the drafts locked in id
    // order before the cash-day row, matching the sale -> cash-day lock
    // order used by completeSale.
    await tx.query(DRAFTS_LOCK_SQL, [dayRef.branch_id]);
    const drafts: { id: string }[] = await tx.query(
      `SELECT s.id
         FROM sales s
        WHERE s.branch_id = $1
          AND s.status = 'DRAFT'
        ORDER BY s.id
        FOR UPDATE OF s`,
      [dayRef.branch_id],
    );
    const draftIds = drafts.map((d) => d.id);

    // Payments in their own statement: a FOR UPDATE that waited re-checks
    // only the locked row, so a subquery there could miss a payment
    // committed by the transaction it waited for. With the drafts locked,
    // no payment can be added to them (addPayment locks the sale first).
    const paid: { sale_id: string }[] = draftIds.length
      ? await tx.query(
          `SELECT DISTINCT p.sale_id
             FROM payments p
            WHERE p.sale_id = ANY($1::uuid[])`,
          [draftIds],
        )
      : [];
    if (paid.length > 0) {
      throw new ConflictException({
        message:
          'An unfinished sale with a payment cannot be discarded ' +
          'automatically. Please ask an administrator to resolve it before ' +
          'closing the cash day.',
        code: 'OPEN_SALES',
        sale_count: paid.length,
      });
    }

    const day = await tx
      .createQueryBuilder(CashDay, 'day')
      .setLock('pessimistic_write')
      .where('day.id = :id', { id: dayId })
      .getOne();
    if (!day) {
      throw new NotFoundException('Cash day not found');
    }

    const recorded = await this.findRecordedClose(
      tx,
      dayId,
      dto.client_request_id,
      caller,
    );
    if (recorded) return;

    if (day.closed_at) {
      throw new ConflictException({
        message: `${day.business_date} is already closed. A closed day can't be changed.`,
        code: 'DAY_ALREADY_CLOSED',
        cash_day_id: day.id,
        closed_at: day.closed_at,
      });
    }

    const live = await this.computeSummary(tx, day);
    const expected = toCents(live.expected_balance);
    if (toCents(dto.expected_seen) !== expected) {
      throw new ConflictException({
        message:
          'The figures changed while the day was being closed (a sale, ' +
          'void or return went through). Check them and close again.',
        code: 'EXPECTED_CHANGED',
        summary: live,
      });
    }

    const counted = toCents(dto.counted_balance);
    const difference = counted - expected;
    const settled = settleReason(difference, dto.difference_reason);
    if (!settled.ok) {
      throw new BadRequestException({
        message: `${describeDifference(difference)}: give a reason (at least 3 characters).`,
        code: 'REASON_REQUIRED',
        difference: fromCents(difference),
      });
    }

    const discarded = await this.discardUnpaidDrafts(
      tx,
      draftIds,
      day,
      caller,
      ip,
    );

    await tx.query(
      `UPDATE cash_days
          SET cash_sales = $2, cash_refunds = $3, cash_voids_earlier = $4,
              expected_balance = $5, counted_balance = $6, difference = $7,
              difference_reason = $8, summary = $9::jsonb, closed_by = $10,
              closed_at = now(), close_client_request_id = $11,
              updated_at = now()
        WHERE id = $1`,
      [
        dayId,
        live.cash_sales,
        live.cash_refunds,
        live.cash_voids_earlier,
        live.expected_balance,
        fromCents(counted),
        fromCents(difference),
        settled.reason,
        JSON.stringify(live.summary),
        caller.id,
        dto.client_request_id,
      ],
    );
    await writeAuditEntry(tx, {
      actor: caller,
      action: AuditAction.DAY_CLOSE,
      entityType: 'CashDay',
      entityId: dayId,
      description:
        `Day ${day.business_date} closed by ${caller.full_name} ` +
        `(${caller.id}): expected LKR ${live.expected_balance}, counted ` +
        `LKR ${fromCents(counted)}, ${describeDifference(difference)}` +
        (settled.reason ? `. Reason: ${settled.reason}` : '') +
        (discarded ? `. Unpaid drafts discarded: ${discarded}` : '') +
        '.',
      changes: {
        expected_balance: { old: null, new: live.expected_balance },
        counted_balance: { old: null, new: fromCents(counted) },
        difference: { old: null, new: fromCents(difference) },
        difference_reason: { old: null, new: settled.reason },
        drafts_discarded: { old: null, new: discarded },
      },
      ip,
    });
  }

  /**
   * Discard the unpaid drafts close locked (`ids`), inside its transaction:
   * a snapshot of each draft and its lines first (no cost prices), then
   * one DELETE guarded again by DRAFT and no payment (lines and payments
   * cascade), then a DRAFT_DISCARDED audit row per draft. Drafts never
   * moved stock, units or cash, so nothing else changes. Returns how many
   * were discarded.
   */
  private async discardUnpaidDrafts(
    tx: EntityManager,
    ids: string[],
    day: CashDay,
    caller: CashDayCaller,
    ip?: string | null,
  ): Promise<number> {
    if (ids.length === 0) return 0;

    const sales = await readDraftSnapshots(tx, ids);

    // manager.query answers a DELETE with [rows, affected count].
    const [, deleted]: [unknown[], number] = await tx.query(
      `DELETE FROM sales s
        WHERE s.id = ANY($1::uuid[])
          AND s.status = 'DRAFT'
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id)`,
      [ids],
    );
    if (deleted !== ids.length || sales.length !== ids.length) {
      // The drafts are locked, so this means the data moved under us:
      // throwing rolls the whole close back.
      throw new Error(
        `Day ${day.id} close: ${deleted} of ${ids.length} locked drafts ` +
          `discarded (${sales.length} read). Nothing was changed.`,
      );
    }

    for (const sale of sales) {
      await writeAuditEntry(tx, {
        actor: caller,
        action: AuditAction.DRAFT_DISCARDED,
        entityType: 'Sale',
        entityId: sale.id,
        description:
          `Unpaid draft ${sale.id} (${sale.lines.length} ` +
          `${sale.lines.length === 1 ? 'line' : 'lines'}, LKR ${sale.total}, ` +
          `cashier ${sale.cashier_name ?? sale.cashier_id}) discarded when ` +
          `day ${day.business_date} was closed by ${caller.full_name} ` +
          `(${caller.id}).`,
        changes: {
          status: { old: 'DRAFT', new: 'DISCARDED' },
          sale: { old: sale, new: null },
          discard: {
            old: null,
            new: {
              reason: DISCARD_REASON,
              cash_day_id: day.id,
              business_date: day.business_date,
              closed_by: caller.id,
            },
          },
        },
        ip,
      });
    }
    return deleted;
  }

  /**
   * C3 for open (P9-18): the day recorded with this client_request_id, if
   * it was this user's for this branch; null when the id is new. Anyone
   * else's is 409, and nothing about that day is revealed.
   */
  private async findRecordedOpen(
    manager: EntityManager,
    dto: OpenCashDayDto,
    caller: CashDayCaller,
  ): Promise<string | null> {
    const existing = await manager.findOne(CashDay, {
      where: { open_client_request_id: dto.client_request_id },
      select: { id: true, branch_id: true, opened_by: true },
    });
    if (!existing) return null;
    if (
      existing.branch_id !== dto.branch_id ||
      existing.opened_by !== caller.id
    ) {
      throw this.requestIdConflict();
    }
    return existing.id;
  }

  /** C3 for close: as findRecordedOpen, for this day and user. */
  private async findRecordedClose(
    manager: EntityManager,
    dayId: string,
    clientRequestId: string,
    caller: CashDayCaller,
  ): Promise<string | null> {
    const existing = await manager.findOne(CashDay, {
      where: { close_client_request_id: clientRequestId },
      select: { id: true, closed_by: true },
    });
    if (!existing) return null;
    if (existing.id !== dayId || existing.closed_by !== caller.id) {
      throw this.requestIdConflict();
    }
    return existing.id;
  }

  private requestIdConflict(): ConflictException {
    return new ConflictException({
      message:
        'This request id was already used for another opening or closing. ' +
        'Start again.',
      code: 'CLIENT_REQUEST_ID_CONFLICT',
    });
  }

  /** C4: today already has a record, open or closed. */
  private alreadyOpen(day: CashDay): ConflictException {
    return new ConflictException({
      message: day.closed_at
        ? `Today (${day.business_date}) was already opened and closed at ` +
          `${formatColomboTime(day.closed_at)}. A closed day can't be reopened.`
        : `Today (${day.business_date}) is already open.`,
      code: 'DAY_ALREADY_OPEN',
      cash_day_id: day.id,
      closed_at: day.closed_at,
    });
  }

  /** The oldest day before `today` still open at the branch, or null. */
  private async earlierOpen(
    manager: EntityManager,
    branchId: string,
    today: string,
  ): Promise<{ id: string; business_date: string } | null> {
    const rows: { id: string; business_date: string }[] = await manager.query(
      `SELECT id, to_char(business_date, 'YYYY-MM-DD') AS business_date
         FROM cash_days
        WHERE branch_id = $1 AND business_date < $2::date
          AND closed_at IS NULL
        ORDER BY business_date ASC
        LIMIT 1`,
      [branchId, today],
    );
    return rows[0] ?? null;
  }

  private async assertBranchExists(
    manager: EntityManager,
    branchId: string,
  ): Promise<void> {
    const branch = await manager.findOne(Branch, {
      where: { id: branchId },
      select: { id: true },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
  }

  /** A closed day's figures, from its snapshot, never recomputed. */
  private snapshot(day: CashDay): CashDaySummary {
    return {
      cash_day_id: day.id,
      business_date: day.business_date,
      closed: true,
      opening_balance: day.opening_balance,
      cash_sales: day.cash_sales!,
      cash_refunds: day.cash_refunds!,
      cash_voids_earlier: day.cash_voids_earlier!,
      expected_balance: day.expected_balance!,
      summary: day.summary!,
    };
  }

  private async view(
    manager: EntityManager,
    dayId: string,
  ): Promise<CashDayView> {
    const day = await manager.findOne(CashDay, {
      where: { id: dayId },
      relations: PEOPLE,
    });
    if (!day) {
      throw new Error(`Cash day ${dayId} vanished after it was written.`);
    }
    return this.toView(day);
  }

  private toView(day: CashDay): CashDayView {
    return {
      id: day.id,
      branch_id: day.branch_id,
      business_date: day.business_date,
      opening_balance: day.opening_balance,
      opened_by: person(day.opener)!,
      opened_at: day.opened_at,
      cash_sales: day.cash_sales,
      cash_refunds: day.cash_refunds,
      cash_voids_earlier: day.cash_voids_earlier,
      expected_balance: day.expected_balance,
      counted_balance: day.counted_balance,
      difference: day.difference,
      difference_reason: day.difference_reason,
      summary: day.summary,
      closed_by: person(day.closer),
      closed_at: day.closed_at,
      created_at: day.created_at,
      updated_at: day.updated_at,
    };
  }
}
