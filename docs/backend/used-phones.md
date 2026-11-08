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
   │                 │
   │                 │ customer return (POST /sales/:id/returns)
   │                 ▼
   │            INSPECTION ── inspection-pass ──► IN_STOCK
   │
   │ void of the sale that traded it in
   ▼
RETURNED      (WRITTEN_OFF: reserved, no path yet)
```

- `IN_STOCK → SOLD` — `ProductUnitsService.markSoldForSale` (completeSale, Slice E)
- `SOLD → IN_STOCK` — `markAvailableForReversal` (voidSale, Slice E). 409 if the phone was bought back after that sale (see Buy-back below).
- `IN_STOCK → RETURNED` — `markReturnedForVoid` (voidSale trade-in reversal, Slice G). The only path that produces RETURNED: the trade-in was reversed and **the phone is back with the customer**.
- `SOLD → INSPECTION` — `ProductUnitsService.markInspectionForReturn`, a customer returns the phone (`POST /sales/:id/returns`, Phase 6.4 P7-6; [returns.md](./returns.md)). **The shop holds it again but it isn't sellable** until it is checked. The same unit row is reused (a return isn't a new acquisition); the return line names it. No stock change. 409 `PHONE_TAKEN_BACK` if the phone was taken back after that sale (a later trade-in or phone purchase), with the same `reason` and `later_sale` as the void 409. `GET /sale-returns/inspection` lists the branch's INSPECTION phones with their latest return.
- `INSPECTION → IN_STOCK` — `ProductUnitsService.passInspection`, `POST /product-units/:id/inspection-pass` (step 0a; P7-7): checked, no fault. Stock +1, audited `INSPECTION_PASSED`. A faulty phone stays in INSPECTION until the supplier-receiving phase returns it to its supplier.

There is no `deleted_at` on ProductUnit — status is the tombstone.

### One row per acquisition (buy-back)

A ProductUnit row is **one acquisition** of a physical phone, not the phone itself. When the shop takes back a phone it no longer holds — a customer trading in a phone we sold them, or a voided trade-in being re-rung — the intake creates a **new** row on the intake's SKU, cost and PhonePurchase. Earlier rows are never rewritten, so each sale line keeps pointing at the exact row it sold, and `SELECT … FROM product_units WHERE imei = $1 ORDER BY created_at` is the phone's full history.

```
IMEI X:  U1  new SKU   cost 85000  SOLD      ← sale A line
         U2  used SKU  cost 60000  SOLD      ← trade-in on B (PhonePurchase P_B), sale C line
         U3  used SKU  cost 55000  IN_STOCK  ← trade-in on D (PhonePurchase P_D)
```

- **Uniqueness is scoped to live units.** `uq_product_units_imei_live` is `UNIQUE (imei) WHERE status IN ('IN_STOCK', 'WRITTEN_OFF', 'INSPECTION')`: at most one row per IMEI that the shop holds. SOLD and RETURNED rows may repeat. `idx_product_units_imei` (plain) serves lookups across all statuses. The live statuses are `LIVE_UNIT_STATUSES` in `product-units/live-imei.ts`, kept in step with the index (INSPECTION added by `AddProductUnitInspectionStatus`, Phase 6.4 P7-6).
- **Intake collisions** (`POST /phone-purchases`, `TRADE_IN` at addPayment and at complete) only consider live units: IN_STOCK, WRITTEN_OFF (a written-off phone turning up again needs a manager), or INSPECTION (a returned phone waiting for a check). The 409's `existing_unit.status` says which. A concurrent intake that slips past the pre-check hits the index and is mapped to the same 409.
- **Selling an IMEI** (`addLine`) resolves the live row; if there is none, the newest row is used for the 409 message (e.g. `status: SOLD`).
- **Voids unwind newest-first.** Voiding a sale whose phone was later taken back (a newer row that isn't RETURNED: IN_STOCK, or SOLD on again) returns 409 "the phone was taken back into stock on a later sale or purchase". Void the later sales first. This mirrors the existing rule that blocks voiding a trade-in whose phone was resold.
- **Customer returns use INSPECTION, never RETURNED.** A phone a customer brings back is held by the shop again, so its status is live (INSPECTION) and blocks the IMEI; RETURNED means the phone went back to the customer and stays out of the index, so a voided trade-in can be re-rung.

### Unit codes

Every ProductUnit row is to have a `unit_code`: `SLU` and at least eight digits, such as `SLU00000123`. It is a short, permanent identifier for a barcode, and it reveals no IMEI or serial number. Printing it on labels is a later stage; this section covers the code and scanning it.

**Status:** `AddProductUnitCodes` is in source, and has been applied and checked on the two local databases, `socio_lk_pos_dev` and `socio_lk_pos_test`: every row got a valid, unique code, and IMEI and serial values were unchanged. It hasn't been verified on any other database; apply it there before running this backend (see below). The e2e spec (`product-unit-codes.e2e-spec.ts`) has not been executed.

**Deployment order: apply the migration before deploying or running this backend.** There is no compatibility fallback for a database without `unit_code`. The backend still starts, then fails request by request: the till's lookup returns 500, which stops almost every POS scan, product barcodes included, along with unit reads, serialized sales, voids, returns and unit intake. The previous backend keeps working on a migrated database, because it leaves the column out and the default fills it.

- **Generated by the database.** The column's default is `next_product_unit_code()`, on the sequence `product_unit_code_seq`. Stock purchases, phone purchases and trade-ins all leave the column out of their INSERT, so no service generates a code, and `SkuBarcodeCountersService` plays no part. The number grows past eight digits (`SLU100000000`) and is never reused; a rolled-back insert leaves a gap.
- **One code per row, for good.** It is unique across every row, SOLD and RETURNED included, and never changes (`update: false` on the entity). A bought-back phone is a new row, so it gets a new code.
- **Existing rows.** When run, `AddProductUnitCodes` backfills every row, in `created_at, id` order, sold ones included.
- **Reading a code.** The till's lookup (`GET /product-units/sellable/by-identifier/:identifier`) and `addLine` (the IMEI prompt takes a scanned label) both read a code in any case, and:
  - find the exact row **at this branch**, whatever its status;
  - refuse a unit that isn't IN_STOCK with the usual 409, and don't go on to its IMEI, so a stale label is refused at the scan instead of finding a newer row of the same phone;
  - answer a code at another branch exactly like an unknown one, 404 at the lookup and 400 at `addLine`, both `No item matches that unit code at this branch.`, so a unit's existence elsewhere is not revealed;
  - go on to the normal IMEI and serial lookup when no unit has that code, so an older unit whose serial number looks like a code is still found.
- **The exact unit, from scan to sale line.** A resolved scan (a code, IMEI or serial number) returns `unitId`, and the till sends it to `addLine` as `product_unit_id` with the real identifier. `addLine` then reads that row at the sale's branch and doesn't resolve the identifier again. It refuses an id with no identifier, on an external line or on a quantity product (400), an identifier that isn't that unit's own (400), a unit of another product (400) and a unit that isn't IN_STOCK (409). An unknown id and one at another branch both get 400 `That item is not available at this branch.` So a unit sold after the scan is refused, even if the same phone is back in stock on a newer row. The line then pins that unit, and completion locks it and checks its status again. The IMEI prompt sends no id: a code entered there names one exact row, and a typed IMEI or serial number resolves as it always has.
- **Sales keep the real identifier.** A code is only ever resolved: `sale_lines.imei_snapshot` holds the unit's real IMEI or serial number, so receipts, sale details, returns and history show what they always did. The lookup's `identifier` is the real one too, and its response carries no code. A code is visible to cashiers only in phone purchase responses: see [api-documentation.md](./api-documentation.md#unit-codes-in-responses).
- **Never accepted as an identifier.** A value shaped exactly like a code is a 400 (`<value> is a unit code, not an IMEI or serial number.`) as an IMEI or serial number on a stock purchase, a phone purchase, a trade-in or an external sale line: it is a label scanned into the wrong field. Other values with letters and digits, such as `SLU1234567` (seven digits) or `SLU-00000123`, are unaffected. A real identifier of exactly that shape can't be recorded, the one cost of this check.

## Design Decisions

### Customers (Slices A–B)

- **Phone required, NIC optional.** Walk-in customers often have no NIC on hand. NIC has a partial unique index when non-null; a clash returns 409 with `existing_customer_id` so the frontend can offer the existing record. Taking a phone in from a customer (a phone purchase or a trade-in) does need the NIC: see Intake and Trade-ins.
- **SL phone normalization** at the DTO layer (`normalizeSlPhone`) — local, international, and cosmetic formats all store as `0XXXXXXXXX`.
- **Email optional, not unique.** `customers.email` (`varchar(254)`, nullable): a valid address, trimmed and stored lowercase; an empty string is stored as null, and `null` on PATCH clears it. Not unique, because family members may share one address. Included in the customer search; not printed on the receipt.
- **Name and phone can't be cleared.** `null` for either on PATCH is a 400 ("name must not be null").
- **Soft delete + reactivate.** Delete/reactivate are admin/manager only (supervisor action); all roles can create and edit (the register needs walk-in creation).
- **`sales.customer_id`** gets a real FK (`RESTRICT`) plus service validation: nonexistent and soft-deleted customers are rejected with 400. Clearing to `null` is always allowed.

### Intake (Slices C–D)

- **IMEI is unique among live units (IN_STOCK, WRITTEN_OFF, INSPECTION).** A collision returns 409 with an `existing_unit` payload. A phone we sold, or whose trade-in was voided, can be bought back as a new unit row (see "One row per acquisition" above). _Before the buy-back change, IMEI was unique across all statuses._
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
| Serialized external | required, free text; must not match a live unit (IN_STOCK, WRITTEN_OFF, INSPECTION; widened from IN_STOCK in Phase 6.4 P7 step 0a): 409 `IMEI '<imei>' is currently in your stock (status: <status>). If you meant to sell your own inventory, remove external_supplier_id.` with `existing_unit { id, product_id, branch_id }` | 1 | Product |

- **Mode changes are forbidden on update.** Remove and re-add the line instead.
- **A unit code is accepted in place of the IMEI** on an in-house line and stored as the real identifier; on an external line it is refused (see [Unit codes](#unit-codes)).
- **Multiple DRAFTs may hold the same IMEI.** The first to complete wins; later completes get 409 from `markSoldForSale` and roll back entirely.
- **One physical item per sale.** Within a single sale, `addLine` refuses a second line for an item already on it: the same `product_unit_id`, or the same IMEI or serial number in `imei_snapshot`. It checks after resolving what was scanned, so a unit's code, IMEI and serial number all count as one item. The answer is 409 `{ message: 'This item is already added to the current sale.', code: 'ITEM_ALREADY_IN_SALE', sale_line_id }`, naming the line that already holds it; that line is left unchanged. Matching is exact. Lines with neither a unit nor an identifier (quantity products, a serial-tracked item added without a serial number) aren't checked. This is not a reservation: separate drafts may still hold the same unit, as above.
- **An external line's IMEI can't be edited to one already on the sale.** `PATCH /sales/:saleId/lines/:lineId` gets the same 409 for an IMEI or serial number another line of the sale has; keeping the line's own value is allowed.
- **A line pinned to a unit stays at quantity 1**, whatever the product's `is_serialized` flag says. On a product not flagged serialized, a quantity change on such a line is 400 `quantity must be 1 on the line of a single item`; serialized products keep their own quantity check.
- **Lock order inside the per-line loop is Stock, then ProductUnit.**

### Trade-ins (Slice G)

A trade-in is a payment, not a line: `payment_method = TRADE_IN`, with the phone's intake data carried on the Payment row.

**DRAFT — nothing is materialized.** `addPayment` validates and stores the trade-in fields only:

- Required: `trade_in_product_id` (active, serialized, at the sale's branch), `trade_in_imei`, `trade_in_buying_price`. Optional: `trade_in_selling_price` (≥ 0.01 when sent: a stored 0 would resell the phone for free), `trade_in_notes`.
- `amount` must equal `trade_in_buying_price` to the cent.
- The sale must have a customer (the PhonePurchase needs one), and that customer must have an NIC on file: 400 "A trade-in needs the customer's NIC" otherwise (Phase 6.4 P4-13, same reason as phone purchases).
- `cash_received` and `reference_number` must be omitted; `trade_in_*` fields are rejected on every other method.
- IMEI collision with a live unit (IN_STOCK, WRITTEN_OFF, INSPECTION) → 409 `existing_unit` (best effort; re-checked at complete). A SOLD or RETURNED unit doesn't block: that's a buy-back, and complete creates a new unit row.
- `GET /sales/:id` (and every hydrated sale response) includes `trade_in_product` (the product row) on each TRADE_IN payment, so clients can show the product name.

**Frozen once recorded.** `updatePayment` allows only `notes` on a TRADE_IN payment. `amount`, `cash_received`, and `reference_number` are rejected with 400, and `trade_in_*` fields are never patchable on any payment. Renegotiating a trade-in value means removing the payment and adding a new one.

**`completeSale` materializes.** After the outgoing-lines loop and before the sale number is issued, each TRADE_IN payment (oldest first) goes through `PhonePurchasesService.createForTradeIn`, enlisted in the sale's transaction. That creates the PhonePurchase, an IN_STOCK ProductUnit, and the stock increment, re-validating the product and IMEI. The new PhonePurchase id is then stamped onto `payments.trade_in_phone_purchase_id`. An IMEI that was intaken elsewhere since `addPayment` → 409 `{ message: 'IMEI already exists in inventory', imei, payment_id, existing_unit }` (`existing_unit: null` when the live-IMEI index caught a concurrent intake), and the entire sale rolls back, including the outgoing decrements. `imei` and `payment_id` say which trade-in collided (Phase 6.4 P5). A trade-in product deactivated since `addPayment` → 400 `Product "<name>" is inactive`. The customer's NIC is checked again before the first trade-in is materialized (the NIC can be cleared on the customer after `addPayment`): none → 400 "A trade-in needs the customer's NIC", and the sale rolls back the same way.

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
| GET | `/customers` | any | List (paginated; search across name/phone/NIC/email; `include_deleted`) |
| GET | `/customers/:id` | any | Get one (includes soft-deleted, for restore flows) |
| POST | `/customers` | any | Create (409 + `existing_customer_id` on NIC clash) |
| PATCH | `/customers/:id` | any | Partial update |
| DELETE | `/customers/:id` | admin, manager | Soft delete |
| POST | `/customers/:id/reactivate` | admin, manager | Restore |

### Phone purchases

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/phone-purchases` | any | List (filters: `customer_id`, `branchId`). **Branch-scoped (Phase 2 P2-2):** admins see every branch, or the one in `branchId`; managers and cashiers see only their own branch (`branchId` left out or their own), and another `branchId` is 403 `{ code: 'WRONG_BRANCH' }` ([rbac.md](./rbac.md#branch-scoped-reads-phase-2)) |
| GET | `/phone-purchases/:id` | any | Get one with customer, branch, cashier, units. **Branch-scoped (P2-2):** for a manager or cashier, a purchase at another branch is 404 `Phone purchase not found`, the same answer as a missing id |
| POST | `/phone-purchases` | any | Atomic intake: PhonePurchase + IN_STOCK unit + stock increment (the customer needs an NIC) |

### Product units

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/product-units` | admin, manager | List (filters: `productId`, `branchId`, `status`, exact `imei`). **Branch-scoped (Phase 2 P2-3):** admins see every branch, or the one in `branchId`; managers see only their own branch (`branchId` left out or their own), and another `branchId` is 403 `{ code: 'WRONG_BRANCH' }` ([rbac.md](./rbac.md#branch-scoped-reads-phase-2)) |
| GET | `/product-units/:id` | admin, manager | Get one with product, branch, phone_purchase (and its customer), and the sale lines with their sales. **Branch-scoped (P2-3):** for a manager, a unit at another branch is 404 `Product unit not found`, the same answer as a missing id. A unit never changes branch, and its sales and phone purchase are at its branch, so they are scoped with it |
| GET | `/product-units/sellable/by-identifier/:identifier?branchId=` | any | The till's unit code, IMEI and serial lookup: the product and the exact unit when it's IN_STOCK at that branch (`identifierType` IMEI or SERIAL_NUMBER); 409 with `existing_unit` when it's there but not sellable; 404 when it isn't at that branch. `identifier` is always the unit's real IMEI or serial number, never a scanned code (see [Unit codes](#unit-codes)). `branchId` is required. **Branch-scoped (P2-3):** managers and cashiers may only give their own branch (another is 403 `WRONG_BRANCH`); admins any branch. Adding the unit to a sale checks its branch and status again |
| POST | `/product-units/:id/inspection-pass` | admin; manager at the unit's branch | INSPECTION → IN_STOCK and stock +1 (Phase 6.4 P7-7); returns the unit as `GET /product-units/:id`. Checked before the transaction: 404 unknown unit; 403 for a cashier, or `{ message, code: 'INSPECTION_WRONG_BRANCH' }` for a manager of another branch; 409 `{ message: 'This phone (IMEI <imei>) is not waiting for inspection (status: <status>).', code: 'NOT_IN_INSPECTION', status }`. Then one transaction in the global lock order (`lockInventoryRows`: the Stock row, then the unit; see sales.md "Lock order"), re-checking INSPECTION under the lock, and the `INSPECTION_PASSED` audit row (actor = session user, target = the unit, IMEI and product in the description) |

### Sales endpoints changed in this phase

| Endpoint | Change |
|----------|--------|
| `POST /sales`, `PATCH /sales/:id` | `customer_id` validated (Slice B) |
| `POST /sales/:saleId/lines` | Serialized modes; 409 `existing_unit` on unavailable IMEI (Slice E); 409 `ITEM_ALREADY_IN_SALE` for an item already on the sale (unit codes) |
| `PATCH /sales/:saleId/lines/:lineId` | Mode-aware frozen fields (Slice E) |
| `POST /sales/:saleId/payments` | `TRADE_IN` method + `trade_in_*` fields; 409 on IMEI collision (Slice G) |
| `PATCH /sales/:saleId/payments/:paymentId` | TRADE_IN frozen except `notes` (Slice G) |
| `POST /sales/:id/complete` | Flips PUs to SOLD; materializes trade-ins; 409 on IMEI conflicts (Slices E, G) |
| `POST /sales/:id/void` | Flips PUs back to IN_STOCK; reverses trade-ins; 409 if a trade-in was resold (Slices E, G), or if a sold phone was bought back later (buy-back); 409 `SALE_HAS_RETURNS` once the sale has a return (Phase 6.4 P7-11) |
| `POST /sales/:id/returns` | A returned phone goes SOLD → INSPECTION; 409 `PHONE_TAKEN_BACK` after a buy-back (Phase 6.4 P7) |
| `POST /phone-purchases`, `TRADE_IN` | IMEI only collides with live units; SOLD / RETURNED IMEIs are bought back as new rows (buy-back); INSPECTION is live (Phase 6.4 P7 step 0a) |

Swagger (`/api/docs`, dev only) is generated from the decorators and reflects all of the above.

## Migration Notes

Seven migrations, in dependency order, plus those added later:

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
| 9 | `AddProductUnitInspectionStatus` | Phase 6.4 P7 0a | Adds `INSPECTION` to `CHK_product_units_status` and to the `uq_product_units_imei_live` WHERE clause. **`down` refuses while any unit is INSPECTION** (returned phones waiting for a check) and changes nothing; pass or resolve them first. The entity now names all three `product_units` CHECKs as the migrations do |
| 10 | `AddProductUnitCodes` | unit codes | **Applied and checked on the local dev and test databases; unverified elsewhere.** `unit_code` (`text`, NOT NULL), the sequence `product_unit_code_seq` (owned by the column, so `TRUNCATE ... RESTART IDENTITY` resets it), `next_product_unit_code()` as its default, `CHK_product_units_unit_code`, and the full unique index `uq_product_units_unit_code`. Backfills every row in `created_at, id` order, then moves the sequence past them. **Apply it before deploying this backend, and it is forward-only once labels are printed:** see below |

**Apply `AddProductUnitCodes` before deploying or running the backend that expects it.** There is no compatibility fallback: see [Unit codes](#unit-codes).

**`AddProductUnitCodes` is forward-only once labels are printed.** `down` deletes every code, so each printed label stops scanning. Running `up` again renumbers from 1, and because the sequence has gaps, a row can get a different code than before: an old label could then identify a different unit. After the first label is printed, fix forward instead of reverting, and never delete, recreate or renumber unit rows.

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

- ~~**Stock/PU lock-ordering deadlock**~~ — fixed in Phase 6.4 P7 step 0c: one global lock order (sales.md "Lock order").
- **Resale 409 payload** could include the reselling sale's id.
- ~~**Buy-back**~~ — done: one unit row per acquisition (see ProductUnit Lifecycle). ~~**Customer-return re-stock**~~ — done in Phase 6.4 P7: the INSPECTION status and the inspection pass (step 0a), and the return itself (step 0b, [returns.md](./returns.md)). A faulty phone still waits in INSPECTION for the supplier-receiving phase.
- **Admin endpoint to set `ProductUnit.selling_price`** after a "price later" intake.
