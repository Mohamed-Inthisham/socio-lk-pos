import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TODAY_SQL } from './cash-days.service';

/**
 * The day gate (Phase 6.4 P9-9, P9-10, errors C10 and C11): a sale is
 * completed, voided or returned only while today has an open cash day at
 * the sale's branch. Otherwise 409 DAY_NOT_OPEN (no record for today) or
 * 409 DAY_CLOSED (today's record is closed), each with business_date.
 *
 * Today is the Colombo date of now(). Inside a transaction that is the
 * transaction's time, the same value that stamps completed_at, voided_at
 * and sale_returns.created_at, so the day that lets an action through is
 * the day the summary dates it by. It is read first and passed as a
 * parameter, so the row and the error name the same date.
 *
 * With `lock`, the row is taken FOR SHARE: step 4 of the global lock order
 * (docs/backend/sales.md "Lock order"), after the sale row and
 * lockInventoryRows. Sales don't block one another; close's FOR UPDATE
 * waits for the ones in progress and sees their cash, and anything after
 * it sees the day closed. The row is selected by (branch_id,
 * business_date) only, with no closed_at filter, and open or closed is
 * decided here on the row returned: under READ COMMITTED a sale that
 * waited behind a close gets the row as the close left it, so it answers
 * DAY_CLOSED. A closed_at filter would drop the row and answer
 * DAY_NOT_OPEN instead.
 *
 * Without `lock` it is the lock-free check that void and return run before
 * ApprovalsService.verify, so a closed or unopened day never spends a PIN
 * attempt. The check in the transaction stays the authority.
 */
export async function assertDayOpen(
  manager: EntityManager,
  branchId: string,
  { lock }: { lock: boolean },
): Promise<void> {
  const [{ today }]: { today: string }[] = await manager.query(TODAY_SQL);
  const rows: { id: string; closed_at: Date | null }[] = await manager.query(
    `SELECT id, closed_at
       FROM cash_days
      WHERE branch_id = $1 AND business_date = $2::date` +
      (lock ? `\n        FOR SHARE` : ''),
    [branchId, today],
  );
  const day = rows[0];
  if (!day) {
    throw new ConflictException({
      message: `Today (${today}) hasn't been opened. Enter the opening balance first.`,
      code: 'DAY_NOT_OPEN',
      business_date: today,
    });
  }
  if (day.closed_at) {
    throw new ConflictException({
      message: `Today (${today}) is closed. No sales, voids or returns until tomorrow's opening.`,
      code: 'DAY_CLOSED',
      business_date: today,
    });
  }
}
