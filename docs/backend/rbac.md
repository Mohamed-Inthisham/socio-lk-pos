# Role-Based Access Control (RBAC)

This document covers authorization: given an authenticated user, which routes they may access. Authentication (proving who they are) is documented separately in [auth.md](./auth.md).

## Overview

RBAC is enforced through two mechanisms working together:

1. **Global guards** — every route is protected by default. Guards run on every request.
2. **Decorator-based opt-out and opt-in** — `@Public()` opens a route to unauthenticated access; `@Roles(...)` restricts a route to specific roles.

## The Two Guards

Two global guards run on every request in a specific order:

1. **`JwtAuthGuard`** — verifies the JWT from the `access_token` cookie. Populates `req.user` on success. Short-circuits `@Public()` routes.
2. **`RolesGuard`** — reads `@Roles()` metadata and checks `req.user.role`. No `@Roles()` on a route means any authenticated user may access it.

Both are registered as `APP_GUARD` in `AuthModule`. Order in the providers array is significant: authentication runs before authorization.

## Roles

Defined as a TypeScript enum in `users/enums/user-role.enum.ts`:

- `UserRole.ADMIN` — full system access
- `UserRole.MANAGER` — operational access minus admin-only functions (user management, cost prices, deletions)
- `UserRole.CASHIER` — POS-facing access only (ring up sales, view products, basic customer lookup)

Role assignments live on the `users` table and are enforced by both the CHECK constraint at the DB layer and the `class-validator` `@IsEnum(UserRole)` on `CreateUserDto`.

## Status Codes

The API distinguishes authentication and authorization failures:

| Status | Meaning | When |
|--------|---------|------|
| 401 Unauthorized | "Who are you?" | No token, expired token, invalid signature |
| 403 Forbidden | "I know you, but no." | Valid token, insufficient role |

Frontends should handle these differently: 401 → redirect to login; 403 → show "not authorized" error.

## Decorator Usage

### Public routes (no authentication required)

​```typescript
@Public()
@Post('login')
async login(@Body() dto: LoginDto) { ... }
​```

Also works at the class level for a whole controller.

### Any authenticated user

​```typescript
@Get('me')
getMe(@CurrentUser() user: AuthenticatedUser) { ... }
​```

No annotation needed — this is the default.

### Role-restricted routes

​```typescript
@Get('reports/profit')
@Roles(UserRole.ADMIN)
getProfitReport() { ... }

@Get('reports/sales')
@Roles(UserRole.ADMIN, UserRole.MANAGER)
getSalesReport() { ... }
​```

## Design Choices

### Why global guards (opt-out) instead of per-route guards (opt-in)?

Secure by default. Forgetting to add `@UseGuards(JwtAuthGuard)` in an opt-in model creates a silently public route — the most common category of accidental data leak. With opt-out, the same mistake produces a route that requires login, which is caught immediately during testing.

The pattern mirrors firewall defaults, CSP, and Kubernetes NetworkPolicies: deny everything, allowlist what's needed.

### Why one role per user (not a permissions table)?

Three fixed roles map cleanly to a POS's operational reality. Custom roles per franchise or user-editable permissions are the kind of feature that adds significant complexity — a `roles` table, a `permissions` table, a `role_permissions` join table, an admin UI to manage them. If the requirement never materialized, that complexity would be pure overhead. Enum is right-sized for the current problem.

### Why check `is_active` on every request in the JWT strategy?

`is_active = false` is our everyday "deactivate this user" operation. If the JWT strategy trusted the token alone, a fired employee would remain logged in until their token expired (up to 15 minutes). Checking `is_active` on each request means deactivation is instant.

Tradeoff: one DB lookup per authenticated request. For POS scale (dozens of concurrent users), this is negligible. At higher scale, this becomes the natural boundary to introduce a cache (Redis with a short TTL).

### Why include `role` in the JWT payload?

Two reasons: it's convenient (RolesGuard reads it without a DB call), and it's already there for downstream services that might want it. **But** — the strategy's `validate()` still refetches the user from DB, so a role change takes effect on the next request, not 15 minutes later. Belt and suspenders.

## Frontend Coordination

The frontend RBAC (from the Redux phases) follows the same three roles. Two important patterns from the requirements doc:

- **Visible-but-disabled** — unauthorized buttons stay visible with a tooltip explaining why (better UX than making them vanish inconsistently)
- **Hide sensitive fields** — cost prices, profit margins, etc. are stripped from responses before the frontend even sees them; RBAC on the backend is the authoritative gate, not just a UI decoration

## Future Work

- **Permission-level RBAC** — if roles become insufficient (custom franchise-specific permissions), migrate to a permission-based system. Straightforward path forward: introduce a `permissions` table and a `role_permissions` join, then swap `@Roles()` for `@RequirePermissions()`.
- **Response filtering by role** — automatic removal of sensitive fields from response DTOs based on role. Currently manual per-endpoint; interceptor-based approach is possible if patterns emerge.
- **Audit log integration** — every 403 should be logged (Phase 5.8) as a security-relevant event.