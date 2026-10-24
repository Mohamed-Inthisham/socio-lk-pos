# Cash Days (daily opening and closing balance)

One record per branch per Colombo business date: the opening balance, and at close the counted cash, the expected cash worked out by the server, the difference and its reason. Phase 6.4 P9; the decisions are in the planning doc [phase-6.4-pos-terminal.md](../frontend/phase-6.4-pos-terminal.md) section 8 "P9 decision log" (P9-1 – P9-24, errors C1 – C11). Code: `backend/src/cash-days/` (`cash-days.service.ts`, `cash-days.controller.ts`, `cash-day-math.ts`). Related: [sales.md](./sales.md) (lock order, void), [returns.md](./returns.md) (refunds).

**Backend 0a (this step) is additive:** the table, the six endpoints and the audit rows. Nothing in sales, void or returns checks the day yet. `DAY_NOT_OPEN` / `DAY_CLOSED` (C10, C11) and the `FOR SHARE` lock in complete, void and return are backend 0b.

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
| `summary` | jsonb NULL | The rest of the printout, frozen at close ([below](#the-summary-jsonb)) |
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

## The summary jsonb

Frozen at close so a reprint matches the original print (P9-15). Money is a 2-decimal string; every non-cash tender is always present (`"0.00"` when none):

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
| `GET /cash-days/:id/summary` | `{ cash_day_id, business_date, closed, opening_balance, cash_sales, cash_refunds, cash_voids_earlier, expected_balance, summary }`: live for an open day (the close dialog's preview), the snapshot for a closed one. |
| `POST /cash-days/:id/close` `{ counted_balance, difference_reason?, expected_seen, client_request_id }` | 200 the closed day, also on a resend. |
| `GET /cash-days?branchId=&page=&limit=` | `{ data, meta }`: the branch's days **open ones included** (`closed_at` and `closed_by` null), newest `business_date` first, each with opener and closer `{ id, full_name }` (P9-16). 404 "Branch not found". |
| `GET /cash-days/:id` | One day (reprint). |

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
   1. `FOR UPDATE` on the day's row, **selected by id with no `closed_at` filter**; open or closed is checked in code on the row returned.
   2. C3 again (a resend that waited on the lock).
   3. **C7** already closed: 409 `DAY_ALREADY_CLOSED` with `cash_day_id`, `closed_at`.
   4. The summary, **run after the lock is held**, in the same transaction.
   5. **C8** `expected_seen` ≠ the expected just worked out: 409 `EXPECTED_CHANGED` with `summary` (the fresh figures, as `GET /:id/summary`). Before C9: the expected decides the difference.
   6. difference = counted − expected, stored exactly. **C9** ([the rounding rule](#the-rounding-rule)): under 1.00 either way (0 included), any reason sent is ignored and `difference_reason` stored null (never a 400, never a CHECK violation); from 1.00, fewer than 3 characters after trimming is 400 `REASON_REQUIRED` with `difference`.
   7. The snapshot (`closed_at = now()`) and the **`DAY_CLOSE`** audit row (expected, counted, difference, reason).

A closed day is never edited and never reopened. Every 4xx body is `{ message, code, … }`.

## Tests

- `src/cash-days/cash-day-math.spec.ts`: expected (the P9-5 and P9-6 numbers, negative), the reason rule with the rounding boundaries (0, 0.99, −0.99, 1.00, −1.00), tender totals.
- `src/cash-days/cash-days.service.spec.ts`: the order of the checks (C3 before C2, C8 before C9), the advisory lock first in the open, `FOR UPDATE` by id without `closed_at`, the summary inside the lock, what is written and audited.
- `test/cash-days.e2e-spec.ts`: the endpoints against the test database, the summary SQL with the P9-5 and P9-6 examples, and the frozen-day rule (yesterday's live figures recomputed equal its snapshot). The tests use the database clock's today; a run crossing midnight Colombo time can fail spuriously.

## Corrections to the planning doc (for step G)

Decided during backend 0a; the planning doc's section 8 is updated in step G, not before:

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
