# Sales Backend

This document covers the Sales Backend — the transactional core of SOCIO.LK POS. It includes entity design, the sale lifecycle, the two most consequential transactional flows (complete and void), endpoint reference, and the "why" behind the major decisions. Product and inventory conventions are in [products.md](./products.md); authentication in [auth.md](./auth.md); role enforcement patterns in [rbac.md](./rbac.md); table conventions in [database.md](./database.md); audit trail in [audit-logs.md](./audit-logs.md).

## Overview

The Sales Backend was built as Phase 6.3 and delivers everything a POS needs to ring up, tender, complete, and void a sale — plus the friendly-shop sourcing primitive (`Supplier`) that mobile shops in Sri Lanka use for stock they don't carry in-house. It ships as four entities across two HTTP-facing modules plus one internal service:

| Module | Entity | HTTP surface | Role |
|--------|--------|--------------|------|
| Suppliers | `Supplier` | 7 endpoints | Friendly shops that source stock |
| Sales | `Sale` | 6 top-level endpoints + 6 sub-resource + 2 lifecycle = 14 | The sale itself |
| Sales | `SaleLine` | via sub-resource on Sale | Individual product lines |
| Sales | `Payment` | via sub-resource on Sale | Tender records |
| _(internal)_ | `SaleNumberCounter` | none | Per-branch, per-day invoice numbering |

Twenty-one HTTP endpoints in total. Read access is universal (any authenticated role); mutation access varies by operation — see the [RBAC matrix](#rbac-matrix) below.

## Entity Relationships

```
Supplier ────< SaleLine (external_supplier_id, nullable)

Branch ─┬─< Sale
        └─< (indirectly, every SaleLine's product)

User (cashier) ──< Sale
User (voider) ──< Sale (voided_by, nullable)

Sale ─┬─< SaleLine  (ON DELETE CASCADE — DRAFT lines only)
      └─< Payment   (ON DELETE CASCADE — DRAFT payments only)

Product ──< SaleLine (RESTRICT — deleted products break historical sales)

SaleNumberCounter (one row per branch, per day)
```

- Every `Sale` belongs to exactly one `Branch` and one `User` (the cashier).
- A `Sale` in `VOIDED` status also carries a second User reference (`voided_by`, the admin or manager who authorized the reversal).
- `SaleLine` and `Payment` cascade-delete only when the parent `Sale` is DRAFT and is discarded via `DELETE /sales/:id`. After completion, lines and payments are immutable.
- `SaleLine.external_supplier_id` is nullable — in-house lines have `NULL`; friendly-shop lines reference a `Supplier`.
- `SaleNumberCounter` holds one row per `(branch_id, sale_date)` pair, row-locked when issuing the next invoice number.

## The Sale Lifecycle

Every sale flows through a strict state machine:

```
DRAFT ──(POST /:id/complete)──> COMPLETED ──(POST /:id/void)──> VOIDED
  │                                 │                              │
  └── DELETE /:id (discard)         └── (immutable except void)    └── (terminal)
```

Valid transitions:

| From | To | Endpoint | Side effects |
|------|----|--------|--------------|
| _(nothing)_ | DRAFT | `POST /sales` | Creates empty cart |
| DRAFT | _(deleted)_ | `DELETE /sales/:id` | Hard delete of sale + lines + payments |
| DRAFT | COMPLETED | `POST /sales/:id/complete` | Decrements stock, issues invoice number, sets completed_at |
| COMPLETED | VOIDED | `POST /sales/:id/void` | Re-increments stock, stamps payments reversed, sets voided_at/by/reason. Refused once the sale has a return (409 `SALE_HAS_RETURNS`) |

A **return** (Phase 6.4 P7, `POST /sales/:id/returns`) is not a transition: the sale stays COMPLETED, its money unchanged, and only its lines' `returned_quantity` grows. Returns are their own records; see [returns.md](./returns.md).

Invalid transitions — all return `400 Bad Request`:

- DRAFT → DRAFT (already in that state)
- COMPLETED → DRAFT ("uncomplete" is not a thing — voided sales aren't uncompleted, they're marked reversed)
- COMPLETED → COMPLETED (a repeated complete — a double click, or a retry after a lost response — gets 400 "Cannot complete a COMPLETED sale. Only DRAFT sales can be completed." and changes nothing: `completeSale` locks the sale row before its DRAFT check, so a concurrent second call waits for the first to commit and then fails the check. Stock is never decremented twice. There is no idempotency key; a client that loses the response re-fetches the sale and treats COMPLETED as success)
- VOIDED → anything (VOIDED is terminal by design — if a void was itself a mistake, create a new sale)

### Why VOIDED is terminal

An "un-void" endpoint sounds convenient until you consider the accounting: it would let cashiers ping-pong the same sale between COMPLETED and VOIDED, doubling and un-doubling stock, doubling and un-doubling settlements, and destroying the audit trail. Financial reversal is a one-shot recorded event. If the void itself was an error, the correct fix is a new sale that reverses the reversal — leaving a complete audit history of both mistakes.

## Design Decisions

### DRAFT is mutable, COMPLETED and VOIDED are frozen

DRAFT sales are cart-scratch: cashier adds lines, changes quantities, applies discounts, records partial payments, undoes any of it. All those operations return `400 Bad Request` on any sale that isn't DRAFT.

#### Why

Once a sale is COMPLETED, it's a real financial record with an invoice number, cascade effects on stock, and possibly a printed receipt in the customer's hand. Mutating it would silently break receipts, reports, and inventory counts. The only "post-complete" mutation allowed is the sale-level void, which is a distinct, atomic, audited operation.

### Snapshot columns freeze pricing at ring-up time

`SaleLine` carries four snapshot columns filled from the parent `Product` at add-time and never updated after: `product_sku_snapshot`, `product_name_snapshot`, `unit_price`, `cost_price_snapshot`.

#### Why

Product prices change. A phone's `selling_price` might rise tomorrow. If the sale line stored only `product_id`, every historical receipt would silently re-render with today's price, and reports comparing "what did we sell it for" against "what does it cost now" would be structurally impossible.

Snapshotting is the standard e-commerce pattern for this exact reason. The cost of doubling ~40 bytes per line is negligible; the alternative (time-travelling the products table on every historical query) is unaffordable.

### Warranty per line

_(Phase 6.4 P5-18; replaced #32's `warranty_months_snapshot` + `checking_warranty_days_snapshot`.)_

Each line carries one warranty period, chosen at the till:

- `warranty` (`varchar(20) NOT NULL`, CHECK — the codes in [products.md](./products.md) "One default warranty period"). `addLine` sets it to the request's `warranty` if given, otherwise the product's `default_warranty`. `PATCH /sales/:id/lines/:lineId { warranty }` changes it while the sale is a DRAFT, for every line mode (serialized included) and every role; `null` or an unknown code is a 400, a non-DRAFT sale the usual 400. A warranty-only PATCH leaves the money untouched.
- `warranty_until` (`date`, nullable) — the last day of warranty, set by `completeSale` inside its transaction: the **Colombo** completion date plus the period (`WEEK_n` adds days; `MONTH_n` adds calendar months, clamped to the month's end, so 30 Jan + 1 month = 28 Feb). `NULL` for `NO_WARRANTY` and `CHECKING`, and on DRAFT lines.

Both come back on every hydrated sale's lines. The receipt prints them: "Warranty: 12 months (until 20 Oct 2027)", or "Checking only"; a `NO_WARRANTY` line prints nothing.

#### Why on the line, chosen at the till

The shop gives different warranties for the same product depending on the deal, so the product only supplies the starting point. Because the line can only change while it's a DRAFT, the value is fixed the moment the sale completes; later product edits never touch it, and a receipt reprinted months later shows what the customer bought. `warranty_until` is stored rather than recomputed so the receipt (and any later warranty lookup) reads one saved date, computed once on the server clock that also stamps `completed_at`.

### Money as `numeric(N,2)` in DB, strings in TypeScript

Every money column — `unit_price`, `subtotal`, `discount_amount`, `line_total`, `total`, `amount_paid`, `change_due`, `Payment.amount`, `Payment.cash_received` — is `numeric(12,2)` in Postgres and `string` in TypeScript.

#### Why

Same reasoning as the [Products doc](./products.md#prices-as-numeric102-in-db-strings-in-code). Applying JavaScript's IEEE-754 floats to money is a rounding-bug factory. Strings force arithmetic through decimal-safe helpers or Postgres itself. All money comparisons and subtractions (e.g., "does amount_paid equal total?", "is this payment within the remaining balance?") convert to integer cents via `toCents` (`common/utils/money.ts`, `Math.round(Number(x) * 100)`) first, dodging float representation edge cases: in floats `100.30 - 50.10` is `50.199999…`, which used to reject an exact-remainder payment of `50.20`.

### Line money in integer cents, half-up

`discount_amount` and `line_total` are computed in integer cents (`common/utils/money.ts`): `toCents` in, `fromCents` out. A PERCENT discount is `percentOfCentsHalfUp(unit_price × qty in cents, value)`, which multiplies by the percent in hundredths with BigInt and rounds half-up on the exact result. `line_total` is `unit_price × qty − discount_amount`, in cents.

#### Why

The old float path, `Math.round((value + Number.EPSILON) * 100) / 100`, only rescued half-cents below ~1: 50% of 4.35 is exactly 2.175 but stored 2.17. Cents make every result exact, so half-up is really half-up (2.18). This changed the stored `discount_amount` (by one cent) for such inputs; existing rows are not recomputed. _(Fixed with P5-20; was FOLLOWUPS "PERCENT discounts don't always round half-up".)_

`roundToCents` (the `+ Number.EPSILON` form) still rounds the stored `discount_value` and payment amounts, which are client inputs with at most 2 decimals.

### Line-level discounts only; no sale-level discount

The client sends `{ discount_type, discount_value }` per line. `discount_type` is one of:

- `AMOUNT` — LKR off the line, up to `unit_price × qty`.
- `PERCENT` — 0–100 (2 decimals) of `unit_price × qty`, half-up in cents.
- `UNIT_PRICE` (P5-20) — the final price **per unit**, `0` (free) up to `unit_price`. `discount_amount = (unit_price − value) × qty`, exact. Above `unit_price` is a 400 ("Price each X must be between 0.00 and the unit price Y"), backed by `CHK_sale_lines_discount_unit_price_range`; equal to `unit_price` is allowed and takes nothing off (the till removes the discount instead).

The server owns the resolved `discount_amount`, and re-resolves it on every quantity change, so `PERCENT` and `UNIT_PRICE` follow the quantity while `AMOUNT` stays fixed. Sale-level `discount_total` is `SUM(sale_lines.discount_amount)`.

#### Why no sale-level discount

Sale-level discounts sound flexible ("10% off the whole cart") but produce three problems: they compose weirdly with per-line discounts, they force complicated pro-rating for returns and voids, and they can't answer "what did we discount on this specific item?" for reporting. Line-level covers every real scenario a mobile shop encounters. If the cashier wants "10% off the whole cart", they apply it to each line.

### Client sends discount intent, server resolves the amount

The DTO takes `{ discount_type, discount_value }` — not `discount_amount`. The service computes the amount server-side from unit_price × quantity.

#### Why

Client-supplied `discount_amount` is a trust boundary you cannot defend. A malicious or buggy client could send `discount_amount: 500` on a line with `unit_price: 100, quantity: 1` and get a free product plus 400 rupees of change. Server-side resolution makes the math authoritative and the trust boundary irrelevant.

### DB CHECK constraints double as invariants

Every domain rule that can be expressed in SQL has a matching `CHECK` constraint at the DB, on top of service-layer validation:

- `CHK_sales_totals_nonneg` — no money field can go negative
- `CHK_sales_amount_paid_bounded` — `amount_paid <= total` (backstops the service's per-payment upper bound)
- `CHK_sales_voided_consistency` — `(status = 'VOIDED') = (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND length(trim(void_reason)) > 0)`
- `CHK_sales_completed_consistency` — `(status IN ('COMPLETED', 'VOIDED')) = (completed_at IS NOT NULL)`
- `CHK_sales_sale_number_when_completed` — `sale_number` is set iff status is COMPLETED or VOIDED
- `CHK_sale_lines_line_total` — line_total = ROUND(unit_price * quantity - discount_amount, 2)
- `CHK_sale_lines_discount_bounded` — `discount_amount <= unit_price * quantity`
- `CHK_sale_lines_discount_unit_price_range` — a `UNIT_PRICE` value is between 0 and `unit_price`
- `CHK_payments_cash_received_only_for_cash` — cash_received is set iff payment_method = 'CASH'
- `CHK_payments_cash_received_covers_amount` — cash_received >= amount for CASH rows
- `CHK_payments_reversal_consistency` — reversed_at is set iff reversal_reason is set and non-blank

#### Why defense in depth

Every service-layer check is one bug away from being wrong. The DB CHECKs are the last line of defense — if a code path forgets to validate, the DB fails the transaction cleanly instead of silently accepting bad state. In several tests, the DB CHECK caught what the service missed and the service was updated to match.

Cross-table invariants (e.g., "payment.reversed_at is set iff parent sale is VOIDED") can't be expressed as CHECKs — Postgres doesn't allow multi-table CHECKs — so those are service-only, enforced within a single transaction that mutates both tables together.

### Per-branch, per-day invoice numbering

`sale_number` follows the format `INV-YYYYMMDD-NNNN` — e.g., `INV-20260911-0007` is the 7th sale at some branch on Sep 11, 2026. **Uniqueness is per-branch:** two branches on the same day both have their own `-0001`.

`SaleNumberCounter` has one row per `(branch_id, kind, counter_date)` (`UQ_sale_counter_branch_kind_date`; Phase 6.4 P7-10 added `kind`). The `generateNext(branchId, manager?, kind = 'SALE')` method:

1. `SELECT ... FOR UPDATE` the counter row (creating it at `next_value = 1` if this is the first number of the day of that kind at this branch).
2. Read `next_value`, format as `INV-YYYYMMDD-NNNN` (kind `SALE`) or `RET-YYYYMMDD-NNNN` (kind `RETURN`, a return's number), increment and write back.
3. Return the formatted string.

The two kinds count separately: a return never takes an invoice number.

The service enlists in the caller's transaction (the same transaction that flips the sale to COMPLETED), so a failed complete doesn't burn a number.

#### Why not a global sequence

Two reasons. (1) Business meaning: shops want their own daily counter reset — `-0001` should be "today's first sale at this branch", not "the 47,832nd sale ever across all branches". (2) Timezone semantics: the day boundary is Asia/Colombo, not UTC — a sale at 23:59 Colombo time on Sep 11 gets a Sep 11 number, and one minute later a fresh counter kicks in.

#### Why row locks instead of a sequence

Sequences gap on rollback (a failed insert leaves a hole in the number space), which is unacceptable for a legal invoice format. Row-locked counters give us the same concurrency safety with zero gaps under successful completions. Gaps still happen when a completed sale is voided — that's fine, and expected.

### The Payment invariant hierarchy

Payments have a specific set of invariants layered across three levels:

**DTO layer:**
- `payment_method` must be a known enum value.
- `amount > 0`.
- CASH: `cash_received` required.
- Non-CASH: `reference_number` required.

**Service layer:**
- Cross-field: CASH → `cash_received >= amount`.
- Cross-field: non-CASH → `cash_received` must be `null`.
- Bounded above by `Sale.total - SUM(other payments)`, so `amount_paid` never exceeds `total`.

**DB layer:**
- `CHK_payments_amount_positive`
- `CHK_payments_cash_received_only_for_cash` — biconditional
- `CHK_payments_cash_received_covers_amount`
- `CHK_sales_amount_paid_bounded` on the parent Sale (backstop)

#### Why the same rule at all three layers

Different callers hit different layers. HTTP callers hit the DTO. Internal callers (tests, future queues, admin scripts) may skip the DTO. A bug in the service could still let bad state through. Each layer is one line of defense; three layers means bad data has to defeat all three to persist.

### `updatePayment` freezes `payment_method`

The payment update DTO accepts `amount`, `cash_received`, `reference_number`, `notes` — but NOT `payment_method`. Changing method is only possible via remove + re-add.

#### Why

Changing method (e.g., CASH to CARD) requires the cash-received field to disappear and the reference number to appear — a coherent state change that's hard to validate cleanly against a merged partial-update payload. More importantly, from an audit perspective, "converted 500 rupees from CASH to CARD" and "removed the 500 CASH payment, then added a 500 CARD payment" tell the same story with different clarity. The second version leaves two clean events in the audit history; the first buries the change in an update diff.

### Multi-tender with per-payment upper bound

A sale can have N payments. Each `Payment.amount` is bounded above by `Sale.total - SUM(other payments)`.

On update, "other" **excludes the payment being updated** — otherwise, updating a Rs. 500 payment to Rs. 500 would fail its own check because the sum would already include the value being replaced.

The bound also holds in the other direction: a line edit or remove that would drop `total` below `amount_paid` returns 400 "Cannot reduce the sale total below the amount already paid. Remove or reduce payments first." The totals recompute is a single `UPDATE`, and `CHK_sales_amount_paid_bounded` fires inside it (Postgres CHECKs can't be deferred), so the service maps that specific constraint violation to the 400 rather than pre-checking. The transaction rolls back and the sale is unchanged.

Change is only meaningful on CASH: `change_due = SUM(cash_received - amount) WHERE method = 'CASH'`. Non-CASH payments don't produce change.

> **Phase 6.3.5 addition:** `TRADE_IN` is a sixth payment method — the customer pays with a used phone. It has its own invariants, is frozen except for `notes` on update, and is materialized into inventory by `completeSale` and reversed by `voidSale`. See [used-phones.md § Trade-ins](./used-phones.md#trade-ins-slice-g).

### `completeSale` is a single atomic transaction

Inside one Postgres transaction with the sale row `pessimistic_write`-locked:

1. Load + lock the sale, assert it's DRAFT.
2. Load lines, assert at least one exists (400 otherwise).
3. Assert `amount_paid === total` via cents-integer comparison (400 for underpayment; DB CHK stops overpayment separately). Then lock the Stock and ProductUnit rows ("Lock order" below), then **today's cash day at the sale's branch `FOR SHARE`**, refusing with 409 `DAY_NOT_OPEN` / `DAY_CLOSED` (Phase 6.4 P9, [cash-days.md](./cash-days.md#enforcement-backend-0b)).
4. For each in-house line (`external_supplier_id IS NULL`): decrement stock via `StockService.decrementForSale`, enlisted in the same transaction. A serialized in-house line also flips its ProductUnit to SOLD.
5. For each TRADE_IN payment: check the customer and their NIC, then materialize the trade-in (see [used-phones.md](./used-phones.md#trade-ins-slice-g)).
6. Issue the invoice number via `SaleNumberCountersService.generateNext`, also enlisted.
7. Set each line's `warranty_until` from its warranty period (see "Warranty per line").
8. UPDATE the sale: `status = COMPLETED, sale_number = <issued>, completed_at = now()`.

If any step fails — insufficient stock, DB error, anything — the whole transaction rolls back. No partial completion is possible.

#### Error bodies

Every failure leaves the sale a DRAFT with nothing changed. The 409s name what failed so a client can point at it (Phase 6.4 P5):

| Cause | Status | Body |
|---|---|---|
| Sale not found | 404 | `Sale not found` |
| Not a DRAFT | 400 | `Cannot complete a COMPLETED sale. Only DRAFT sales can be completed.` (or VOIDED) |
| No lines | 400 | `Cannot complete a sale with no lines. Add at least one line first.` |
| `amount_paid` ≠ `total` | 400 | `Cannot complete sale: amount_paid X does not equal total Y` |
| Today (database clock, Colombo) has no cash day at the sale's branch (Phase 6.4 P9, C10) | 409 | `{ message, code: 'DAY_NOT_OPEN', business_date }` |
| Today's cash day is closed (C11) | 409 | `{ message, code: 'DAY_CLOSED', business_date }` |
| Not enough stock (the first short line) | 409 | `{ message: 'Insufficient stock for "<name>": requested N, available M', product_id, sale_line_id }` |
| A line's phone is no longer IN_STOCK (another sale sold it) | 409 | `{ message: "Cannot sell IMEI '<imei>'…", existing_unit }` — `existing_unit.id` is the line's `product_unit_id` |
| TRADE_IN without a customer, or the customer has no NIC | 400 | `Cannot complete sale: TRADE_IN payments require a customer…` / `A trade-in needs the customer's NIC` |
| Trade-in product deactivated since `addPayment` | 400 | `Product "<name>" is inactive` |
| Trade-in IMEI now held by the shop | 409 | `{ message: 'IMEI already exists in inventory', imei, payment_id, existing_unit }` — `existing_unit` is `null` when a concurrent intake was caught by the live-IMEI index |

#### Why sequential stock decrements instead of Promise.all

The `SELECT ... FOR UPDATE` locks acquired on stock rows during decrement serialize per (product, branch). Sequential iteration lets these locks queue cleanly; `Promise.all` would fire all locks at once, potentially deadlocking against a concurrent transaction that acquired them in a different order. Since Phase 6.4 P7-25 the rows are locked up front in one global order (next section), so the per-line loop no longer decides the lock order.

### Lock order

_(Phase 6.4 P7-25, step 0c; step 4 added in P9 backend 0b.)_ Every transaction that changes stock or product units takes its row locks in one order:

1. **Its sale row**, if it has one (at most one, always first).
2. **Every Stock row it will touch, sorted by `(product_id, branch_id)`.**
3. **Every ProductUnit row it will touch, sorted by `id`.**
4. **Today's `cash_days` row at the sale's branch, `FOR SHARE`** (complete, void and return only; `assertDayOpen` in `backend/src/cash-days/day-gate.ts`, P9-10). Selected by `(branch_id, business_date)` with no `closed_at` filter; open or closed is decided in code on the row returned.
5. **Then everything else:** the changes and their checks, inserts (a new unit's insert may wait on `uq_product_units_imei_live`, always after the Stock locks), the sale-number counter, audit rows.

Steps 2 and 3 are `lockInventoryRows(manager, { stock, unitIds })` (`backend/src/stock/lock-inventory-rows.ts`): one `SELECT … FOR UPDATE` per row, sorted and de-duplicated. It only locks. A row that doesn't exist is skipped, so the caller's existing code raises exactly what it raised before. `StockService` and `ProductUnitsService` methods lock their row again, which costs nothing once the transaction holds it. A transaction that needs only one kind of row passes only that kind. Each caller collects its targets before changing anything, after the checks that need no locks:

| Caller | Stock rows | Units |
|---|---|---|
| `completeSale` | In-house lines' products; each trade-in's product (the trade-in payments are read before the line loop) | Lines' `product_unit_id` (trade-in units don't exist yet; they are inserted after the locks) |
| `voidSale` | In-house lines' products; each trade-in unit's product | Lines' `product_unit_id`; the trade-in units, found by reading `phone_purchase_id` first without a lock (a purchase's unit and that unit's product and branch never change). A payment never stamped, or a purchase with no unit, is skipped here and raises its integrity error where it always did |
| `PhonePurchasesService.create`, `createForTradeIn` | The phone's product, after the IMEI pre-check and before the inserts (so a race still gets the same 409) | — |
| `SaleReturnsService` (a return, Phase 6.4 P7) | The lines going back to stock (in-house, not a phone, `condition: RESALEABLE`) | The returned phones' `product_unit_id` |
| `ProductUnitsService.passInspection` | The unit's product | The unit |

`completeSale`, `voidSale` and the return's transaction then take step 4; the phone purchase and the inspection pass don't (they move no drawer cash, P9-24).

#### Why the cash day comes fourth, and why close can't deadlock

_(Phase 6.4 P9-10.)_ Sales take `FOR SHARE`, so they never block one another. Closing a day (`POST /cash-days/:id/close`) takes `FOR UPDATE` on that row and nothing else before its summary, so it waits for the sales already holding the row and then counts their cash; a sale arriving while the close holds it waits, and under READ COMMITTED gets the row as the close left it: 409 `DAY_CLOSED`. That is why the lock has no `closed_at` filter: with one, the re-checked row would drop out and the sale would get `DAY_NOT_OPEN`. Taking the day after the sale, Stock and unit rows keeps one global order, and close holds only the day row, so no wait cycle is possible: a sale waiting on the day holds rows close never asks for, and anything holding step-5 resources (the counter) already holds its `FOR SHARE`. The close's other locks are `FOR KEY SHARE` on the closer's `users` row (the `closed_by` and audit foreign keys); the approval PIN check locks an approver's row `FOR UPDATE` only in its own transaction, committed before the void's or return's opens. `test/cash-days-enforcement.e2e-spec.ts` forces both orders with a gate.

#### Why

Before, `completeSale` and `voidSale` locked rows line by line, and a trade-in void locked the unit before its stock while a sale locks stock before the unit. Two requests touching the same rows in a different order each held a row the other needed, and Postgres killed one with a deadlock (`40P01`, a 500 at the till): two sales with the same products in a different line order, a sale and a void, a trade-in void racing a sale of that phone, a trade-in and a sale of that model. With one order, whichever request gets the first shared row goes first and the other waits; it then gets exactly the result it would have had if it had been sent second (a 200, or the usual 409). `test/lock-order.e2e-spec.ts` forces each of those interleavings with a gate (a second connection holding one row) and checks that both requests finish, plus rounds of ungated opposite-order pairs. Any new code that changes stock or units (P7's inspection pass and returns) calls `lockInventoryRows` the same way.

#### Why the invoice number is issued INSIDE the transaction

Because if we issued it first and then rolled back on insufficient stock, the number would be permanently burned with no matching sale — a gap in the sequence that auditors would flag. Issuing inside the transaction means a rollback releases the number to be reissued by the next successful complete. Gaps still occur when a completed sale is later voided — that's the acceptable trade-off (voided sales retain their number forever).

### External-supplier lines don't touch our stock

Lines with `external_supplier_id` set represent phones or accessories sourced from a friendly shop rather than our own inventory. On completion, we skip stock decrement for these lines. On void, we skip stock re-increment.

#### Why the skip is symmetric

Symmetry is correctness. If complete decrements external lines from our stock (which it shouldn't), void would need to re-increment them (which it also shouldn't). Both skip means our stock counts reflect only our inventory — the friendly-shop settlement flow (Phase 6.7) tracks external inventory separately via `Supplier.getSalesCount` and the eventual per-supplier settlement report.

### `voidSale` is the mirror of `completeSale`

Same transactional shape, same row lock, same enlistment pattern — with three differences:

1. **Precondition**: sale must be COMPLETED (not DRAFT).
2. **Stock direction**: uses `StockService.incrementForReversal` instead of `decrementForSale`. No upper bound to check — stock can go arbitrarily high on reversal.
3. **Payment side effect**: single UPDATE stamps `reversed_at = now(), reversal_reason = <void_reason>` on every payment on this sale.

Fields preserved on the voided record: `sale_number`, `completed_at`, all lines, payment amounts. Nothing is zeroed out or deleted — void is a mark, not an eraser.

#### When a later transaction blocks the void

A void is refused with 409, and nothing changes, when a phone it would move has been handed on since. The body names why and which sale to void first (Phase 6.4 P6-22):

| `reason` | Cause | `later_sale` | Message |
|---|---|---|---|
| `RESOLD` | A trade-in phone from this sale was sold on a later sale | That sale (the most recently completed one with a line on the unit) | `Cannot void this sale: trade-in phone (IMEI '<imei>') has been resold in a subsequent sale…` |
| `TAKEN_BACK_ON_SALE` | A phone this sale sold was traded back in on a later sale (buy-back) | The sale whose TRADE_IN payment took it back | `Cannot void this sale: the phone (IMEI '<imei>') was taken back into stock on a later sale or purchase…` |
| `BOUGHT_BACK_ON_PURCHASE` | A phone this sale sold was bought back on a later phone purchase | `null` | `This sale can't be voided: the phone (IMEI <imei>) was bought back on a later purchase.` — permanent: a phone purchase is a real transaction of its own and is never reversed |
| `null` | A concurrent take-back caught only by the live-IMEI index | `null` | The generic "taken back" message; `existing_unit` is null too |

Every body is `{ message, imei, reason, later_sale: { id, sale_number } | null, existing_unit }`. Voids unwind newest-first: void `later_sale`, then this one.

#### Why payments stamped in a single UPDATE, not a loop

Unlike stock (which needs per-line branching on `external_supplier_id`), every payment on a voided sale gets identical treatment: same `reversed_at`, same `reversal_reason`. A single `UPDATE payments SET ... WHERE sale_id = $1` is far cheaper than N individual round trips and equally correct.

### Void requires a reason (defense in depth)

`void_reason` is required at three layers:

- **DTO** (`VoidSaleDto`): `@MinLength(3)` after `@Transform` trims whitespace.
- **Service** (`voidSale`): re-validates length >= 3 after `.trim()` before opening the transaction — protects internal callers that bypass the DTO.
- **DB** (`CHK_sales_voided_consistency`): `length(trim(void_reason)) > 0` when `status = 'VOIDED'`.

#### Why redundant

Different callers hit different layers, and each layer has one job. A silent void is how fraud happens. Every void lands in the audit log with a stated reason.

### Every void is approved with a manager's PIN

_(Revised Phase 6.4 P6-17; was "Void restricted to admin + manager".)_ `POST /sales/:id/void` takes `{ void_reason, approval: { approver_id, pin } }`, and `approval` is required on **every** void, a manager's or admin's own session included. Any role may call it, but only for a sale at their own branch (admins: any branch; otherwise 403 `VOID_WRONG_BRANCH`). The approver must be an active admin, or an active manager of the sale's branch, with an approval PIN; they may be the session user. The PIN check, its lockout and its error codes are in [approvals.md](./approvals.md).

Order of work: a pre-check without locks (404, not COMPLETED 400, the branch check, then 409 `SALE_HAS_RETURNS` when the sale has any return, Phase 6.4 P7-11, then 409 `DAY_NOT_OPEN` / `DAY_CLOSED` when today's cash day at the sale's branch isn't open, P9-9), so a void that can't happen never uses a PIN attempt; then the PIN check in **its own committed transaction**; then the void's transaction as before, which checks `SALE_HAS_RETURNS` again under the sale lock (a return holds that lock while it commits, so none can slip in) and the day again under `FOR SHARE` (lock-order step 4). The day is **today's**, whenever the sale was completed: voiding an earlier day's sale needs today open, and its cash counts on today (P9-6).

#### Why a sale with a return can't be voided

A void puts back the full quantity of every line and moves every sold phone back to IN_STOCK. After a return that would restock the returned items twice, and fail on a phone in INSPECTION. Returns are final too: a mistaken return is put right with a new sale. The body is `{ message, code: 'SALE_HAS_RETURNS' }`.

Recorded: `voided_by` = the **approver** (the admin or manager who authorized it, as before), `void_requested_by` = the **session user** (the same person when a manager approves their own). `CHK_sales_void_requested_consistency` requires `void_requested_by` exactly on VOIDED sales; the migration backfilled it with `voided_by` on earlier voids. `findOne` loads both (`voider`, `void_requester`). The VOID audit row is written **inside the void's transaction** (not by the `AuditLogInterceptor`, which has no changes for VOID and doesn't know the approver): actor = the session user, `changes` with `voided_by` and `void_requested_by`, and a description naming both.

#### Why

Standard POS control pattern — the "supervisor swipe" for reversals, done at the till: a manager enters their PIN on the cashier's screen instead of logging in. Requiring the PIN on a manager's own session too means a till left logged in as a manager can't void on its own.

## Cross-Entity Flows

### `completeSale` → StockService.decrementForSale (per line)

Inside the same transaction that flips the sale:

1. `SELECT ... FOR UPDATE` the stock row for `(product_id, branch_id)` — serializes concurrent completes on the same product.
2. If `stock.manage_stock = false`: silent no-op (services, reloads, unlimited SIMs).
3. If `stock.quantity < qty`: throw `ConflictException` with product name and available quantity → rolls back the entire transaction, returns `409 Conflict` with a message the frontend can render. The body is `{ message, product_id }`; `completeSale` adds the `sale_line_id`.
4. Otherwise: `UPDATE stock SET quantity = quantity - $qty` via SQL-side arithmetic (avoids read-then-write lost updates).

Missing stock row throws a raw `Error` (500) — data integrity failure, since Products auto-creates stock rows at product creation.

### `voidSale` → StockService.incrementForReversal (per line)

Mirror of the above, with three asymmetries:

- No upper bound (stock can go arbitrarily high on reversal — no `ConflictException` path).
- No product name parameter (no user-facing error that would need it).
- Otherwise identical: same lock, same manage_stock skip, same SQL-side arithmetic (`quantity + $qty`).

### `Supplier.getSalesCount` — how many sales did we source from this shop?

`COUNT DISTINCT sale.id` where `sale_lines.external_supplier_id = <supplier>` AND `sale.status = 'COMPLETED'`.

Two design calls:

- **DISTINCT**: a sale with three lines from Ranjith counts as ONE settlement transaction, not three.
- **COMPLETED only**: VOIDED sales no longer owe the supplier; DRAFT sales aren't commitments.

Used by the admin supplier page ("cannot deactivate, has 12 sales" context) and the Phase 6.7 settlement flow.

## Endpoint Reference

All endpoints are prefixed with `/api/v1` and require authentication via the `access_token` cookie unless noted.

### Suppliers

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/suppliers` | any | List suppliers (active by default; `?includeInactive=true` includes deactivated) |
| GET | `/suppliers/:id` | any | Get one supplier by UUID |
| GET | `/suppliers/:id/sales-count` | admin | Count of DISTINCT COMPLETED sales sourced from this supplier |
| POST | `/suppliers` | admin | Create supplier (case-insensitive unique name enforced by DB) |
| PATCH | `/suppliers/:id` | admin | Update supplier fields |
| DELETE | `/suppliers/:id` | admin | Deactivate (soft — preserves history on past sale lines) |
| POST | `/suppliers/:id/reactivate` | admin | Reactivate a deactivated supplier |

### Sales — top-level

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/sales` | any | List sales (paginated, filterable by branch/cashier/status/date range). Rows carry branch, cashier and customer (soft-deleted included). Phase 6.4 P6 adds `completedFrom` / `completedTo` (inclusive / exclusive on `completed_at`; a timestamp with a time and an offset, date-only is a 400; excludes drafts), `sort=completed_at` (newest first, drafts last, ties by `created_at`) and `q` (sale number, customer name or phone by case-insensitive substring, or an exact IMEI on a sale line or a trade-in payment; 2–100 characters). IMEI matches are EXISTS subqueries, so a sale appears once however many of its lines match. Phase 6.4 P7: each row gains `return_state` (`NONE` / `PARTIAL` / `FULL`) and `refunded_total`, and `q` also matches `RET-` numbers ([returns.md](./returns.md)) |
| GET | `/sales/:id` | any | Get one sale with nested branch, cashier, customer, voider (soft-deleted included), lines (each with `returned_quantity`), payments, and `returns[]` (Phase 6.4 P7; approver and requester as `{ id, full_name }` only) |
| POST | `/sales` | any | Create a DRAFT sale (empty cart) |
| PATCH | `/sales/:id` | any | Update DRAFT sale (notes, customer_id only) |
| DELETE | `/sales/:id` | any | Discard a DRAFT sale (hard delete; cascade removes lines + payments) |

### Sales — line sub-resource

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/sales/:saleId/lines` | any | Add a line to DRAFT sale; returns updated sale |
| PATCH | `/sales/:saleId/lines/:lineId` | any | Update a line (quantity, discount, external_supplier_id, imei_snapshot); returns updated sale |
| DELETE | `/sales/:saleId/lines/:lineId` | any | Remove a line; line_number gaps NOT renumbered |

### Sales — payment sub-resource

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/sales/:saleId/payments` | any | Record a tender on DRAFT sale (multi-tender supported); returns updated sale |
| PATCH | `/sales/:saleId/payments/:paymentId` | any | Update a payment (amount, cash_received, reference, notes); method is FROZEN |
| DELETE | `/sales/:saleId/payments/:paymentId` | any | Remove a payment; recomputes amount_paid + change_due |

### Sales — lifecycle

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/sales/:id/complete` | any | DRAFT → COMPLETED. Decrements stock, issues invoice number, sets completed_at. Auditable. |
| POST | `/sales/:id/void` | any, at the sale's branch | COMPLETED → VOIDED with a manager's approval PIN (`approval: { approver_id, pin }`, required). Re-increments stock, stamps payments reversed, sets voided_at/by (approver)/reason and void_requested_by (session user). Audited in the void's transaction. 409 `SALE_HAS_RETURNS` once the sale has a return; 409 `DAY_NOT_OPEN` / `DAY_CLOSED` unless today's cash day is open. |
| POST | `/sales/:id/returns` | any, at the sale's branch | A return with refunds, approved with a manager's PIN; the sale stays COMPLETED. 201 `{ return_id, sale }`, 200 on an accepted resend. See [returns.md](./returns.md) |
| GET | `/sale-returns/inspection` | admin, manager (own branch) | Returned phones waiting for inspection at a branch. See [returns.md](./returns.md) |

## RBAC Matrix

| Operation | Admin | Manager | Cashier |
|-----------|:-----:|:-------:|:-------:|
| Read (any sale, supplier, line, payment) | ✅ | ✅ | ✅ |
| Read supplier sales-count | ✅ | ❌ | ❌ |
| Create/update/deactivate suppliers | ✅ | ❌ | ❌ |
| Create/update/delete DRAFT sales | ✅ | ✅ | ✅ |
| Add/update/remove lines on DRAFT sales | ✅ | ✅ | ✅ |
| Add/update/remove payments on DRAFT sales | ✅ | ✅ | ✅ |
| Complete a DRAFT sale | ✅ | ✅ | ✅ |
| Void a COMPLETED sale (with an admin's or manager's PIN, every time) | ✅ | ✅ | ✅ |
| Return items on a COMPLETED sale (with an admin's or manager's PIN, every time; Phase 6.4 P7) | ✅ | ✅ | ✅ |
| List returned phones waiting for inspection (managers: own branch) | ✅ | ✅ | ❌ |

Two design intentions codified in the matrix:

- **Cashiers can do the routine day-to-day**: build carts, take payments, complete sales. They cannot manage suppliers (admin-only), and they void only with a manager's PIN entered at the till (Phase 6.4 P6-17; before that, cashiers could not void at all).
- **Multi-branch scoping is deferred**: today, all reads are unscoped by branch. When multi-branch launch happens (planned R9), staff will see only their own branch's sales by default.

## Migration Notes

Six migrations shipped in Phase 6.3, one per major schema unit, in dependency order:

| Order | Migration | Notes |
|-------|-----------|-------|
| 1 | `CreateSuppliersTable` | Includes functional unique index `LOWER(name) WHERE deleted_at IS NULL` |
| 2 | `CreateSaleNumberCountersTable` | Unique per `(branch_id, sale_date)` |
| 3 | `CreateSalesTable` | Includes all void columns (voided_at, voided_by) and status/completed_at/sale_number CHKs |
| 4 | `CreateSaleLinesTable` | 11 CHK constraints; partial index on `external_supplier_id WHERE NOT NULL` |
| 5 | `CreatePaymentsTable` | 4 CHK constraints including biconditional CASH ↔ cash_received; adds `CHK_sales_amount_paid_bounded` to sales |
| 6 | `AddVoidReasonAndPaymentReversal` | Slice G: adds `sales.void_reason`, `payments.reversed_at`, `payments.reversal_reason`; extends `CHK_sales_voided_consistency` |

All six run cleanly on an empty DB and revert cleanly in reverse order. Verified end-to-end during Phase 6.3.

Later sales migrations: Phase 6.4 P5 added `AddSaleLinesWarrantySnapshot` (`sale_lines.warranty_months_snapshot` and `checking_warranty_days_snapshot`), then P5-18's `WarrantyPeriodPerLine` replaced them with `sale_lines.warranty` + `warranty_until` and `products.default_warranty` (dropping `warranty_months` / `checking_warranty_days`). It maps the old values to codes and backfills existing lines; `down()` restores the old columns from the codes. See "Warranty per line". Phase 6.4 P6 added `AddSalesBranchCompletedAtIndex` (`idx_sales_branch_completed_at` on `(branch_id, completed_at)`, for the till's recent-sales list) and `AddApprovalPinAndVoidRequestedBy` (the approval PIN columns on `users`, and `sales.void_requested_by` backfilled from `voided_by`; see [approvals.md](./approvals.md)). Phase 6.4 P7 added `CreateSaleReturns`: `sale_lines.returned_quantity`, `sale_number_counters.kind` with its new unique key, and the `sale_returns`, `sale_return_lines` and `sale_refunds` tables; `down()` refuses while any return exists. See [returns.md](./returns.md).

## Test Coverage

Phase 6.3 adds **235 tests** on top of the existing 286 from prior phases, bringing the backend suite to **583 tests total** (345 unit + 238 e2e), all green.

Phase 6.3 additions, per major slice:

| Slice | Unit | E2e |
|-------|:----:|:---:|
| A — Suppliers CRUD | 25 | 30 |
| B — SaleNumberCounter | 13 | — (internal) |
| C — Sale entity + DRAFT CRUD | 26 | 33 |
| D — SaleLine + line management | 30 | 15 |
| E — Payment + payment management | 16 | 10 |
| F — Stock hooks + completeSale | 16 | 12 |
| G — Void | 19 | 14 |
| H — Real supplier sales-count | +3 net | +6 net |
| **Phase 6.3 subtotal** | ~148 | ~120 |

Key testing decisions from Phase 6.3 (see [testing.md](./testing.md) for general infrastructure):

- **Sales e2e re-seeds `SkuBarcodeCounter`** after every truncate (same pattern as Products e2e — needed because sales flows create products).
- **Cents-integer comparison for money assertions** — response bodies return money as strings (`"500.00"`), so tests assert against exact strings, not float equality.
- **E2e for stock-touching operations verifies DB state directly** via `repo.findOne`, not just the response body — the response is a snapshot, the DB is truth.
- **Void e2e uses the real `/complete` endpoint** to set up state (not manual DB flips), so the tests exercise the full production pipeline end-to-end.

## Known Followups

Tracked open items from Phase 6.3:

- **SalesService is approaching 1000+ lines**. Consider splitting into `SaleLinesService`, `SalePaymentsService`, and an orchestrating `SalesService` in a future refactor. Non-urgent; only refactor when it starts to hurt.
- **AuditLogInterceptor pre-fetches target entity by ID before `ParseUUIDPipe` runs**, so malformed UUID params on `@Auditable` routes surface as 500 (Postgres invalid-uuid) instead of 400. Affects every `@Auditable` endpoint with a UUID param. Not a security issue; wrong status code.
- **Extend `ProductType` enum for real-business coverage**. DB CHK exists at `1785308050748-CreateProductsTable.ts`; needs enum edit + migration to drop/recreate the CHK.
- **Concurrent-sale hardening**. Row-level locks on stock decrement are in place; wider stress-testing deferred to multi-cashier launch.
- **Audit log write teardown noise in e2e**. Fire-and-forget audit writes log errors when the Jest teardown closes the DB pool mid-write. Cosmetic; got louder with each `@Auditable` endpoint added in F and G.
- ~~**Per-phone IMEI tracking**~~ — done in Phase 6.3.5 Slice E. Serialized in-house lines resolve `imei_snapshot` to a `ProductUnit`; see [used-phones.md](./used-phones.md).
- **SaleNumberCounter real-DB concurrency test**. Currently mocked; add a real concurrent test if a race bug ever surfaces.

## Future Work

- ~~**Phase 6.3.5 — Used Phones**~~ — complete. Customers, per-IMEI `ProductUnit`, `PhonePurchase` intake, serialized sale lines, and the `TRADE_IN` payment method. See [used-phones.md](./used-phones.md).
- **Phase 6.4 — POS Terminal frontend**: the visual cart, tender flow, and completion UX consuming everything in this doc.
- **Phase 6.5 — Parked sales**: multi-cart-in-flight per cashier.
- **Phase 6.6 — Receipts**: thermal print + SMS.
- **Phase 6.7 — External sourcing settlement**: uses `Supplier.getSalesCount` + a new per-supplier settlement report to compute what SOCIO.LK owes each friendly shop.
- **Phase 6.8 — User management frontend**.
- **Phase 6.9 — R1 polish + AWS deployment**.