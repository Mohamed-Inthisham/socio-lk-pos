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
| COMPLETED | VOIDED | `POST /sales/:id/void` | Re-increments stock, stamps payments reversed, sets voided_at/by/reason |

Invalid transitions — all return `400 Bad Request`:

- DRAFT → DRAFT (already in that state)
- COMPLETED → DRAFT ("uncomplete" is not a thing — voided sales aren't uncompleted, they're marked reversed)
- COMPLETED → COMPLETED (idempotency not offered — a repeated complete on a real sale would double-decrement stock)
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

### Money as `numeric(N,2)` in DB, strings in TypeScript

Every money column — `unit_price`, `subtotal`, `discount_amount`, `line_total`, `total`, `amount_paid`, `change_due`, `Payment.amount`, `Payment.cash_received` — is `numeric(12,2)` in Postgres and `string` in TypeScript.

#### Why

Same reasoning as the [Products doc](./products.md#prices-as-numeric102-in-db-strings-in-code). Applying JavaScript's IEEE-754 floats to money is a rounding-bug factory. Strings force arithmetic through decimal-safe helpers or Postgres itself. All money-comparison operations (e.g., "does amount_paid equal total?") convert to cents-integer via `Math.round(Number(x) * 100)` before comparing, dodging float representation edge cases.

### Half-up rounding to two decimals

All computed money values are rounded with:

```typescript
(Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2)
```

#### Why the `+ Number.EPSILON`

Without it, a computed value like `1.005` (which is actually stored as `1.00499999...` in IEEE-754) rounds DOWN to `1.00` instead of the intended half-up `1.01`. `Number.EPSILON` is `2.22e-16` — vanishingly small next to any real LKR value, so it never affects legitimate math, but nudges float-representation edge cases the right way.

### Line-level discounts only; no sale-level discount

The client sends `{ discount_type, discount_value }` per line. `discount_type` is either `AMOUNT` (LKR off the line) or `PERCENT` (0–100). The server owns the resolved `discount_amount`. Sale-level `discount_total` is `SUM(sale_lines.discount_amount)`.

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
- `CHK_payments_cash_received_only_for_cash` — cash_received is set iff payment_method = 'CASH'
- `CHK_payments_cash_received_covers_amount` — cash_received >= amount for CASH rows
- `CHK_payments_reversal_consistency` — reversed_at is set iff reversal_reason is set and non-blank

#### Why defense in depth

Every service-layer check is one bug away from being wrong. The DB CHECKs are the last line of defense — if a code path forgets to validate, the DB fails the transaction cleanly instead of silently accepting bad state. In several tests, the DB CHECK caught what the service missed and the service was updated to match.

Cross-table invariants (e.g., "payment.reversed_at is set iff parent sale is VOIDED") can't be expressed as CHECKs — Postgres doesn't allow multi-table CHECKs — so those are service-only, enforced within a single transaction that mutates both tables together.

### Per-branch, per-day invoice numbering

`sale_number` follows the format `INV-YYYYMMDD-NNNN` — e.g., `INV-20260911-0007` is the 7th sale at some branch on Sep 11, 2026. **Uniqueness is per-branch:** two branches on the same day both have their own `-0001`.

`SaleNumberCounter` has one row per `(branch_id, sale_date)`. The `generateNext` method:

1. `SELECT ... FOR UPDATE` the counter row (creating it at `next_value = 1` if this is the first sale of the day at this branch).
2. Read `next_value`, format as `INV-YYYYMMDD-NNNN`, increment and write back.
3. Return the formatted string.

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

Change is only meaningful on CASH: `change_due = SUM(cash_received - amount) WHERE method = 'CASH'`. Non-CASH payments don't produce change.

### `completeSale` is a single atomic transaction

Inside one Postgres transaction with the sale row `pessimistic_write`-locked:

1. Load + lock the sale, assert it's DRAFT.
2. Load lines, assert at least one exists (400 otherwise).
3. Assert `amount_paid === total` via cents-integer comparison (400 for underpayment; DB CHK stops overpayment separately).
4. For each in-house line (`external_supplier_id IS NULL`): decrement stock via `StockService.decrementForSale`, enlisted in the same transaction.
5. Issue the invoice number via `SaleNumberCountersService.generateNext`, also enlisted.
6. UPDATE the sale: `status = COMPLETED, sale_number = <issued>, completed_at = now()`.

If any step fails — insufficient stock, DB error, anything — the whole transaction rolls back. No partial completion is possible.

#### Why sequential stock decrements instead of Promise.all

The `SELECT ... FOR UPDATE` locks acquired on stock rows during decrement serialize per (product, branch). Sequential iteration lets these locks queue cleanly; `Promise.all` would fire all locks at once, potentially deadlocking against a concurrent transaction that acquired them in a different order.

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

#### Why payments stamped in a single UPDATE, not a loop

Unlike stock (which needs per-line branching on `external_supplier_id`), every payment on a voided sale gets identical treatment: same `reversed_at`, same `reversal_reason`. A single `UPDATE payments SET ... WHERE sale_id = $1` is far cheaper than N individual round trips and equally correct.

### Void requires a reason (defense in depth)

`void_reason` is required at three layers:

- **DTO** (`VoidSaleDto`): `@MinLength(3)` after `@Transform` trims whitespace.
- **Service** (`voidSale`): re-validates length >= 3 after `.trim()` before opening the transaction — protects internal callers that bypass the DTO.
- **DB** (`CHK_sales_voided_consistency`): `length(trim(void_reason)) > 0` when `status = 'VOIDED'`.

#### Why redundant

Different callers hit different layers, and each layer has one job. A silent void is how fraud happens. Every void lands in the audit log with a stated reason.

### Void restricted to admin + manager

Cashiers can `POST /sales/:id/complete` (routine) but not `POST /sales/:id/void`. Voids require admin or manager authorization.

#### Why

Standard POS control pattern — the "supervisor swipe" for reversals. A cashier who accidentally rang up the wrong item on a completed sale calls a manager over to void it. This aligns the system with the real-world control the shop already has and prevents casual reversal of transactions.

## Cross-Entity Flows

### `completeSale` → StockService.decrementForSale (per line)

Inside the same transaction that flips the sale:

1. `SELECT ... FOR UPDATE` the stock row for `(product_id, branch_id)` — serializes concurrent completes on the same product.
2. If `stock.manage_stock = false`: silent no-op (services, reloads, unlimited SIMs).
3. If `stock.quantity < qty`: throw `ConflictException` with product name and available quantity → rolls back the entire transaction, returns `409 Conflict` with a message the frontend can render.
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
| GET | `/sales` | any | List sales (paginated, filterable by branch/cashier/status/date range) |
| GET | `/sales/:id` | any | Get one sale with nested branch, cashier, lines, payments |
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
| POST | `/sales/:id/void` | admin, manager | COMPLETED → VOIDED. Re-increments stock, stamps payments reversed, sets voided_at/by/reason. Auditable. |

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
| Void a COMPLETED sale | ✅ | ✅ | ❌ |

Two design intentions codified in the matrix:

- **Cashiers can do the routine day-to-day**: build carts, take payments, complete sales. They cannot manage suppliers (admin-only) or void sales (supervisor swipe).
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
- **Per-phone IMEI tracking**. `imei_snapshot` is free-text in 6.3; will be validated against `ProductUnit` for serialized products in Phase 6.3.5.
- **SaleNumberCounter real-DB concurrency test**. Currently mocked; add a real concurrent test if a race bug ever surfaces.

## Future Work

- **Phase 6.3.5 — Used Phones**: `Customer`, `PhonePurchase`, `ProductUnit` entities. Per-unit tracking for phones brought forward from R2.
- **Phase 6.4 — POS Terminal frontend**: the visual cart, tender flow, and completion UX consuming everything in this doc.
- **Phase 6.5 — Parked sales**: multi-cart-in-flight per cashier.
- **Phase 6.6 — Receipts**: thermal print + SMS.
- **Phase 6.7 — External sourcing settlement**: uses `Supplier.getSalesCount` + a new per-supplier settlement report to compute what SOCIO.LK owes each friendly shop.
- **Phase 6.8 — User management frontend**.
- **Phase 6.9 — R1 polish + AWS deployment**.