# Used Phones Backend (Phase 6.3.5)

## Status

**Phase 6.3.5 is complete and ready for PR to `develop`.** All seven slices have shipped on `feature/phase-6.3.5-used-phones-backend`:

| Slice | Scope | Status |
|-------|-------|:------:|
| A | Customers — entity, CRUD, SL phone normalization | ✅ |
| B | `sales.customer_id` FK + reference validation | ✅ |
| C | `ProductUnit` — per-IMEI inventory (schema) | ✅ |
| D | `PhonePurchase` — used-phone intake + admin read | ✅ |
| E | Serialized sale lines — IMEI-resolved lines, PU transitions on complete/void | ✅ |
| G | Trade-ins — `TRADE_IN` payment method | ✅ |
| F | Docs (this file, CHANGELOG, Swagger descriptions) | ✅ |

Backend suite at phase close: **897 tests** (541 unit + 356 e2e), all green.

## Overview

Phase 6.3 sold products by quantity. Phase 6.3.5 adds per-phone tracking for used phones, which the shop both buys and sells:

- **Customers** — the people we buy phones from and sell to.
- **ProductUnit** — one row per physical phone, identified by a globally unique IMEI, with a lifecycle status.
- **PhonePurchase** — the intake record when we buy a phone from a customer (cash out).
- **Serialized sale lines** — selling a phone resolves its IMEI to a specific ProductUnit and flips it to SOLD on complete.
- **Trade-ins** — a customer pays for (part of) a sale with a used phone. The phone is intaken as part of the same sale.

## Entity Relationships

```
Customer 1──* PhonePurchase 1──* ProductUnit *──1 Product
   │                 ▲                │
   │                 │                └──* SaleLine (product_unit_id; a unit can be
   │                 │                     sold, voided, and resold over its lifetime)
   1                 │
   *                 │
  Sale 1──* Payment ─┘ (trade_in_phone_purchase_id, TRADE_IN only)
                │
                └──1 Product (trade_in_product_id, TRADE_IN only)
```

All new FKs are `ON DELETE RESTRICT` — physical inventory and financial history are never orphaned by a parent delete.

## ProductUnit Lifecycle

```
           intake (PhonePurchase.create)
           trade-in (completeSale)
                     │
                     ▼
   ┌──────────── IN_STOCK ◄──────────── void of the sale that sold it
   │                 │                          ▲
   │                 │ completeSale              │
   │                 ▼                           │
   │               SOLD ─────────────────────────┘
   │
   │ void of the sale that traded it in
   ▼
RETURNED      (WRITTEN_OFF: reserved, no path yet)
```

- `IN_STOCK → SOLD` — `ProductUnitsService.markSoldForSale` (completeSale, Slice E)
- `SOLD → IN_STOCK` — `markAvailableForReversal` (voidSale, Slice E). 409 if the phone was bought back after that sale (see Buy-back below).
- `IN_STOCK → RETURNED` — `markReturnedForVoid` (voidSale trade-in reversal, Slice G). The only path that produces RETURNED: the trade-in was reversed and **the phone is back with the customer**.

There is no `deleted_at` on ProductUnit — status is the tombstone.

### One row per acquisition (buy-back)

A ProductUnit row is **one acquisition** of a physical phone, not the phone itself. When the shop takes back a phone it no longer holds — a customer trading in a phone we sold them, or a voided trade-in being re-rung — the intake creates a **new** row on the intake's SKU, cost and PhonePurchase. Earlier rows are never rewritten, so each sale line keeps pointing at the exact row it sold, and `SELECT … FROM product_units WHERE imei = $1 ORDER BY created_at` is the phone's full history.

```
IMEI X:  U1  new SKU   cost 85000  SOLD      ← sale A line
         U2  used SKU  cost 60000  SOLD      ← trade-in on B (PhonePurchase P_B), sale C line
         U3  used SKU  cost 55000  IN_STOCK  ← trade-in on D (PhonePurchase P_D)
```

- **Uniqueness is scoped to live units.** `uq_product_units_imei_live` is `UNIQUE (imei) WHERE status IN ('IN_STOCK', 'WRITTEN_OFF')`: at most one row per IMEI that the shop holds. SOLD and RETURNED rows may repeat. `idx_product_units_imei` (plain) serves lookups across all statuses.
- **Intake collisions** (`POST /phone-purchases`, `TRADE_IN` at addPayment and at complete) only consider live units: IN_STOCK, or WRITTEN_OFF (a written-off phone turning up again needs a manager). A concurrent intake that slips past the pre-check hits the index and is mapped to the same 409.
- **Selling an IMEI** (`addLine`) resolves the live row; if there is none, the newest row is used for the 409 message (e.g. `status: SOLD`).
- **Voids unwind newest-first.** Voiding a sale whose phone was later taken back (a newer row that isn't RETURNED: IN_STOCK, or SOLD on again) returns 409 "the phone was taken back into stock on a later sale or purchase". Void the later sales first. This mirrors the existing rule that blocks voiding a trade-in whose phone was resold.
- **A future customer-return flow** (phone physically back with the shop, awaiting re-stock) must use a **new status** (e.g. `RETURN_PENDING`) and add it to `uq_product_units_imei_live`. It must not reuse RETURNED.

## Design Decisions

### Customers (Slices A–B)

- **Phone required, NIC optional.** Walk-in customers often have no NIC on hand. NIC has a partial unique index when non-null; a clash returns 409 with `existing_customer_id` so the frontend can offer the existing record. Taking a phone in from a customer (a phone purchase or a trade-in) does need the NIC: see Intake and Trade-ins.
- **SL phone normalization** at the DTO layer (`normalizeSlPhone`) — local, international, and cosmetic formats all store as `0XXXXXXXXX`.
- **Soft delete + reactivate.** Delete/reactivate are admin/manager only (supervisor action); all roles can create and edit (the register needs walk-in creation).
- **`sales.customer_id`** gets a real FK (`RESTRICT`) plus service validation: nonexistent and soft-deleted customers are rejected with 400. Clearing to `null` is always allowed.

### Intake (Slices C–D)

- **IMEI is unique among live units (IN_STOCK, WRITTEN_OFF).** A collision returns 409 with an `existing_unit` payload. A phone we sold, or whose trade-in was voided, can be bought back as a new unit row (see "One row per acquisition" above). _Before the buy-back change, IMEI was unique across all statuses._
- **Intake is atomic.** `POST /phone-purchases` creates the PhonePurchase, an IN_STOCK ProductUnit, and the stock increment in one transaction.
- **Product must be serialized, active, and at the intake branch.** Non-admin cashiers can only intake at their own branch.
- **The seller must have an NIC on file.** `POST /phone-purchases` for a customer without one returns 400 "A phone purchase needs the customer's NIC", before anything is written. If the phone turns out to be stolen, the shop can trace who sold it (Phase 6.4 P4-13).
- **`selling_price` is optional at intake** ("price later"). When null, a sale falls back to `Product.selling_price`. When sent it must be ≥ 0.01: a stored 0 is not null, so the phone would ring up for free.
- **`total_amount` is stored**, not derived, matching the `Sale.total` precedent and leaving room for multi-unit purchases.

### Serialized sale lines (Slice E)

`addLine` branches on `(product.is_serialized, external_supplier_id)`:

| Mode | IMEI | Quantity | Price source |
|------|------|:--------:|--------------|
| Non-serialized | must be null | any | Product |
| Serialized in-house | required, resolved to an IN_STOCK ProductUnit | 1 | PU.selling_price → Product.selling_price; cost from PU.buying_price |
| Serialized external | required, free text; must not match an IN_STOCK unit | 1 | Product |

- **Mode changes are forbidden on update.** Remove and re-add the line instead.
- **Multiple DRAFTs may hold the same IMEI.** The first to complete wins; later completes get 409 from `markSoldForSale` and roll back entirely.
- **Lock order inside the per-line loop is Stock, then ProductUnit.**

### Trade-ins (Slice G)

A trade-in is a payment, not a line: `payment_method = TRADE_IN`, with the phone's intake data carried on the Payment row.

**DRAFT — nothing is materialized.** `addPayment` validates and stores the trade-in fields only:

- Required: `trade_in_product_id` (active, serialized, at the sale's branch), `trade_in_imei`, `trade_in_buying_price`. Optional: `trade_in_selling_price` (≥ 0.01 when sent: a stored 0 would resell the phone for free), `trade_in_notes`.
- `amount` must equal `trade_in_buying_price` to the cent.
- The sale must have a customer (the PhonePurchase needs one), and that customer must have an NIC on file: 400 "A trade-in needs the customer's NIC" otherwise (Phase 6.4 P4-13, same reason as phone purchases).
- `cash_received` and `reference_number` must be omitted; `trade_in_*` fields are rejected on every other method.
- IMEI collision with a live unit (IN_STOCK, WRITTEN_OFF) → 409 `existing_unit` (best effort; re-checked at complete). A SOLD or RETURNED unit doesn't block: that's a buy-back, and complete creates a new unit row.
- `GET /sales/:id` (and every hydrated sale response) includes `trade_in_product` (the product row) on each TRADE_IN payment, so clients can show the product name.

**Frozen once recorded.** `updatePayment` allows only `notes` on a TRADE_IN payment. `amount`, `cash_received`, and `reference_number` are rejected with 400, and `trade_in_*` fields are never patchable on any payment. Renegotiating a trade-in value means removing the payment and adding a new one.

**`completeSale` materializes.** After the outgoing-lines loop and before the sale number is issued, each TRADE_IN payment (oldest first) goes through `PhonePurchasesService.createForTradeIn`, enlisted in the sale's transaction. That creates the PhonePurchase, an IN_STOCK ProductUnit, and the stock increment, re-validating the product and IMEI. The new PhonePurchase id is then stamped onto `payments.trade_in_phone_purchase_id`. An IMEI that was intaken elsewhere since `addPayment` → 409 and the entire sale rolls back, including the outgoing decrements. The customer's NIC is checked again before the first trade-in is materialized (the NIC can be cleared on the customer after `addPayment`): none → 400 "A trade-in needs the customer's NIC", and the sale rolls back the same way.

**`voidSale` reverses.** After the outgoing-reversal loop and before payments are stamped reversed, each TRADE_IN payment's unit (found via `phone_purchase_id`) goes `IN_STOCK → RETURNED` and its stock is decremented with `StockService.decrementForVoidedTradeIn`. The PhonePurchase row stays as history.

**Void is blocked if the phone was resold.** If the traded-in unit is SOLD on a later sale, voiding the original sale would "return" a phone that now belongs to someone else. `markReturnedForVoid` throws 409 and the whole void rolls back. The operator voids the later sale first.

**Defense in depth.** DB CHKs back up every service rule:

- `CHK_payments_trade_in_fields_consistent` — the required trio is present iff `TRADE_IN`
- `CHK_payments_trade_in_fields_null_when_not_trade_in`
- `CHK_payments_trade_in_amount_matches` — `amount = trade_in_buying_price`
- `CHK_payments_trade_in_pp_reference` — PP reference only on TRADE_IN rows
- Partial unique index — one PhonePurchase backs at most one trade-in payment

## Endpoint Reference

All endpoints are prefixed with `/api/v1` and require the `access_token` cookie.

### Customers

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/customers` | any | List (paginated; search across name/phone/NIC; `include_deleted`) |
| GET | `/customers/:id` | any | Get one (includes soft-deleted, for restore flows) |
| POST | `/customers` | any | Create (409 + `existing_customer_id` on NIC clash) |
| PATCH | `/customers/:id` | any | Partial update |
| DELETE | `/customers/:id` | admin, manager | Soft delete |
| POST | `/customers/:id/reactivate` | admin, manager | Restore |

### Phone purchases

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/phone-purchases` | any | List (filters: `customer_id`, `branchId`) |
| GET | `/phone-purchases/:id` | any | Get one with customer, branch, cashier, units |
| POST | `/phone-purchases` | any | Atomic intake: PhonePurchase + IN_STOCK unit + stock increment (the customer needs an NIC) |

### Product units

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/product-units` | admin, manager | List (filters: `productId`, `branchId`, `status`, exact `imei`) |
| GET | `/product-units/:id` | admin, manager | Get one with product, branch, phone_purchase |

### Sales endpoints changed in this phase

| Endpoint | Change |
|----------|--------|
| `POST /sales`, `PATCH /sales/:id` | `customer_id` validated (Slice B) |
| `POST /sales/:saleId/lines` | Serialized modes; 409 `existing_unit` on unavailable IMEI (Slice E) |
| `PATCH /sales/:saleId/lines/:lineId` | Mode-aware frozen fields (Slice E) |
| `POST /sales/:saleId/payments` | `TRADE_IN` method + `trade_in_*` fields; 409 on IMEI collision (Slice G) |
| `PATCH /sales/:saleId/payments/:paymentId` | TRADE_IN frozen except `notes` (Slice G) |
| `POST /sales/:id/complete` | Flips PUs to SOLD; materializes trade-ins; 409 on IMEI conflicts (Slices E, G) |
| `POST /sales/:id/void` | Flips PUs back to IN_STOCK; reverses trade-ins; 409 if a trade-in was resold (Slices E, G), or if a sold phone was bought back later (buy-back) |
| `POST /phone-purchases`, `TRADE_IN` | IMEI only collides with live units; SOLD / RETURNED IMEIs are bought back as new rows (buy-back) |

Swagger (`/api/docs`, dev only) is generated from the decorators and reflects all of the above.

## Migration Notes

Seven migrations, in dependency order, plus one added later for buy-back:

| Order | Migration | Slice | Notes |
|-------|-----------|:-----:|-------|
| 1 | `CreateCustomersTable` | A | Phone index (non-unique); partial unique index on NIC |
| 2 | `AddCustomerFkToSales` | B | `RESTRICT` / `ON UPDATE CASCADE`; preflight confirmed no existing non-null values |
| 3 | `CreateProductUnits` | C | Unique IMEI; composite `(product_id, branch_id, status)` index; bare `phone_purchase_id` |
| 4 | `CreatePhonePurchases` | D | FKs to customers, branches, users (all `RESTRICT`) |
| 5 | `AddProductUnitsPhonePurchaseFk` | D | Separate from 4 for revert granularity |
| 6 | `AddSaleLinesProductUnitId` | E | `CHK_sale_lines_product_unit_snapshot` (unit implies IMEI snapshot) |
| 7 | `add-trade-in-columns-to-payments` | G | Six `trade_in_*` columns, two FKs, four CHKs, partial unique index; `TRADE_IN` added to `CHK_payments_method` |
| 8 | `ProductUnitsImeiUniqueWhenLive` | buy-back | Replaces the global unique `idx_product_units_imei` with `uq_product_units_imei_live` (`WHERE status IN ('IN_STOCK', 'WRITTEN_OFF')`) plus a plain `idx_product_units_imei`. **`down` fails once any IMEI has more than one row** (a buy-back happened); those rows are history and must not be deleted to force a revert |

Project rule: every migration is verified with `migration:run` and `\d <table>` on both `socio_lk_pos_dev` and `socio_lk_pos_test` before commit (recorded explicitly in the Slice A and Slice G commits).

## Test Coverage

Phase 6.3.5 adds **314 tests** (196 unit + 118 e2e) on top of the 583 from Phase 6.3, bringing the backend suite to **897 total** (541 unit + 356 e2e).

| Slice | Unit | E2e |
|-------|:----:|:---:|
| A — Customers | 44 | 33 |
| B — Sale ↔ Customer | 6 | 5 |
| C+D — ProductUnit + PhonePurchase | 42 | 32 |
| E — Serialized sale lines | 53 | 25 |
| G — Trade-ins | 51 | 23 |
| **Phase 6.3.5 total** | **196** | **118** |

Crown-jewel atomicity tests compare the database state before and after a failed transaction:

- **Intake rollback** (D) — a failed second insert leaves no PhonePurchase, unit, or stock change.
- **Cross-DRAFT serialized race** (E) — the second complete on the same IMEI gets 409; its stock decrement rolls back.
- **Trade-in IMEI race** (G) — two DRAFTs trade in the same IMEI; the loser gets 409 and every row it could have touched is unchanged, compared as full-row snapshots.
- **Void blocked by resale** (G) — voiding a sale whose trade-in was resold gets 409; both sales, the SOLD unit, stock, and payment reversal stamps are unchanged.

## Known Followups

Tracked in [FOLLOWUPS.md](../../FOLLOWUPS.md). The ones this phase touched most:

- **Stock/PU lock-ordering deadlock — priority high.** Slice G added a PU-then-Stock lock order in the voidSale trade-in loop, opposite to the outgoing loops. Postgres detects the deadlock (one side gets a 500), so nothing corrupts. The fix is global lock-target sorting across `SalesService`.
- **Resale 409 payload** could include the reselling sale's id.
- ~~**Buy-back**~~ — done: one unit row per acquisition (see ProductUnit Lifecycle). **Customer-return re-stock** is still open, and needs its own status (not RETURNED).
- **Admin endpoint to set `ProductUnit.selling_price`** after a "price later" intake.
