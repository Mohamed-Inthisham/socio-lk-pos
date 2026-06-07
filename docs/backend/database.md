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