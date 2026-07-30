# Database Design

This document covers database conventions, the soft-delete strategy, and the schema for each table. New tables should follow the patterns established here.

## Connection & Tooling

- **Database:** PostgreSQL (development DB: `socio_lk_pos_dev`)
- **ORM:** TypeORM
- **Schema evolution:** migrations only (`synchronize: false`)
- **Inspection tool:** DBeaver recommended for local development

See [configuration.md](./configuration.md) for connection setup and [migrations.md](./migrations.md) for the migration workflow.

## Naming Conventions

| Layer | Convention | Example |
|-------|-----------|---------|
| Table names | snake_case, plural | `users`, `sales_line_items` |
| Column names | snake_case | `password_hash`, `created_at` |
| TypeScript properties | snake_case (matches DB) | `user.password_hash` |
| Primary key | `id`, UUID | `id uuid PRIMARY KEY` |
| Foreign keys | `<referenced_table_singular>_id` | `user_id`, `product_id` |
| Indexes | `idx_<table>_<column>` | `idx_users_email` |
| Unique indexes | same as indexes, with `unique` flag | `idx_users_email` (UNIQUE) |
| Primary key constraints | `PK_<table>_id` | `PK_users_id` |
| Check constraints | `CHK_<table>_<column>` | `CHK_users_role` |
| Foreign key constraints | `FK_<table>_<column>` | `FK_sales_user_id` |

### Why snake_case in TypeScript too

Some teams use camelCase in TS with TypeORM's `name` option to map to snake_case columns. We use snake_case at both layers because it eliminates a translation step and makes it impossible for code and DB to drift in casing.

## Universal Columns

Every entity in the system includes these columns:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | `uuid` | Primary key, generated via `uuid_generate_v4()` |
| `created_at` | `timestamptz` | Auto-set on insert (`@CreateDateColumn`) |
| `updated_at` | `timestamptz` | Auto-updated on save (`@UpdateDateColumn`) |
| `deleted_at` | `timestamptz` (nullable) | Soft-delete marker (`@DeleteDateColumn`) |

### Why UUIDs (not auto-increment integers)

- UUIDs don't leak business information (a competitor seeing `/users/47` knows roughly how many users exist; `/users/a3f...` reveals nothing).
- Safe to generate without coordination across distributed systems.
- Modern API convention.

### Why `timestamptz` (not `timestamp`)

A POS in Colombo, servers in another AWS region, an admin reviewing logs from anywhere — timezone-aware timestamps prevent an entire category of bugs in financial systems. Always `timestamptz`.

## Soft-Delete Strategy

We use two complementary mechanisms for "removing" records:

### `is_active` flag (everyday deactivation)

For records that should be retained for referential and audit integrity but no longer active. Examples:

- A cashier who left the company. Their `users.is_active = false`. Existing sales still reference them; audit logs still show their actions; they cannot log in.
- A discontinued product. `products.is_active = false`. Past sales still link to it; it doesn't appear in new sale screens.

This is the **default operation** for "remove this thing" in the POS context.

### `deleted_at` (soft delete)

A nullable timestamp set by `@DeleteDateColumn`. Used for genuine data removal where the record should disappear from normal queries entirely (e.g., a mistakenly-created account).

TypeORM automatically excludes `deleted_at IS NOT NULL` rows from queries. To include them, pass `{ withDeleted: true }`.

### When to use which

| Scenario | Choice |
|----------|--------|
| Employee terminated | `is_active = false` |
| Account created in error | `deleted_at = NOW()` |
| Product discontinued | `is_active = false` |
| Duplicate record cleanup | `deleted_at = NOW()` |

**Hard delete is never used.** Foreign keys across the system would orphan or cascade in undesirable ways. If a record genuinely must vanish (e.g., GDPR right-to-erasure), it should be handled through a deliberate process, not a routine `DELETE`.

## CHECK Constraints for Enums

For columns with a fixed set of values (e.g., `role`, `status`), we use:

1. A **TypeScript enum** for application-layer type safety.
2. A **varchar column** in the database (not native PG enum).
3. A **CHECK constraint** enforcing the same set of values at the DB layer.

### Why not native PostgreSQL `ENUM` type?

PG enums are painful to modify — values cannot be dropped, reordering requires recreating the type, and renaming is awkward. A `varchar` + CHECK gives identical safety with simple `ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT` for evolution.

### Why not skip the CHECK constraint?

Defense in depth. The TypeScript enum prevents application bugs from inserting bad values; the CHECK constraint defends against direct SQL access, migration mistakes, or future code that bypasses the entity layer.

## Tables

### `users`

The application's user accounts (admin, manager, cashier).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `email` | `varchar(255)` | Unique (indexed), lowercase-normalized |
| `password_hash` | `varchar(255)` | bcrypt, work factor 12. **Never exposed via API.** |
| `full_name` | `varchar(100)` | Display name |
| `role` | `varchar(20)` | `'admin' \| 'manager' \| 'cashier'` (CHECK constraint) |
| `is_active` | `boolean` | Default `true`. Inactive users cannot log in. |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |
| `deleted_at` | `timestamptz` nullable | Soft delete |

**Constraints:**
- `PK_users_id` — primary key on `id`
- `CHK_users_role` — `role IN ('admin', 'manager', 'cashier')`

**Indexes:**
- `idx_users_email` — UNIQUE on `email`

**Migration:** `CreateUsersTable` (first real migration, follows the `PipelineCheck` test from Phase 5.4 — now cleaned up).

### `branches`

Physical shop locations. Every product and stock row belongs to exactly one branch.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `name` | `varchar(100)` | Branch display name (e.g., "Main Shop") |
| `address` | `text` | Full street address |
| `phone` | `varchar(10)` | Sri Lankan format: exactly 10 digits starting with `0` (validated in DTO and at DB with CHECK) |
| `is_active` | `boolean` | Default `true`. Service guard prevents deactivating the last active branch. |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

**Constraints:**
- `PK_branches_id` — primary key on `id`
- `CHK_branches_phone` — `phone ~ '^0[0-9]{9}$'` <!-- 🔍 verify constraint name and regex in migration -->

**No `deleted_at`.** Branches hold historical references from every product, stock, and future sale. Hard-preserving them is required.

**Seed:** the migration inserts a single "Main Shop" branch so the app has a valid default.

**Migration:** `CreateBranchesTable`

---

### `brands`

Manufacturer brands (Apple, Samsung, Nokia, etc.).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `name` | `varchar(100)` | Brand name; case-insensitive unique among active rows |
| `is_active` | `boolean` | Default `true` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |
| `deleted_at` | `timestamptz` nullable | Soft delete |

**Constraints:**
- `PK_brands_id` — primary key on `id`

**Indexes:**
- `idx_brands_name_lower_active` — UNIQUE on `LOWER(name)` WHERE `deleted_at IS NULL` (functional partial index) <!-- 🔍 verify index name -->

**Why the functional partial index:** application-layer "already exists?" checks race under concurrent create. Enforcing at the DB with a functional index on `LOWER(name)` (ignoring soft-deleted rows) makes duplicates impossible regardless of casing or timing.

**Migration:** `CreateBrandsTable`

---

### `categories`

Product taxonomy with a two-level hierarchy (root → child).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `name` | `varchar(100)` | Sibling-scoped case-insensitive unique |
| `parent_id` | `uuid` nullable | Self-reference to another category; `NULL` for top-level |
| `is_active` | `boolean` | Default `true` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |
| `deleted_at` | `timestamptz` nullable | Soft delete |

**Constraints:**
- `PK_categories_id` — primary key on `id`
- `FK_categories_parent_id` — `parent_id` references `categories.id`, `ON DELETE RESTRICT`

**Indexes:**
- `idx_categories_name_parent_lower_active` — UNIQUE on `(LOWER(name), COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid))` WHERE `deleted_at IS NULL` <!-- 🔍 verify index name and sentinel UUID -->

**Why the `COALESCE` on `parent_id`:** Postgres treats `NULL` values in unique indexes as always distinct, which would allow duplicate top-level categories. Coalescing `NULL` to a fixed sentinel UUID collapses those into a single comparable value so uniqueness holds for both top-level and child categories.

**Two-level cap enforced app-side.** The schema allows arbitrary depth via self-reference; the service layer rejects create/update operations that would produce depth 3 or greater. See [products.md](./products.md).

**Non-cascading deactivation.** Deactivating a parent leaves children (and any products) untouched.

**Migration:** `CreateCategoriesTable`

---

### `sku_barcode_counters`

Atomic sequence generator for product SKUs and internal barcodes. Two-row singleton table.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `code_type` | `varchar(20)` | Either `'SKU'` or `'BARCODE'` (CHECK constraint) |
| `next_value` | `bigint` | Next integer to hand out; incremented on use |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

**Constraints:**
- `PK_sku_barcode_counters_id` — primary key on `id`
- `CHK_sku_barcode_counters_code_type` — `code_type IN ('SKU', 'BARCODE')`

**Indexes:**
- `idx_sku_barcode_counters_code_type` — UNIQUE on `code_type` (ensures exactly one row per type) <!-- 🔍 verify index name -->

**Seed:** migration inserts the two initial rows, both with `next_value = 1`.

**Access pattern:** consumers must `SELECT ... FOR UPDATE` on the row inside a transaction, read `next_value`, format it (`SKU-000042`, `SLP-000042`), increment, and commit. The row lock serialises concurrent product creation, preventing SKU/barcode collisions.

**Why not a Postgres sequence:** sequences gap on rollback (leaving holes in the SKU space) and don't natively produce zero-padded formatted output. A counter table with row locks gives gap-free, formatted, testable generation.

**Migration:** `CreateSkuBarcodeCountersTable` <!-- 🔍 verify migration name (may be singular in your naming) -->

---

### `products`

The catalog. Every product belongs to one brand, one category, and one branch.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `sku` | `varchar(20)` | Format `SKU-000001`; always auto-generated on create; admin may override on update |
| `barcode` | `varchar(50)` | Format `SLP-000001` (auto) or manufacturer-supplied (accepted as-is on create) |
| `name` | `varchar(200)` | Product name <!-- 🔍 verify length -->|
| `description` | `text` nullable | Optional long description <!-- 🔍 verify field exists / nullability -->|
| `product_type` | `varchar(20)` | Enum (CHECK): `PHONE`, `ACCESSORY`, etc. <!-- 🔍 verify enum values -->|
| `phone_condition` | `varchar(10)` nullable | Enum (CHECK): `NEW`, `USED`; only meaningful when `product_type = 'PHONE'` |
| `cost_price` | `numeric(10,2)` | Purchase cost <!-- 🔍 verify column name -->|
| `selling_price` | `numeric(10,2)` | Retail price <!-- 🔍 verify column name -->|
| `warranty_months` | `integer` | Default `0`. Full manufacturer warranty duration. |
| `checking_warranty_days` | `integer` | Default `0`. Short defect-check window (mostly used phones). |
| `is_serialized` | `boolean` | Default `false`. When `true`, POS prompts cashier for IMEI at sale. |
| `brand_id` | `uuid` | FK → `brands.id` |
| `category_id` | `uuid` | FK → `categories.id` |
| `branch_id` | `uuid` | FK → `branches.id` |
| `is_active` | `boolean` | Default `true` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |
| `deleted_at` | `timestamptz` nullable | Soft delete |

**Constraints:**
- `PK_products_id` — primary key on `id`
- `FK_products_brand_id`, `FK_products_category_id`, `FK_products_branch_id`
- `CHK_products_product_type` — enum validation
- `CHK_products_phone_condition` — enum validation (with `NULL` allowed)

**Indexes:**
- `idx_products_sku` — UNIQUE on `sku`
- `idx_products_barcode` — UNIQUE on `barcode` <!-- 🔍 verify whether barcode uniqueness is partial (nullable barcode?) -->
- `idx_products_brand_id`, `idx_products_category_id`, `idx_products_branch_id` — FK-supporting indexes

**Why prices are `numeric`, not `float`/`double`:** IEEE-754 rounding errors accumulate across sale lines and tax calculations. `numeric(10,2)` gives exact decimal arithmetic. TypeScript treats these as `string` end-to-end to prevent accidental float coercion.

**Cross-entity validation lives at the service layer.** `ProductsService.create()` checks brand/category/branch are all active before insert, producing clean 400 errors instead of raw Postgres FK failures.

**Stock auto-creation.** Every product create atomically inserts a matching `stock` row at quantity 0 for the product's home branch (via `forwardRef` between `ProductsModule` and `StockModule`).

**Migration:** `CreateProductsTable`

---

### `stock`

Per-product, per-branch inventory quantities.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `product_id` | `uuid` | FK → `products.id` |
| `branch_id` | `uuid` | FK → `branches.id` |
| `quantity` | `integer` | Current on-hand quantity; default `0` |
| `low_stock_threshold` | `integer` | Admin-configurable per row; default `0` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

**Constraints:**
- `PK_stock_id` — primary key on `id`
- `FK_stock_product_id`, `FK_stock_branch_id`
- `CHK_stock_quantity_non_negative` — `quantity >= 0` <!-- 🔍 verify constraint exists -->

**Indexes:**
- `idx_stock_product_branch` — UNIQUE on `(product_id, branch_id)` (one stock row per product per branch) <!-- 🔍 verify index name -->
- `idx_stock_product_id`, `idx_stock_branch_id` — FK-supporting indexes

**No `deleted_at`.** Stock history is operational data; quantity 0 represents "not carrying here" without erasing the record.

**No DELETE endpoint** — quantity 0 is the correct state for a discontinued line at a branch.

**`low_stock_alert` is computed on read** (`quantity <= low_stock_threshold`) and included in API responses. Never stored — avoids stale-flag bugs.

**Auto-created on product create** at quantity 0 for the product's home branch.

**Migration:** `CreateStockTable`