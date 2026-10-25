import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

/**
 * Today's cash day for e2e specs (Phase 6.4 P9, backend 0b): complete,
 * void and return refuse with 409 DAY_NOT_OPEN until today (the database
 * clock's Colombo date) has an open cash day at the sale's branch. Specs
 * that sell, void or return call this when seeding the branch's sale.
 *
 * Inserted with SQL, not POST /cash-days/open: no audit row (so audit
 * counts don't move), no throttle, and safe to call any number of times
 * (ON CONFLICT DO NOTHING). The endpoint itself is tested in
 * cash-days.e2e-spec.ts. `openedBy` is any existing user (FK).
 *
 * A run crossing midnight Colombo time can fail spuriously: a day opened
 * before midnight is then yesterday.
 */
export async function openToday(
  dataSource: DataSource,
  branchId: string,
  openedBy: string,
): Promise<void> {
  await dataSource.query(
    `INSERT INTO cash_days
       (branch_id, business_date, opening_balance, opened_by, opened_at,
        open_client_request_id)
     VALUES ($1, (now() AT TIME ZONE 'Asia/Colombo')::date, 0, $2, now(), $3)
     ON CONFLICT (branch_id, business_date) DO NOTHING`,
    [branchId, openedBy, randomUUID()],
  );
}
