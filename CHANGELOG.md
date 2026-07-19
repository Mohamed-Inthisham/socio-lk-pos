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

#### Backend Documentation
- 📘 `docs/backend/configuration.md` — env vars and config layer
- 🔐 `docs/backend/security.md` — Helmet, CORS, rate limiting
- 🗄️ `docs/backend/migrations.md` — migration workflow
- 🗃️ `docs/backend/database.md` — schema conventions, soft-delete strategy, table reference
- 🔑 `docs/backend/auth.md` — auth design, token strategy, and endpoint reference

### Changed
- Migrated `LoginForm` from local state to Redux state management
- Updated `App.jsx` with React Router setup and protected routes
- Updated `main.jsx` to wrap app with Redux Provider and BrowserRouter
- 🧹 `tsconfig.json`: removed deprecated `baseUrl` and obsolete `ignoreDeprecations`
- 🎯 `eslint.config.mjs`: allow underscore-prefixed unused vars (standard convention)
- 🧰 `eslint.config.mjs`: downgrade `no-unsafe-*` rules to `warn` (library-typed `any` values)
- 🧬 `eslint.config.mjs`: allow single-extends empty interfaces (for declaration merging)

### Planned
- Audit log system for tracking user actions (who did what, when)
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