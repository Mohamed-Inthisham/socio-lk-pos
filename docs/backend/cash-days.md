# Cash Days (daily opening and closing balance)

One record per branch per Colombo business date: the opening balance, and at close the counted cash, the expected cash worked out by the server, the difference and its reason. Phase 6.4 P9; the decisions are in the planning doc [phase-6.4-pos-terminal.md](../frontend/phase-6.4-pos-terminal.md) section 8 "P9 decision log" (P9-1 – P9-24, errors C1 – C11). Code: `backend/src/cash-days/` (`cash-days.service.ts`, `cash-days.controller.ts`, `cash-day-math.ts`, `day-gate.ts`). Related: [sales.md](./sales.md) (lock order, void), [returns.md](./returns.md) (refunds).

Backend 0a added the table, the six endpoints and the audit rows. Backend 0b made complete, void and return refuse unless today is open ([Enforcement](#enforcement-backend-0b) below).

## The model

Migration `CreateCashDays`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | `PK_cash_days_id` |
| `branch_id` | uuid NOT NULL | `FK_cash_days_branch` (RESTRICT) |
| `business_date` | date NOT NULL | The Colombo date. `UQ_cash_days_branch_date (branch_id, business_date)` |
| `opening_balance` | numeric(12,2) NOT NULL | `CHK_cash_days_opening_nonneg` (≥ 0) |
| `opened_by` | uuid NOT NULL | `FK_cash_days_opened_by` (RESTRICT) |
| `opened_at` | timestamptz NOT NULL | The open's transaction time |
| `open_client_request_id` | uuid NOT NULL | `UQ_cash_days_open_client_request_id` |
| `cash_sales`, `cash_refunds`, `cash_voids_earlier` | numeric(12,2) NULL | Snapshot at close |
| `expected_balance` | numeric(12,2) NULL | Snapshot at close; **may be negative** |
| `counted_balance` | numeric(12,2) NULL | Typed at close |
| `difference` | numeric(12,2) NULL | counted − expected; negative = short |
| `difference_reason` | varchar(500) NULL | Set exactly when the difference is 1.00 or more either way ([the rounding rule](#the-rounding-rule)) |
| `summary` | jsonb NULL | Detailed closing summary, frozen at close ([below](#the-summary-jsonb)) |
| `closed_by` | uuid NULL | `FK_cash_days_closed_by` (RESTRICT) |
| `closed_at` | timestamptz NULL | |
| `close_client_request_id` | uuid NULL | `UQ_cash_days_close_client_request_id` |
| `created_at`, `updated_at` | timestamptz | |

Checks:

- `CHK_cash_days_close_amounts_nonneg`: `cash_sales`, `cash_refunds`, `cash_voids_earlier`, `counted_balance` ≥ 0. Null while open, so it passes.
- `CHK_cash_days_expected`: `expected_balance = opening_balance + cash_sales - cash_refunds - cash_voids_earlier`.
- `CHK_cash_days_difference`: `difference = counted_balance - expected_balance`.
- `CHK_cash_days_reason`: `CASE WHEN difference IS NULL OR abs(difference) < 1 THEN difference_reason IS NULL ELSE difference_reason IS NOT NULL AND length(trim(difference_reason)) >= 3 END`: no reason while open or under 1.00 either way; from 1.00, 3+ characters after trimming.
- `CHK_cash_days_closed_consistency`: the ten closing columns (`cash_sales` … `close_client_request_id`, `summary` included) are all null (open) or all set (closed). `difference_reason` follows `CHK_cash_days_reason` instead.

No status column: open is `closed_at IS NULL`. Nothing forbids a negative expected balance (a cash refund on an earlier day's sale with a small opening). The SQL uses ASCII `-`.

The same migration adds **`idx_sales_branch_voided_at`** on `sales (branch_id, voided_at) WHERE voided_at IS NOT NULL`, for the summary's earlier voids (also declared on the `Sale` entity). **`down()` refuses while any `cash_days` row exists** and changes nothing (P9-20); with none, it drops the index and the table.

## Expected cash (P9-5, P9-6)

Computed only on the server, in `CashDaysService.computeSummary`, the one place the summary query lives. For branch B and day D, every amount is **dated by when it happened**, on the database clock. D's bounds are Colombo midnights computed in SQL (`($date::timestamp AT TIME ZONE 'Asia/Colombo')` and the next day's), the same instants as `+05:30` bounds and constant within the query:

| Figure | What | Dated by | Indexes |
|---|---|---|---|
| `cash_sales` | CASH payments' `amount` of sales completed on D and **not voided on D** | `sales.completed_at` | `idx_sales_branch_completed_at`, `idx_payments_sale_id` |
| `cash_refunds` | CASH `sale_refunds` rows of returns made on D (a trade-in share paid as cash and the cash part of a split refund included) | `sale_returns.created_at` | `idx_sale_returns_branch_created_at`, `idx_sale_refunds_sale_return_id` |
| `cash_voids_earlier` | CASH payments' `amount` of sales **voided on D that were completed before D** | `sales.voided_at` | `idx_sales_branch_voided_at` |

**expected = opening + cash_sales − cash_refunds − cash_voids_earlier**, in integer cents (`cash-day-math.ts`). A payment's `amount` is what the sale kept, so change handed back is never counted. A sale voided the same day nets to zero. A sale voided on a later day counts on its own day and comes off on the day of the void, so an earlier day's figures never move: a closed day's live figures always equal its snapshot.

Example (P9-5), Mon 20 Oct: opening 5,000.00; sale A 12,000.00 cash (15,000.00 given, 3,000.00 change); sale B 2,000.00 cash, voided the same day; a return on a trade-in sale refunds CARD 500.00 + CASH 1,500.00. Expected = 5,000.00 + 12,000.00 − 1,500.00 = 15,500.00.

Example (P9-6): Tue 21 Oct opens with 15,500.00, takes 8,000.00 in cash sales, and sale A is voided. Monday still reads 15,500.00; Tuesday's expected = 15,500.00 + 8,000.00 − 12,000.00 = 11,500.00.

Not counted (P9-24): cash paid out on a phone purchase (`POST /phone-purchases`), cash in / cash out, credit repayments.

## The rounding rule

The shop counts whole rupees, but discounts and refund shares make cents (1,799.10, 966.67), so small differences at close are normal. **A difference under 1.00 either way (0 included) needs no reason**: any reason sent is ignored and `difference_reason` is stored null. **From 1.00 either way a reason is required** (3+ characters after trimming, 400 `REASON_REQUIRED` otherwise). The difference itself is always stored exactly (`-0.50` stays `-0.50`).

In code the test is integer cents, `abs(differenceCents) >= 100` (`REASON_THRESHOLD_CENTS`, `settleReason` in `cash-day-math.ts`); in the database, `CHK_cash_days_reason` uses `abs(difference) < 1`. Examples: 0.00, 0.99 and −0.99 need no reason; 1.00 and −1.00 do.

The till (frontend) shows **"Exact"** only at 0.00, **"Rounding LKR X"** under 1.00, and "Short LKR X" / "Over LKR X" from 1.00. The `DAY_CLOSE` audit description uses the same words (`describeDifference` in `cash-day-math.ts`).

## The saved summary jsonb

Frozen at close so historical records preserve the closing information as it was counted (P9-15). Money is a 2-decimal string; every non-cash tender is always present (`"0.00"` when none):

```json
{
  "non_cash_sales":         { "CARD": "0.00", "BANK_TRANSFER": "0.00", "KOKO": "0.00", "MINTPAY": "0.00" },
  "non_cash_refunds":       { "CARD": "500.00", "BANK_TRANSFER": "0.00", "KOKO": "0.00", "MINTPAY": "0.00" },
  "earlier_voids_non_cash": { "CARD": "0.00", "BANK_TRANSFER": "0.00", "KOKO": "0.00", "MINTPAY": "0.00" },
  "trade_in_value": "0.00",
  "counts": { "sales_completed": 3, "returns": 1, "voids": 1 }
}
```

- `non_cash_sales` and `trade_in_value` follow the cash rule: payments of sales completed on D and not voided on D.
- `non_cash_refunds`: refund rows of returns made on D.
- `earlier_voids_non_cash`: payments of earlier days' sales voided on D ("earlier sales voided"), by tender.
- `counts.sales_completed`: every sale completed on D, same-day voids included. `counts.returns`: returns made on D. `counts.voids`: every sale voided on D, whenever it was completed.

## Endpoints

`CashDaysController`, tag **Cash days**. All three roles; managers and cashiers only at their own branch, admins at any (403 `CASH_DAY_WRONG_BRANCH`, P9-17). Money in responses is a numeric string; request money is a number with at most 2 decimals.

A day in responses is `{ id, branch_id, business_date, opening_balance, opened_by: { id, full_name }, opened_at, cash_sales, cash_refunds, cash_voids_earlier, expected_balance, counted_balance, difference, difference_reason, summary, closed_by: { id, full_name } | null, closed_at, created_at, updated_at }`; the closing fields are null while open.

| Endpoint | Answers |
|---|---|
| `GET /cash-days/current?branchId=` | `{ business_date, today, earlier_open, last_closed }`: the server's Colombo date; today's day or null; the oldest earlier day still open `{ id, business_date }` or null; the most recent closed day `{ business_date, counted_balance }` or null (P9-7, P9-8). 404 "Branch not found". |
| `POST /cash-days/open` `{ branch_id, opening_balance, client_request_id }` | 201 the day; 200 the recorded one on a resend. |
| `GET /cash-days/:id/summary` | `{ cash_day_id, business_date, closed, opening_balance, cash_sales, cash_refunds, cash_voids_earlier, expected_balance, summary }`: live for an open day (the close dialog's preview), the saved snapshot for a closed one. |
| `POST /cash-days/:id/close` `{ counted_balance, difference_reason?, expected_seen, client_request_id }` | 200 the closed day, also on a resend. |
| `GET /cash-days?branchId=&page=&limit=` | `{ data, meta }`: the branch's days **open ones included** (`closed_at` and `closed_by` null), newest `business_date` first, each with opener and closer `{ id, full_name }` (P9-16). 404 "Branch not found". |
| `GET /cash-days/:id` | One day with its saved closing details. |

### Open

1. **C1** validation (400): `opening_balance` ≥ 0, at most 2 decimals; UUIDs.
2. **C3** `client_request_id` already used: by the same user for the same branch, the recorded day with 200 and nothing else checked; otherwise 409 `CLIENT_REQUEST_ID_CONFLICT`.
3. **C2** wrong branch (403); then 404 "Branch not found".
4. The transaction:
   1. `pg_advisory_xact_lock(hashtext('cash_days:' || branch_id))`: opens for one branch run one after the other, so two opens around midnight can't both pass the earlier-day check.
   2. Today: `(now() AT TIME ZONE 'Asia/Colombo')::date`.
   3. C3 again (a simultaneous resend waited on the lock).
   4. **C4** today already has a record: 409 `DAY_ALREADY_OPEN` with `cash_day_id` and `closed_at` (null while open; when today was already closed the message says it was opened and closed, and it can't be reopened).
   5. **C5** an earlier day still open: 409 `EARLIER_DAY_NOT_CLOSED` with `business_date` and `cash_day_id` of the oldest.
   6. The row (`opened_at = now()`) and the **`DAY_OPEN`** audit row (`business_date`, `opening_balance`).

A clash on `UQ_cash_days_open_client_request_id` (the same id sent at once) is answered as C3. A clash on `UQ_cash_days_branch_date` can't happen under the advisory lock; if it did, it is answered as C4.

### Close

1. **C1** validation (400): `counted_balance` ≥ 0, `expected_seen` (may be negative), at most 2 decimals; `difference_reason` a string of at most 500 characters, trimmed (blank is none). **The DTO has no minimum length**: whether a reason is needed depends on the difference, which only the server works out.
2. **C6** 404 "Cash day not found".
3. **C3** as for open, for this day and user.
4. **C2** wrong branch (403).
5. The transaction (P9-10):
   1. C3 again before any draft is touched: a close request that already succeeded returns here.
   2. `pg_advisory_xact_lock(hashtext('sale_drafts:' || branch_id))`, exclusive (`DRAFTS_LOCK_SQL`). `SalesService.create` takes the same key shared around its INSERT (`DRAFTS_SHARED_LOCK_SQL`), so a draft is created either before the list in the next step or after the close commits _(#75)_.
   3. Every DRAFT sale at the branch, of any age and any cashier, locked in sale-id order (`FOR UPDATE OF s`). These sale locks precede the day lock, matching the sale-to-cash-day lock order _(#75)_.
   4. Their payments, read in a separate statement (a `FOR UPDATE` that waited re-checks only the locked row, so a subquery there could miss a payment committed meanwhile). Any payment row, whatever its method or amount, refuses with 409 `OPEN_SALES` and `sale_count` (the number of drafts with a payment) before the day's row is locked; nothing is discarded _(#75)_.
   5. `FOR UPDATE` on the day's row, **selected by id with no `closed_at` filter**; open or closed is checked in code on the row returned.
   6. C3 again (a resend that waited on the lock).
   7. **C7** already closed: 409 `DAY_ALREADY_CLOSED` with `cash_day_id`, `closed_at`.
   8. The summary, **run after the lock is held**, in the same transaction.
   9. **C8** `expected_seen` ≠ the expected just worked out: 409 `EXPECTED_CHANGED` with `summary` (the fresh figures, as `GET /:id/summary`). Before C9: the expected decides the difference.
   10. difference = counted − expected, stored exactly. **C9** ([the rounding rule](#the-rounding-rule)): under 1.00 either way (0 included), any reason sent is ignored and `difference_reason` stored null (never a 400, never a CHECK violation); from 1.00, fewer than 3 characters after trimming is 400 `REASON_REQUIRED` with `difference`.
   11. The unpaid drafts locked in step 3 are discarded _(#75)_: a snapshot of each (`readDraftSnapshots` in `sales/draft-snapshot.ts`: the sale with its cashier, customer, totals, notes and timestamps, and its lines; no cost prices), then one DELETE guarded again by `status = 'DRAFT'` and no payment (lines and payments cascade). The deleted count must equal the drafts locked, otherwise the close throws and rolls back. Then one **`DRAFT_DISCARDED`** audit row per draft ([audit-logs.md](./audit-logs.md)).
   12. The snapshot (`closed_at = now()`) and the **`DAY_CLOSE`** audit row (expected, counted, difference, reason, and `drafts_discarded`, the number discarded; its description adds "Unpaid drafts discarded: N." when N > 0).

A closed day is never edited and never reopened. Every 4xx body is `{ message, code, … }`. Since #75, `OPEN_SALES` means a draft at the branch has a payment; resolving it is a manual step (FOLLOWUPS). Every unpaid draft at the branch, empty or not, from any terminal and of any age, is discarded with the close. Drafts never moved stock, product units or cash (expected cash counts only completed sales), so nothing else changes. Every refusal (`OPEN_SALES`, C7, C8, C9) comes before the discard, and the discard, its audit rows, the snapshot and `DAY_CLOSE` commit or roll back together. `OPEN_SALES` is checked before the day's row is locked, so for a day already closed it can answer instead of C7.

## Enforcement (backend 0b)

**Complete, void and return need today open** (P9-9, C10, C11). "Today" is `(now() AT TIME ZONE 'Asia/Colombo')::date` on the database clock, read inside the action's own transaction: the same `now()` that stamps `completed_at`, `voided_at` and `sale_returns.created_at`, so the day that lets an action through is the day the summary dates it by. The day is the **sale's branch's**, and always **today's**, whenever the sale was made: voiding or returning an earlier day's sale needs today open, and its cash counts on today (P9-6).

| # | Cause | Status, `code` and extra fields |
|---|---|---|
| C10 | Today has no record at the sale's branch | 409 `DAY_NOT_OPEN` + `business_date` (today) |
| C11 | Today's record is closed | 409 `DAY_CLOSED` + `business_date` (today) |

One function decides both: `assertDayOpen(manager, branchId, { lock })` in `day-gate.ts`. It reads today first (`TODAY_SQL`, exported from the service), then selects the row by `(branch_id, business_date)` with **no `closed_at` filter**, and decides open or closed in code on the row returned.

- **In the transaction, `FOR SHARE`, as step 4 of the global lock order** ([sales.md](./sales.md) "Lock order"): right after `lockInventoryRows` in `completeSale`, `voidSale` and the return's transaction, before any change. Sales don't block one another. A close (`FOR UPDATE`, above) waits for the sales already holding the row and counts their cash; a sale that arrives while a close holds it waits, then gets the row as the close left it (READ COMMITTED) and answers `DAY_CLOSED`. A `closed_at` filter would drop the re-checked row and wrongly answer `DAY_NOT_OPEN`. Close also locks the branch's drafts (#75), but before the day's row and in sale-id order, the same sale-before-cash-day order complete follows, so there is still no deadlock cycle.
- **Before the PIN, without a lock**, in void and return, so a closed or unopened day never spends a PIN attempt (`ApprovalsService.verify` commits its own transaction before the action's opens). Void: 404, 400 not COMPLETED, 403 `VOID_WRONG_BRANCH`, 409 `SALE_HAS_RETURNS`, **then the day**, then the PIN. Return: R2, R3, R4, R5, **then the day**, then R6 – R12 and the PIN ([returns.md](./returns.md)). A return resend (R3) still answers its recorded 200 on a closed day. The check in the transaction stays the authority.
- Complete has no check before its transaction (no PIN): 404, the three 400s (not DRAFT, no lines, amount), the locks, then the day.

Not checked: drafts, their lines and payments (no cash until complete); the inspection pass; `POST /phone-purchases` (P9-24, FOLLOWUPS).

## Tests

- `src/cash-days/cash-day-math.spec.ts`: expected (the P9-5 and P9-6 numbers, negative), the reason rule with the rounding boundaries (0, 0.99, −0.99, 1.00, −1.00), tender totals.
- `src/cash-days/cash-days.service.spec.ts`: the order of the checks (C3 before C2, C8 before C9), the advisory lock first in the open, `FOR UPDATE` by id without `closed_at`, the summary inside the lock, what is written and audited.
- The draft cleanup (#75), in the same spec with a mocked manager: the draft lock's SQL, key and order; every DRAFT at the branch locked, any age or cashier; payments read in their own statement, any payment refusing `OPEN_SALES` with nothing discarded; the DELETE's guards; the `DRAFT_DISCARDED` payload without cost prices and the `DAY_CLOSE` count; refusals and failures after the locks discarding nothing; resends doing no draft work. `src/sales/sales.service.spec.ts`: `create` takes the shared draft lock before its INSERT. Real-PostgreSQL behaviour (the advisory lock blocking, the cascade, rollback) has **no e2e test yet**.
- `test/cash-days.e2e-spec.ts`: the endpoints against the test database, the summary SQL with the P9-5 and P9-6 examples, and the frozen-day rule (yesterday's live figures recomputed equal its snapshot). The tests use the database clock's today; a run crossing midnight Colombo time can fail spuriously.
- `src/cash-days/day-gate.spec.ts`: today read first, `FOR SHARE` only with `lock`, no `closed_at` in the WHERE, the two refusals' bodies. `src/sales/sales.service.spec.ts` and `src/sales/sale-returns.service.spec.ts`: the gate's place in each check order and lock order, and that a refusal changes nothing and spends no PIN.
- `test/cash-days-enforcement.e2e-spec.ts` (backend 0b): complete, void and return refused with `DAY_NOT_OPEN` and `DAY_CLOSED`, nothing changed; a wrong PIN on a closed or unopened day leaves the attempt count at 0; close racing a sale in both orders, forced with a gate (close first: the waiting sale gets `DAY_CLOSED`; sale first: the close's snapshot includes it, or a stale `expected_seen` gets `EXPECTED_CHANGED` with it); an earlier day's sale gated by today's day; the inspection pass on a closed day; a return resend after the close. Four of these tests (the close-versus-sale races and the closed-day complete) were failing at `a56d2eb`, and the spec's status after #75 hasn't been verified: the e2e tests haven't been re-run since (FOLLOWUPS).
- Every other e2e spec that completes, voids or returns opens today first with `openToday` (`test/cash-day.helper.ts`: a SQL insert, `ON CONFLICT DO NOTHING`, no audit row).

## Corrections to the planning doc (for step G)

Decided during backends 0a and 0b; the planning doc's section 8 is updated in step G, not before:

1. **`idx_sales_branch_voided_at`** is added (P9-4 said the existing indexes serve every query; earlier voids by `voided_at` had none).
2. **Open takes `pg_advisory_xact_lock(hashtext('cash_days:' || branch_id))`** first in its transaction (P9-10 covers close and sales, not two opens around midnight).
3. **404 "Branch not found"** on open, current and the list (not in the error table).
4. **The list includes open days**, newest first, and each row carries opener and closer `{ id, full_name }` (the endpoint text gave names only on `GET /:id`; P9-16 shows "closed by").
5. **The summary jsonb rules** above (tenders and trade-in value follow the cash rule; counts; earlier non-cash voids by tender; non-cash refunds by tender; money as 2-decimal strings).
6. **C1 / C9 split**: the DTO checks only string and at most 500; the 3-character minimum is the service's `REASON_REQUIRED`, only when the difference is 1.00 or more either way.
7. **`DAY_ALREADY_OPEN` carries `cash_day_id` and `closed_at`**, and says when today was already opened and closed.
8. **C3 before C2**, as returns do.
9. **Expected may be negative**: no CHECK forbids it.
10. **The rounding rule** (business change, 2026-10-24): P9-11 and C9 change from "a non-zero difference needs a reason" to "a difference of 1.00 or more either way needs a reason; under 1.00 (0 included) the reason is ignored and stored null; the difference is stored exactly". `CHK_cash_days_reason` uses `abs(difference) < 1`. The frontend's close dialog (P9-11) shows "Rounding LKR X" under 1.00, "Exact" only at 0, and the reason box only from 1.00.
11. **P9-10: close selects the row by `id`**, not by `(branch_id, business_date)` as "both locks" says; it is the same row, with no `closed_at` filter either way. The sales' `FOR SHARE` selects by `(branch_id, business_date)`. _(0b)_
12. **P9-23 / the 0b step row: the `openToday` helper's scope** is every e2e spec that completes, voids or returns, not only "sales, returns, void and lock-order": also approvals (its PIN tests void a seeded sale, and the day check runs before the PIN), secret-exposure, suppliers and inspection-status. It is a SQL insert, not the endpoint. _(0b)_
13. **P9-9: where the check before the PIN sits.** Void: after `SALE_HAS_RETURNS`. Return: after R5, before R6 (so an R3 resend still answers 200 on a closed day). In each transaction the day comes right after `lockInventoryRows`, so the order matches the check before the PIN. _(0b)_
14. **P9-10 / lock order: the `cash_days` row is step 4 and "everything else" becomes step 5** in `docs/backend/sales.md` "Lock order" (it was step 4 there). _(0b)_
