# Products Backend

This document covers the Products Backend — the six entities that form the catalog and inventory layer of SOCIO.LK POS. It includes entity design, cross-entity flows, endpoint reference, and the "why" behind the major decisions. Authentication is documented in [auth.md](./auth.md); role enforcement patterns in [rbac.md](./rbac.md); table conventions in [database.md](./database.md).

## Overview

The Products Backend was built as Phase 6.1 and delivers the catalog, inventory, and location primitives that every subsequent phase (POS terminal, sales, receipts, reporting) depends on. It ships as six entities across five HTTP-facing modules plus one internal service:

| Module | Entity | HTTP surface | Role |
|--------|--------|--------------|------|
| Branches | `Branch` | 6 endpoints | Physical shop locations |
| Brands | `Brand` | 6 endpoints | Manufacturer brands |
| Categories | `Category` | 7 endpoints | Two-level product taxonomy |
| Products | `Product` | 7 endpoints | The catalog itself |
| Stock | `Stock` | 5 endpoints | Per-product, per-branch quantities |
| _(internal)_ | `SkuBarcodeCounter` | none | Atomic sequence generator |

Thirty-one endpoints in total. All authenticated roles can read; only admin can mutate.

## Entity Relationships

```
Branch ─┬─< Product
        └─< Stock

Brand ────< Product

Category ──< Category (self-ref, one level deep)
     │
     └────< Product

Product ──< Stock

SkuBarcodeCounter (singleton rows: SKU, BARCODE)
```

- Every `Product` belongs to exactly one `Branch`, one `Brand`, and one `Category`.
- Every `Product` has exactly one `Stock` row per branch (auto-created on product create for its home branch; additional rows can be created when the product is stocked at other branches).
- `Category` self-references via a nullable `parent_id`; the hierarchy is capped at two levels (root → child) — enforced in the service layer, not the schema.
- `SkuBarcodeCounter` holds two rows keyed by `code_type` (`SKU`, `BARCODE`) and is row-locked to hand out sequential numbers.

## Design Decisions

### Deactivate, don't delete

Every entity supports `is_active = false` and every `DELETE` endpoint is a soft deactivation, not a hard row removal. `Brand`, `Category`, and `Product` additionally carry `deleted_at` for TypeORM soft-delete; `Branch` and `Stock` do not.

#### Why deactivate

Hard-deleting a product referenced by a past sale would orphan history and break receipts, refunds, and reporting. Deactivation preserves referential integrity while removing the entity from active dropdowns and search. The frontend hides inactive rows by default and can opt in via `?is_active=false`.

#### Why no `deleted_at` on Branch or Stock

Deleting a branch record would orphan every product and stock row that references it — the shop's own operational history. Stock is the same story: deleting a stock row would silently erase the audit trail of a product ever being carried at a branch. For both, `is_active` toggles are sufficient and safer.

### Multi-branch schema, single-branch UX in R1

Every branchable entity carries `branch_id` from day one, even though R1 operates with a single seeded "Main Shop" branch. When the second branch opens (planned R9), there is no data migration — just new rows.

The frontend in R1 hides the branch selector for non-admins and defaults everything to Main Shop. Admin-side scoping (managers/cashiers seeing only their own branch) is deferred until the User → Branch link commit at the start of Phase 6.2.

### Nested responses on read

`GET /products` returns `{ brand, category, branch }` inline on each row. `GET /stock` returns `{ product, branch }` inline. This is deliberate.

#### Why nest instead of returning FK ids

The alternative — returning `{ brand_id, category_id, branch_id }` and expecting the frontend to fetch names in a second request — creates an N+1 problem the moment a list has more than a handful of rows. The product list on the POS terminal and the admin dashboard are both hot paths that render on every mount; a single joined response keeps them fast and simple.

The trade-off is response size, which is acceptable at our catalog scale (thousands, not millions, of products).

### Case-insensitive uniqueness via functional partial indexes

Brand names and category names are unique case-insensitively, ignoring soft-deleted rows.

- **Brand:** unique on `LOWER(name)` where `deleted_at IS NULL`
- **Category:** unique on `(LOWER(name), COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid))` where `deleted_at IS NULL`

#### Why functional indexes instead of a service-layer check

A service-layer "is there already a brand called this?" check races under concurrent create — two requests arriving in the same millisecond both see nothing and both insert. Only the database can guarantee uniqueness atomically. Postgres functional indexes let us do that on a normalized (lowercased) value without corrupting the original casing that admins typed in.

#### Why the `COALESCE` on `parent_id`

Categories are unique per parent — you can have "Cases" under "Phones" and "Cases" under "Accessories", but not two "Cases" under "Phones". Top-level categories (no parent) must also be unique among themselves. Postgres treats `NULL` values in unique indexes as always distinct, so a naive index on `(LOWER(name), parent_id)` would allow duplicate top-level "Phones" rows. Coalescing `NULL` to a sentinel UUID collapses those into a single comparable value.

### Two-level category hierarchy enforced app-side

The schema allows arbitrary depth via self-reference, but the service layer rejects any attempt to:

- Create a category whose `parent_id` points at a category that itself has a parent (would be depth 3).
- Move an existing category under such a parent.
- Demote a parent that already has children (would push the children to depth 3).

#### Why cap at two levels

Deep hierarchies look flexible but consistently produce navigation and reporting pain — "should this rollup include grandchildren?", "what depth does the sidebar render?", "how do we compute effective attributes?". Two levels covers every real taxonomy a mobile shop needs (Phones → Cases, Accessories → Chargers) and keeps every UI and query simple.

#### Why enforce in code, not with a `CHECK` constraint

A depth check in Postgres would need either a `CHECK` that reads other rows (not allowed in Postgres) or a trigger — both hard to test and harder to modify. A service guard is clearer, unit-testable, and produces a clean 400 response ("cannot nest categories more than two levels deep") instead of an opaque database error.

### Cross-entity validation at the service layer

Every service that references another entity (Product → Brand/Category/Branch, Stock → Product/Branch) validates the reference before insert or update: does it exist, and is it active?

#### Why validate ahead of the FK

Letting Postgres reject the insert works, but the client gets a raw constraint-violation string — useless for a form. Explicit checks let us return `400 Bad Request` with a specific message ("Brand X is not active") that the frontend can render next to the offending field.

### Row-locked SKU/barcode counter

The `SkuBarcodeCounter` table holds two singleton rows (`SKU`, `BARCODE`). Handing out a new number is:

1. Open a transaction.
2. `SELECT ... FOR UPDATE` on the relevant row.
3. Increment and return.
4. Commit.

The `FOR UPDATE` clause takes a row-level lock; a second concurrent request blocks until the first commits, then sees the incremented value.

#### Why not a Postgres sequence

Sequences are the standard answer for auto-incrementing integers, but they have two properties that don't fit here: they gap on rollback (so a failed insert would leave holes in the SKU space) and they can't easily encode the `SKU-000001` prefix + zero-padding format. A counter table with row locks gives us a gap-free, formatted, testable generator with predictable behaviour.

### SKU generated always; barcode generated or accepted

On product create:

- **SKU is always auto-generated** (`SKU-000001`, `SKU-000002`, …). The client cannot supply one.
- **Barcode is auto-generated if omitted** (`SLP-000001`, `SLP-000002`, …) **or accepted if provided.** This supports scanning manufacturer barcodes at receive time.

On product update:

- **Admin can override SKU** — for correcting bad initial entries.
- Barcode can also be updated.

#### Why the asymmetry on create

SKUs are internal identifiers; they exist to be unique across our catalog and nothing else, so we generate them. Barcodes have external meaning — a manufacturer's EAN-13 or UPC printed on the box is far more useful than an in-house number, and losing the ability to scan it in would waste time at receive. Where the manufacturer has already assigned one, we use it; where they haven't (bulk unbranded accessories), we generate our own with the `SLP-` prefix.

### Prices as `numeric(10,2)` in DB, strings in code

Postgres stores prices as `numeric(10,2)`. TypeScript treats them as `string` throughout — DTOs, service arguments, response bodies.

#### Why not JavaScript numbers

`0.1 + 0.2 !== 0.3` in every IEEE-754 language. Applying floating-point math to money is a bug factory — rounding errors accumulate across sale lines, tax calculations, and change due. Strings force every arithmetic operation to go through a decimal-safe helper (or Postgres itself). Slightly more ceremony; zero rounding bugs.

### Warranty split into two fields

Products carry both:

- `warranty_months` (integer, default 0) — full manufacturer warranty duration.
- `checking_warranty_days` (integer, default 0) — short "defect check" window, mostly used for used phones sold with a 7-day return guarantee.

#### Why not one field

They mean different things and print differently on receipts. Merging them would force conditional logic on every read to decide which to display.

### `phone_condition` enum on all products

`Product` has a nullable `phone_condition` column with values `NEW` and `USED`. It is only populated when `product_type = 'PHONE'`; otherwise it stays `NULL`.

#### Why on the base product table rather than a phone-specific subtable

The alternative (a `PhoneDetails` join table) adds a query on every product read for a field that's a single enum. Nullable columns are the pragmatic choice at this scale. If phone-specific data grows past 3–4 fields, revisit.

### `is_serialized` = IMEI at sale, no per-unit tracking in R1

Phones and other high-value goods flip `is_serialized = true`. This tells the POS terminal to prompt the cashier for an IMEI at checkout, which is captured on the sale line — not on the product.

#### Why defer per-unit tracking

True per-unit inventory (a `ProductUnit` entity with individual IMEI, cost, purchase date) is the right long-term answer, especially for used phones where per-unit cost varies. It's also a substantial modelling exercise that would delay R1. Capturing the IMEI on the sale line preserves the audit trail we need — we know which IMEI left the shop and when — and defers the modelling to R2 without losing information.

### `low_stock_alert` computed on read

`Stock` has `quantity` (current) and `low_stock_threshold` (per-row admin-configurable). The `low_stock_alert` boolean is computed at read time (`quantity <= low_stock_threshold`) and included in the response. Not stored.

#### Why not store it

Stored derived fields go stale the moment the underlying value changes. Every quantity adjustment, every sale, every stock creation would have to remember to update the flag — and any code path that forgot would produce a wrong dashboard. Cheaper and safer to compute on read.

## Cross-Entity Flows

### Product create → Stock auto-create

Creating a product atomically creates a matching `Stock` row at quantity 0 for the product's home branch.

1. `ProductsService.create()` validates brand, category, and branch are all active.
2. Requests a fresh SKU (and possibly barcode) from `SkuBarcodeCounter`.
3. Inserts the product row.
4. Delegates to `StockService.autoCreateForProduct()` to insert `{ product_id, branch_id, quantity: 0, low_stock_threshold: 0 }`.

Both modules import each other (products needs stock for auto-creation; stock needs products for validation), which requires `forwardRef` on both sides of the module imports.

#### Why atomically create Stock at 0

Without the auto-created row, `GET /stock/by-product/:id` would return empty until someone manually created a row — a broken-looking state for a product that legitimately exists but hasn't been received yet. Starting at 0 gives the frontend a single, consistent model: a product always has stock, that stock is sometimes zero.

### SKU / barcode generation on product create

Inside a single transaction:

1. `SELECT ... FOR UPDATE` on `sku_barcode_counter` where `code_type = 'SKU'`.
2. Read `next_value`, format as `SKU-000042`, increment `next_value`, write back.
3. If barcode was not supplied by the client: repeat steps 1–2 for `code_type = 'BARCODE'`, format as `SLP-000042`.
4. If barcode was supplied: validate uniqueness (via unique index) and use as-is.
5. Insert the product.
6. Commit.

Concurrent create requests block on the row lock, ensuring no collisions.

### Category deactivation does not cascade

Deactivating a parent category leaves its children active. Deactivating any category leaves associated products active. Independent lifecycles.

#### Why not cascade

An admin cleaning up an obsolete parent shouldn't accidentally wipe children that are still in use, and the reverse is also true — deactivating a category shouldn't take products with it (products can be recategorized). Cascades make bulk operations fast but bulk mistakes catastrophic.

## Endpoint Reference

All endpoints are prefixed with `/api/v1` and require authentication via the `access_token` cookie unless noted. Write endpoints (create/update/deactivate/reactivate) require the `admin` role; all reads are open to any authenticated user.

### Branches

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/branches` | any | List branches (paginated, filterable by `is_active`) |
| GET | `/branches/:id` | any | Get one branch by UUID |
| POST | `/branches` | admin | Create branch |
| PATCH | `/branches/:id` | admin | Update branch fields |
| DELETE | `/branches/:id` | admin | Deactivate (soft — rejected if this would leave zero active branches) |
| POST | `/branches/:id/reactivate` | admin | Reactivate a deactivated branch |

### Brands

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/brands` | any | List brands (paginated, filterable) |
| GET | `/brands/:id` | any | Get one brand by UUID |
| POST | `/brands` | admin | Create brand (case-insensitive unique name enforced by DB) |
| PATCH | `/brands/:id` | admin | Update brand fields |
| DELETE | `/brands/:id` | admin | Deactivate (soft) |
| POST | `/brands/:id/reactivate` | admin | Reactivate |

### Categories

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/categories` | any | List categories (flat, paginated, filterable) |
| GET | `/categories/top-level` | any | List only categories with no parent (for sidebar / navigation trees) |
| GET | `/categories/:id` | any | Get one category by UUID |
| POST | `/categories` | admin | Create category (depth check + case-insensitive per-parent uniqueness) |
| PATCH | `/categories/:id` | admin | Update (depth checks re-run on `parent_id` change) |
| DELETE | `/categories/:id` | admin | Deactivate (soft — does not cascade) |
| POST | `/categories/:id/reactivate` | admin | Reactivate |

### Products

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/products` | any | List products (paginated, filterable by branch/brand/category/type/condition/is_active/search) |
| GET | `/products/by-barcode/:barcode` | any | Barcode lookup — for cashier scan-to-cart |
| GET | `/products/:id` | any | Get one product with nested `{ brand, category, branch }` |
| POST | `/products` | admin | Create (auto-generates SKU and, if omitted, barcode; auto-creates stock row) |
| PATCH | `/products/:id` | admin | Update — SKU override allowed here |
| DELETE | `/products/:id` | admin | Deactivate (soft) |
| POST | `/products/:id/reactivate` | admin | Reactivate |

### Stock

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/stock` | any | List stock rows (paginated, filterable by branch, low-stock only, etc.) with nested `{ product, branch }` |
| GET | `/stock/by-product/:productId` | any | All stock rows for a given product across branches |
| GET | `/stock/:id` | any | Get one stock row |
| POST | `/stock` | admin | Create a stock row (used when a product is added to a branch that didn't have it — e.g., after a new branch opens) |
| PATCH | `/stock/:id` | admin | Adjust quantity / threshold |

No `DELETE` on stock — quantity 0 is the correct way to represent "not carrying this here anymore" while preserving history.

## RBAC Matrix

| Operation | Admin | Manager | Cashier |
|-----------|:-----:|:-------:|:-------:|
| Read (any product/brand/category/branch/stock) | ✅ | ✅ | ✅ |
| Barcode lookup for POS | ✅ | ✅ | ✅ |
| Create/update/deactivate products | ✅ | ❌ | ❌ |
| Create/update/deactivate brands | ✅ | ❌ | ❌ |
| Create/update/deactivate categories | ✅ | ❌ | ❌ |
| Create/update/deactivate branches | ✅ | ❌ | ❌ |
| Create/adjust stock | ✅ | ❌ | ❌ |

Two follow-ups are already tracked:

- Manager/cashier reads will be **scoped to their own branch** once the User → Branch link commit lands at the start of Phase 6.2.
- Stock adjustments may be **delegated to managers** in a later phase; for R1, keeping mutation admin-only is the safer default.

## Migration Notes

Six migrations, one per entity, in dependency order:

| Order | Migration | Notes |
|-------|-----------|-------|
| 1 | `CreateBranchesTable` | Includes seed row for "Main Shop" |
| 2 | `CreateBrandsTable` | Adds functional unique index `LOWER(name) WHERE deleted_at IS NULL` |
| 3 | `CreateCategoriesTable` | Adds functional unique index with `COALESCE(parent_id, sentinel_uuid)` |
| 4 | `CreateSkuBarcodeCounterTable` | Seeds two rows: `SKU` and `BARCODE`, both at `next_value = 1` |
| 5 | `CreateProductsTable` | FKs to branches, brands, categories; includes `phone_condition` enum type |
| 6 | `CreateStockTable` | FKs to products and branches; unique on `(product_id, branch_id)` where active |

All six run cleanly on an empty DB and revert cleanly in reverse order. Verified end-to-end during Phase 6.1.

## Test Coverage

Phase 6.1 adds **200 tests** on top of the existing 47 from Phase 5, bringing the backend suite to **247 tests total** (144 unit + 103 e2e), all green.

Phase 6.1 additions, per module:

| Module | Unit tests | e2e tests |
|--------|:----------:|:---------:|
| Branches | 18 | 19 |
| Brands | 17 | 21 |
| Categories | 23 | 18 |
| SkuBarcodeCounter | 13 | — (internal, no HTTP surface) |
| Products | 27 | 16 |
| Stock | 18 | 10 |
| **Phase 6.1 subtotal** | **116** | **84** |

Key testing decisions from Phase 6.1 (see [testing.md](./testing.md) for the general infrastructure):

- **Dynamic table truncation** — the `test/setup.ts` helper now enumerates every TypeORM entity from metadata rather than a hardcoded list. New entities are truncated automatically.
- **50ms sleep before truncate** — the audit interceptor writes fire-and-forget; a short sleep lets those writes flush before `TRUNCATE ... CASCADE` runs, preventing intermittent Postgres lock errors during teardown.
- **Counter re-seed in cross-module e2e** — any test that runs `TRUNCATE` and then creates a product must re-seed the two `SkuBarcodeCounter` rows first, since the truncate takes them out.

## Future Work

- **User → Branch link (imminent, Phase 6.2 opening commit)** — add `branch_id` FK to `User`, backfill existing users to Main Shop, include branch in `@CurrentUser()`, open scoped `/branches/:id` reads to managers and cashiers.
- **Per-unit inventory (R2)** — introduce a `ProductUnit` entity for products where `is_serialized = true`, carrying individual IMEI, cost, purchase date, condition per unit. Especially important for used phones where per-unit cost varies.
- **Concurrent-sale hardening** — R1 assumes single-cashier operation. When multiple terminals go live: row-level locking on stock deduction, tuned transaction isolation, collision-safe invoice numbering.
- **Bulk barcode labels** — R1 will print one label at a time via `jsbarcode` + `window.print()`. Bulk label sheets (Avery-style templates) are deferred.
- **Env-driven throttle limits** — the global throttler is currently hardcoded at 10/sec and 100/min, which trips e2e suites and forces a 110ms sleep in the `loginAndGetCookies` helper. Reading from env would let `.env.test` set high limits and remove the sleeps.
- **Audit teardown noise** — fire-and-forget audit writes log errors when the DB connection closes during Jest's `afterAll`. Cosmetic; fixed either by awaiting the writes in test env or by adding a short sleep in `afterAll`.
