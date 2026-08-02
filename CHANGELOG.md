# Changelog

All notable changes to the SOCIO.LK POS project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

#### Authentication System (Redux Toolkit)
- Configured Redux store with `@reduxjs/toolkit`
- Created auth slice with user, token, and authentication state
- Implemented async login/logout thunks
- Mock authentication service with three test users (admin/manager/cashier)
- Mock JWT-like token generation with 24-hour expiration

#### Session Persistence
- localStorage utility for safe storage operations
- Auto-restore session on app load
- Token validation with expiration check
- Persistent login across browser sessions

#### Route Protection
- `ProtectedRoute` component for authenticated routes
- Smart redirect: remembers intended URL after login
- Loading states during session restoration
- `RoleProtectedRoute` for role-specific pages

#### Role-Based Access Control (RBAC)
- Centralized permission definitions (`rolePermissions.js`)
- Three user roles: Admin 👑, Manager 👔, Cashier 🛒
- `usePermissions` custom hook for easy permission checks
- "Visible but Disabled" UI pattern for unauthorized actions
- Helper utilities: `can()`, `isAdmin`, `isManager`, `isCashier`

#### Demo Dashboard
- Temporary dashboard demonstrating RBAC in action
- Role-based button states (enabled/disabled)
- Tooltips explaining unauthorized actions
- User info card showing session details
- Logout functionality with state cleanup

#### Documentation
- Initial project documentation foundation
  - Comprehensive README with project overview, tech stack, and roadmap
  - Architecture documentation explaining tech decisions
  - Git workflow and branching strategy guide
  - Getting started setup guide
  - Changelog for version tracking

#### Backend Foundation (NestJS)
- 🏗️ NestJS scaffolded in `backend/` folder
- 🔐 Hybrid `.gitignore` strategy (root + frontend + backend)
- ✅ Zod schema for environment validation (fail-fast on startup)
- 🔧 `TypedConfigService` — typed wrapper around `@nestjs/config`
- 🗄️ TypeORM connected to PostgreSQL (`socio_lk_pos_dev`)
- 🚫 `synchronize: false` — schema changes only via migrations
- 🛡️ Helmet (security headers), CORS, two-tier rate limiting (10/sec, 100/min)
- 🌐 API versioning prefix (`/api/v1`)

#### Database Migrations
- 📜 TypeORM DataSource configured for migration CLI
- 🔄 npm scripts for full migration workflow (`generate`, `create`, `run`, `revert`, `show`)
- ✅ Pipeline verified end-to-end (forward + reverse + re-forward)

#### Users Module
- 👤 `User` entity with UUID primary key, soft-delete, and CHECK-constrained role
- 🗃️ First real migration: `CreateUsersTable` with `uuid-ossp` extension
- 🔧 `UsersService` — create, find, update, deactivate, soft-delete operations
- 🔒 bcrypt password hashing (work factor 12)
- ✔️ DTOs with `class-validator` (`CreateUserDto`, `UpdateUserDto`)
- 🛡️ Global `ValidationPipe` with whitelist + forbidNonWhitelisted (mass-assignment protection)

#### Auth Module
- 🔐 `RefreshToken` entity + migration (`CreateRefreshTokensTable`)
- 🎫 JWT access + refresh token strategy with rotation
- 🍪 httpOnly cookies with `SameSite=Strict` (config-driven `Secure` + `Domain`)
- 🛡️ Timing-safe login (dummy bcrypt compare when user doesn't exist)
- 🔄 Refresh token rotation with reuse detection (revokes all sessions on suspicious reuse)
- 🗝️ SHA-256 hashed refresh tokens in DB (never plaintext)
- 📍 Session metadata captured (IP address, user agent) for audit
- 🛂 `JwtAuthGuard` + `@CurrentUser()` decorator for clean route protection
- 🚪 4 endpoints: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`

#### RBAC (Role-Based Access Control)
- 🛡️ `JwtAuthGuard` registered globally (secure by default)
- 🚪 `@Public()` decorator for explicit opt-out on unauthenticated routes
- 🏷️ `@Roles(...roles)` decorator using `UserRole` enum for type safety
- 👮 `RolesGuard` enforces role requirements per route (401 for auth failure, 403 for role failure)
- 📗 `docs/backend/rbac.md` documenting design and usage patterns

#### Backend Documentation
- 📘 `docs/backend/configuration.md` — env vars and config layer
- 🔐 `docs/backend/security.md` — Helmet, CORS, rate limiting
- 🗄️ `docs/backend/migrations.md` — migration workflow
- 🗃️ `docs/backend/database.md` — schema conventions, soft-delete strategy, table reference
- 🔑 `docs/backend/auth.md` — auth design, token strategy, and endpoint reference
- 🛂 `docs/backend/rbac.md` — role hierarchy, guard pipeline, and decorator usage
- 📇 `docs/backend/README.md` — index page linking all backend topic docs

#### Audit Log System
- 🗂️ `AuditLog` entity with nullable user FK (`ON DELETE SET NULL`) preserving `user_name` / `user_role` snapshots
- 🏷️ `@Auditable(entityType, action)` decorator for declarative audit marking
- 🎯 `AuditLogInterceptor` (global) — reads metadata, computes generic before/after diff (excludes `created_at`/`updated_at`/`deleted_at`), writes fire-and-forget
- 🔍 `GET /api/v1/audit-logs` (admin-only) with 6 filters + pagination (max limit 100)
- 📅 6-month retention policy documented; purge job deferred
- 📗 `docs/backend/audit-logs.md`

#### API Documentation (Swagger)
- 📖 `@nestjs/swagger` mounted at `/api/docs`, dev-only (gated on `NODE_ENV !== 'production'`)
- 🍪 Cookie auth scheme registered via `addCookieAuth`
- 🏷️ All DTOs annotated with `@ApiProperty` / `@ApiPropertyOptional`
- 🏷️ All controllers annotated with `@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiCookieAuth`
- 📗 `docs/backend/api-documentation.md`

#### Frontend ↔ Backend Integration
- 🔌 Preconfigured axios client (`services/api.js`) with `withCredentials: true` and `VITE_API_BASE_URL`
- 🔁 401 refresh interceptor with `refreshPromise` coalescing (prevents parallel refreshes tripping backend reuse-detection)
- 🔗 Decoupled auth-failure handler via `setAuthFailureHandler` callback (avoids circular dep between `api.js` and Redux store)
- 🗺️ Backend shape mapping at service boundary (`mapBackendUser`: `full_name` → `name`)
- ✅ RBAC verified end-to-end against real backend (cashier vs admin)

#### Testing Infrastructure
- 🧪 Separate test DB (`socio_lk_pos_test`) with `.env.test` and `BCRYPT_ROUNDS=4` for speed
- ⚙️ `data-source.ts` env-loading keyed on `NODE_ENV`; `cross-env` for cross-platform env vars
- 🔒 Jest `maxWorkers: 1` for e2e to serialize DB access
- 🧰 `createTestApp` helper mirroring `main.ts` essentials (Helmet, cookie-parser, ValidationPipe, `/api/v1` prefix)
- ✅ 47 tests total — unit: `diffObjects` (10), `AuthService` (18); e2e: auth flow (13), RBAC + audit interceptor (6)
- 📗 `docs/backend/testing.md`

#### Branches Module (Phase 6.1)
- 🏬 `Branch` entity with UUID PK, name, address, phone, `is_active` toggle
- 📱 Sri Lankan phone validation on DTO (`^0\d{9}$` — exactly 10 digits starting with 0)
- 🛡️ "Cannot deactivate the last active branch" service guard prevents lock-out
- 🌱 Seed migration inserts "Main Shop" as the initial branch
- 🚫 No `deleted_at` — hard-preserving branch history is a data-integrity requirement
- 🚪 6 endpoints: list, get, create, update, deactivate, reactivate

#### Brands Module (Phase 6.1)
- 🏷️ `Brand` entity with UUID PK, name, `is_active`, soft-delete
- 🔒 Case-insensitive uniqueness via functional partial index: `LOWER(name) WHERE deleted_at IS NULL`
- 🚫 Non-cascading deactivation — brand deactivation does not touch products
- 🚪 6 endpoints: list, get, create, update, deactivate, reactivate

#### Categories Module (Phase 6.1)
- 🗂️ `Category` entity with self-referencing nullable `parent_id` for hierarchy
- 📏 Two-level hierarchy cap enforced app-side (create + update guards reject depth 3)
- 🔒 Sibling-scoped case-insensitive uniqueness via functional partial index using `COALESCE(parent_id, sentinel_uuid)` to collapse NULLs into a comparable value
- 🌲 `GET /categories/top-level` for sidebar / navigation-tree consumers
- 🚫 Non-cascading deactivation — parent deactivation does not touch children or products
- 🚪 7 endpoints: list, top-level, get, create, update, deactivate, reactivate

#### SKU/Barcode Counter (Phase 6.1, internal)
- 🔢 `SkuBarcodeCounter` singleton table with two seed rows: `SKU` and `BARCODE`
- 🔐 Row-locked increment via `SELECT ... FOR UPDATE` inside a transaction — collision-safe under concurrent product creation
- 🧾 Formatted output: `SKU-000001`, `SLP-000001` with zero-padding
- 🚫 No HTTP surface — service is consumed only by `ProductsService`

#### Products Module (Phase 6.1)
- 📦 `Product` entity with FKs to brand, category, branch; UUID PK; soft-delete
- 🎫 SKU auto-generated on create (never client-supplied); barcode auto-generated if omitted, accepted if provided (supports manufacturer barcodes at receive time)
- ✏️ Admin can override SKU on update — for correcting bad initial entries
- 💰 Prices stored as `numeric(10,2)` in DB, `string` in code — avoids IEEE-754 rounding bugs
- 🏭 `product_type` enum, `phone_condition` enum (NEW/USED, nullable — only meaningful when `product_type = PHONE`)
- ⏱️ Two warranty fields: `warranty_months` (full manufacturer warranty) and `checking_warranty_days` (defect-check window for used phones)
- 🔖 `is_serialized` flag → cashier prompted for IMEI at sale time (per-unit tracking deferred to R2)
- ✅ Cross-entity validation at service layer — active-status checks on brand/category/branch produce clean 400s instead of raw FK failures
- 🧬 Nested read responses `{ brand, category, branch }` — kills N+1 on product lists
- 🔍 `GET /products/by-barcode/:barcode` for POS scan-to-cart
- 🚪 7 endpoints: list, by-barcode, get, create, update, deactivate, reactivate

#### Stock Module (Phase 6.1)
- 📊 `Stock` entity: per-product, per-branch quantity + configurable low-stock threshold
- 🔁 Auto-created at quantity 0 on product create (via `forwardRef` between `ProductsModule` and `StockModule`)
- 🚨 `low_stock_alert` boolean computed on read (`quantity <= low_stock_threshold`) — never stored, avoids stale-flag bugs
- 🧬 Nested read responses `{ product, branch }`
- 🚫 No DELETE endpoint — quantity 0 is the correct "not carrying here" state; preserves history
- 🚪 5 endpoints: list, by-product, get, create, update

#### Products Backend Testing (Phase 6.1)
- 🧪 200 new tests (116 unit + 84 e2e) bringing the backend suite to 247 total — all green
- 🔄 `test/setup.ts` truncation now enumerates entity tables dynamically from TypeORM metadata (new entities auto-truncate)
- 💤 50ms sleep before truncate lets fire-and-forget audit writes flush, prevents Postgres lock races during teardown
- 🌱 Cross-module e2e tests re-seed `SkuBarcodeCounter` rows (`SKU`, `BARCODE`) after truncation before creating products
- 💤 110ms sleep in every `loginAndGetCookies` helper works around the hardcoded 10/sec throttler tripping under test load (tracked as tech debt)

#### Backend Documentation (Phase 6.1)
- 📗 `docs/backend/products.md` — Products Backend design, endpoints, RBAC matrix, cross-entity flows, migration notes, and test coverage
- 📇 `docs/backend/README.md` updated to index the new topic doc

#### User → Branch Link (Phase 6.2, Path A)
- 🔗 `users.branch_id` — nullable UUID FK to `branches.id`, `ON DELETE RESTRICT` (migration `AddBranchIdToUsers1785413437552`)
- 🛡️ `CHK_users_branch_role` — DB-level invariant: `role = 'admin' OR branch_id IS NOT NULL` (admins stay unbranched, staff always scoped)
- 🌱 Migration backfills existing non-admin users to "Main Shop" before adding the CHECK constraint
- 🔧 `UsersService` re-enforces the same branch/role invariant at the service layer — clean 400s instead of raw constraint violations, plus active-branch validation on both create and update
- 🔑 `branch_id` embedded in the JWT payload; `AuthenticatedUser`, `/auth/me`, and `/auth/login` responses now include `branch_id` + nested `branch`
- 🚪 `GET /branches/:id` scoped: admin unrestricted, manager/cashier limited to their own branch (403 otherwise) — first appearance of the branch-scoping pattern, to be extended to other entities' list endpoints at multi-branch launch (R9)
- 🧪 31 new unit tests + 8 new e2e tests — backend suite now 175 unit + 111 e2e = **286 tests total**, all green
- 📗 `docs/backend/auth.md`, `docs/backend/rbac.md`, `docs/backend/database.md`, `docs/backend/products.md` updated for the branch link

### Changed
- Migrated `LoginForm` from local state to Redux state management
- Updated `App.jsx` with React Router setup and protected routes
- Updated `main.jsx` to wrap app with Redux Provider and BrowserRouter
- 🧹 `tsconfig.json`: removed deprecated `baseUrl` and obsolete `ignoreDeprecations`
- 🎯 `eslint.config.mjs`: allow underscore-prefixed unused vars (standard convention)
- 🧰 `eslint.config.mjs`: downgrade `no-unsafe-*` rules to `warn` (library-typed `any` values)
- 🧬 `eslint.config.mjs`: allow single-extends empty interfaces (for declaration merging)
- 🔄 Replaced frontend mock auth (mock JWT + localStorage + `jwt-decode`) with real backend integration
- 🗑️ Deleted `storage.js` and `jwt-decode` dependency — tokens now live only in httpOnly cookies
- 🧾 `authSlice` simplified: no token in Redux state; `restoreSession` now calls `/auth/me`

### Fixed
- 🐛 **JWT hash collision on rapid rotation** — identical payloads issued within the same second produced byte-identical JWTs, tripping the `refresh_tokens.token_hash` unique constraint. Fixed by adding `jti` (`crypto.randomUUID()`) to every JWT payload. Caught by e2e tests.
- 🐛 **e2e test races against shared test DB** — Jest ran spec files in parallel, causing mid-flight `TRUNCATE` from other suites. Fixed by setting `maxWorkers: 1` in `jest-e2e.json`. Caught by intermittent test failures.

### Planned
- Real dashboard layout with sidebar navigation
- Product management module
- POS checkout flow
- Inventory tracking
- Customer management
- Reports & analytics
- AWS deployment

---

## [0.1.0] - 2026-05-14

### Added
- 🎉 Initial project setup
- ⚛️ React 19 with Vite configuration
- 🎨 Tailwind CSS v4 setup with custom theme
- 🛣️ React Router installation
- 📦 Redux Toolkit installation (not yet configured)
- 🗂️ Folder structure established
  - `src/assets/` for images
  - `src/components/common/` for shared components
  - `src/components/auth/` for auth components
  - `src/pages/` for route pages

### Components Built
- 🏷️ **Logo Component** — Brand logo with configurable sizes (sm, md, lg)
- 📝 **InputField Component** — Reusable input with:
  - Icon support (Mail, Lock from lucide-react)
  - Password visibility toggle
  - Focus states
  - Error message display
- 🔘 **Button Component** — Reusable button with:
  - Loading state with spinner
  - Gradient background
  - Full-width option
- 📋 **LoginForm Component** — Form with validation and mock submission
- 🖥️ **LoginPage** — Fully responsive layout:
  - Mobile: Clean white form-first design
  - Desktop: Glass morphism with split-panel layout (55/45)

### Design System
- 🎨 Dark teal/blue gradient theme (#0f2027 → #203a43 → #2c5364)
- ✨ Cyan accent colors (#0ea5e9, #06b6d4, #38bdf8)
- 📱 Mobile-first responsive approach
- 🔍 Glass morphism effects for desktop

### Project Structure
- 🌿 Git Flow branching strategy implemented
  - `main` — Production branch
  - `develop` — Integration branch
  - `feature/*` — Feature branches
- 📋 Pull Request workflow established
- ✅ First PR (#3) merged: `feature/login-page` → `develop`

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.1.0 | 2026-05-14 | Initial setup + login UI |
| Unreleased | TBD | Documentation foundation |

---

## How to Read This Changelog

### Categories

- **Added** — New features
- **Changed** — Changes to existing functionality
- **Deprecated** — Features marked for removal
- **Removed** — Features removed in this version
- **Fixed** — Bug fixes
- **Security** — Security-related changes

### Versioning Format: `MAJOR.MINOR.PATCH`

- **MAJOR** — Breaking changes (e.g., 1.0.0 → 2.0.0)
- **MINOR** — New features, backwards compatible (e.g., 1.0.0 → 1.1.0)
- **PATCH** — Bug fixes only (e.g., 1.0.0 → 1.0.1)

### Example

1 . 2 . 3
│   │   │
│   │   └── Patch (bug fix)
│   └────── Minor (new feature)
└────────── Major (breaking change)

---



## Update Guidelines

When making changes, add entries under `[Unreleased]`:

​```markdown
## [Unreleased]

### Added
- New feature description

### Fixed
- Bug fix description
​```

When ready to release, move `[Unreleased]` items to a new version section with the date.

---

**Maintained by:** [Mohamed Inthisham](https://github.com/Mohamed-Inthisham)
