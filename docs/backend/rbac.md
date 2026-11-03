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

## Branch Scoping

Role gates *which endpoints* a user can call; branch scoping (new in Phase 6.2) gates *which rows* they see once inside. `GET /branches/:id` is the first endpoint to apply the pattern:

- **Admin** — unrestricted. Admins are unbranched (`branch_id` is always `null`), so there's nothing to scope against.
- **Manager / cashier** — locked to their own assigned branch. Requesting any other branch id returns `403 Forbidden`.

​```typescript
async findOne(
  @Param('id', ParseUUIDPipe) id: string,
  @CurrentUser() user: AuthenticatedUser,
) {
  if (user.role !== UserRole.ADMIN && user.branch_id !== id) {
    throw new ForbiddenException('You can only view your own branch');
  }
  return this.branchesService.findOne(id);
}
​```

This relies on the DB-level `CHK_users_branch_role` invariant (every non-admin user has a non-null `branch_id` — see [database.md](./database.md)), so the comparison never needs a null-check on `user.branch_id`.

### Branch-scoped reads (Phase 2)

`common/utils/branch-scope.ts` holds the shared rule for reads. The actor is the session user (`request.user`), which `JwtStrategy` re-reads from the database on every request; a `branchId` the client sends is never trusted on its own.

- `scopeBranch(actor, requestedBranchId?)`: the branch a read may cover. Admin: the branch requested, or `undefined` for every branch. Manager / cashier: their own branch, whether `branchId` is left out or is their own; another branch is **403** `{ message: 'You can only access data for your own branch.', code: 'WRONG_BRANCH' }`, never silently replaced. A staff user with no branch is refused too.
- `assertBranchAccess(actor, branchId)`: 403 `WRONG_BRANCH` unless the actor is an admin or at that branch.
- **One record at another branch is 404**, the same answer as a missing id, so staff can't learn that it exists: the service looks it up with the staff member's branch in the same query.
- **Writes keep their existing checks and codes** (`SALE_WRONG_BRANCH`, `VOID_WRONG_BRANCH`, `RETURN_WRONG_BRANCH`, `CASH_DAY_WRONG_BRANCH`, …): a write to another branch's record is still 403.

| Endpoint | Admin | Manager / cashier |
|---|---|---|
| `GET /sales` (including a customer's history, `customerId`) | every branch, or `branchId` | own branch; another `branchId` → 403 `WRONG_BRANCH` |
| `GET /sales/:id` | any sale | own branch's sales; another branch's → 404 |
| `GET /sales/daily-summary` | `branchId` required (400 without it) | own branch; another `branchId` → 403 `WRONG_BRANCH` |
| `GET /phone-purchases` (P2-2; `customer_id` filter included) | every branch, or `branchId` | own branch; another `branchId` → 403 `WRONG_BRANCH` |
| `GET /phone-purchases/:id` (P2-2) | any purchase | own branch's purchases; another branch's → 404 |

The sales rows are P2-1. `POST /phone-purchases` keeps its own check (403 "You can only intake phones at your own branch").

Customers themselves stay global: every role reads the customer record, but their purchase history follows the sales list's scoping.

### Where this is headed

The other branch-owned reads are still unscoped and follow in later Phase 2 steps: product units and the sellable-IMEI lookup (which also still show a traded-in phone's seller and purchase, through `phone_purchase` and `phone_purchase.customer`), and stock. Stock purchases, cash days, the inspection list and approvers were already scoped. Behaviour for a deactivated branch's staff is not yet enforced.

## Staff Personal Data in Responses

A staff member's email, phone, NIC and home address (`users.email`, `phone`, `nic`, `address`) are personal data. They appear only where they're the point (F3):

- **Operational responses never carry them.** A user embedded in a response (`sale.cashier`, `voider`, `void_requester`, `phone_purchase.cashier`, `stock_purchase.created_by`, `payments[].created_by`, …) comes through the global `ClassSerializerInterceptor`, and the `User` entity `@Exclude()`s the four fields, as it does the password and PIN fields. Operational screens only show `full_name`.
- **Admin user management is the controlled exception.** The `/users` endpoints are admin-only (`@Roles(ADMIN)` on the controller) and answer with plain objects built by `UsersService.toSafeUser`, which the serializer leaves as they are: they keep the four fields for the Users screens and drop only the secrets.
- **A user's own `/auth/login` and `/auth/me`** list explicit fields, including their own email, and never phone, NIC or address.

A new endpoint that returns user relations gets this protection automatically as long as it returns entities. One that builds its own object from a user must leave these fields out, unless it's admin user management. `test/secret-exposure.e2e-spec.ts` checks every embedded user in the responses it covers.

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