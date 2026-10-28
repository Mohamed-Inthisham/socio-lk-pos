# Authentication

This document covers the authentication design, endpoint reference, and security decisions for SOCIO.LK POS. Authorization (role checks) is documented separately in [rbac.md](./rbac.md).

## Overview

Authentication uses **JWT with rotating refresh tokens**, transported via **httpOnly cookies**. Sessions are tracked server-side in the `refresh_tokens` table for revocation and audit purposes.

## Token Strategy

Two tokens per session:

| Token | Lifetime | Cookie name | Cookie path | Purpose |
|-------|----------|-------------|-------------|---------|
| Access | 15 min | `access_token` | `/` | Sent on authenticated requests |
| Refresh | 7 days | `refresh_token` | `/api/v1/auth/refresh` | Refresh and browser logout |

### Why two tokens

- **Blast radius:** if an access token is stolen, the attacker has ≤15 minutes to abuse it before it expires.
- **UX:** the refresh token lets users stay logged in for 7 days without re-entering credentials.
- **Scoping:** the refresh cookie's narrow `Path` sends it to `/api/v1/auth/refresh` and its child `/api/v1/auth/refresh/logout`, rather than other API endpoints.

### Why cookies (not response body / localStorage)

- **XSS resistance:** `HttpOnly` cookies cannot be read by JavaScript.
- **Automatic transport:** the browser attaches cookies on every request; no manual header management.
- **CSRF mitigation:** `SameSite=Strict` blocks cookies on cross-site requests.

## Cookie Configuration

Both cookies use the same base options:

- `HttpOnly: true` — inaccessible to JavaScript
- `SameSite: 'strict'` — never sent on cross-site requests
- `Secure: <env>` — HTTPS-only (controlled by `COOKIE_SECURE`). Must be `true` in production: the backend refuses to start with `NODE_ENV=production` and `COOKIE_SECURE` unset or `false`. `false` is for local HTTP development and tests.
- `Domain: <env>` — scoped to configured host (controlled by `COOKIE_DOMAIN`)

## Refresh Token Rotation

Every use of the refresh token:

1. Verifies the JWT signature and expiry. A token that fails here is rejected ("Invalid refresh token") before the database is touched, so replaying a token whose JWT has expired never reaches reuse detection.
2. Opens a database transaction and **claims** the session with one conditional update, by SHA-256 hash of the token: `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now() RETURNING user_id`. Expiry here is checked by the database clock.
3. If no row was claimed, re-reads the row by hash in the same transaction and rejects, checking in this order:
   - no row → "Refresh token not recognized";
   - `revoked_at` set (whether or not it has also expired) → **reuse detected**: once the transaction has committed, revoke every unrevoked session of the JWT's user (`sub`), then reject;
   - otherwise the row is unrevoked, so it can only have failed the expiry condition → "Refresh token expired".
4. If the row was claimed: rejects if its `user_id` differs from the JWT's `sub` ("Refresh token not recognized") or the user is missing or inactive ("User no longer active"). These refusals commit, so the claimed token stays revoked. Otherwise issues new access + refresh tokens and inserts the replacement session row **in the same transaction**. The claim and the replacement commit together: if the insert fails, the transaction rolls back, the old token is left unrevoked, and a retry with it is not mistaken for reuse.

### Concurrent refreshes and logout

**On the server.** Concurrent claims of the same token wait on its row lock. The app doesn't set an isolation level, so PostgreSQL's default READ COMMITTED applies: when the lock is released, each waiting update re-checks its `WHERE` clause against the committed row. Exactly one request claims the token; the others find it revoked and are treated as reuse, which (under the strict policy above) also revokes the replacement the first request just committed. Logout's conditional update (`revoked_at IS NULL`) waits on the same row lock, so a refresh and a logout with the same token can't both take effect: if logout goes first, the refresh is treated as reuse; if the refresh goes first, the logout finds nothing to revoke.

**In the browser.** Tabs share one cookie jar, so two tabs can send the same refresh token. The frontend runs every refresh (the 401 interceptor in `frontend/src/services/api.js`) and every logout (`logoutAPI` in `frontend/src/services/authService.js`) under one lock, `withAuthLock`:

- Where the Web Locks API is available, the lock is `navigator.locks.request("socio-lk-pos-auth", …)`, exclusive across tabs of the same origin. A waiting tab sends its request only after the previous holder's response has been handled, so the browser attaches the cookie that response set. A tab that waited still makes its own refresh, rotating the token once more.
- Logout waits for any refresh in flight and then sends the newest refresh cookie, so a refresh response can't arrive after logout has cleared the cookies.
- Within one tab, concurrent 401s share a single refresh request.
- Browsers expose Web Locks only in secure contexts (HTTPS or `localhost`). Elsewhere, for example a plain-HTTP LAN address, `withAuthLock` falls back to a queue inside each tab. That keeps refresh and logout ordered within a tab but does **not** coordinate tabs: two tabs refreshing at once send the same token, and the server's reuse detection revokes all of that user's sessions.

**Limits.**

- Nothing links a token to its replacement. A logout carrying an already-rotated token revokes nothing on the server, and the replacement stays valid; only the browser lock prevents that ordering.
- A refresh request times out in the browser after 30 seconds, so a stalled one can't hold the lock and block logout indefinitely. The timeout only abandons the browser's request; it doesn't cancel the server's transaction, which may still commit the rotation. The failed refresh then logs the user out locally. If the browser never stored the new cookie, the replacement session row stays unrevoked until it expires.
- Revoking sessions doesn't invalidate access tokens already issued; they remain valid until they expire.

### Why rotation

Rotation reduces the useful lifetime of a compromised refresh token to a single request. If an attacker uses a stolen token before the legitimate user, the attacker gets new tokens — but as soon as the legitimate user tries to refresh, the (now revoked) old token triggers reuse detection and both parties are logged out. The legitimate user re-authenticates and is fine; the attacker is locked out.

### Why hash the token in the DB

Refresh tokens have high entropy (~200 bits), so brute-forcing them is impossible regardless of hash speed. We use fast **SHA-256** for the DB hash — different threat model from passwords (which use slow bcrypt). If the database is ever leaked, hashed refresh tokens are useless to an attacker.

### Why every JWT includes a `jti` claim

Every access and refresh JWT includes a `jti` (JWT ID) claim populated with a fresh `crypto.randomUUID()`. Without it, two tokens issued in the same second with identical other claims (same `sub`, same `iat`, same `exp`) would be byte-identical, producing identical SHA-256 hashes. Since `refresh_tokens.token_hash` is unique, the second insert would fail with a constraint violation.

This is not hypothetical — it surfaced during rapid-rotation e2e tests in Phase 5.11 and was fixed by adding `jti` to the payload before signing. The claim is not used for verification; its only job is to guarantee uniqueness.

### JWT payload contents

Every access token payload carries:

​```typescript
{ sub: string; role: UserRole; branch_id: string | null; jti: string; iat?: number; exp?: number }
​```

`branch_id` mirrors the user's row at issue time — `null` for admins, a UUID for managers/cashiers (Phase 6.2). It lets downstream checks (e.g. the branch-scoping pattern in [rbac.md](./rbac.md)) read the caller's branch without a DB round trip. As with `role`, this is convenience only: `JwtStrategy.validate()` still re-fetches the user from the DB on every request, so a branch transfer takes effect on the next request, not 15 minutes later.

## Session Metadata

Every session row in `refresh_tokens` records:

- `user_id` — foreign key to users
- `token_hash` — SHA-256 of the refresh JWT
- `expires_at` — UTC expiry
- `revoked_at` — nullable; set when the session ends
- `ip_address` — captured from `X-Forwarded-For` (first value) or `req.ip`
- `user_agent` — captured from request header, truncated to 500 chars
- `created_at` — login time

This metadata supports future features (session management UI, "log out other devices") and enriches audit logs.

## Timing-Safe Login

`validateUser()` always calls `bcrypt.compare()` — even when the user doesn't exist — against a dummy hash. This prevents timing-based user enumeration.

**Both success cases return a generic error message:** "Invalid email or password." Never distinguish "no such user" from "wrong password" in responses.

## Endpoint Reference

| Method | Path | Guard | Body | Success | Failure |
|--------|------|-------|------|---------|---------|
| POST | `/api/v1/auth/login` | none | `{email, password}` | 200 + user + cookies | 401 |
| POST | `/api/v1/auth/refresh` | none (validates cookie) | none | 200 + new cookies | 401 |
| POST | `/api/v1/auth/refresh/logout` | none | none | 200 + cleared cookies | 200 (idempotent) |
| POST | `/api/v1/auth/logout` | none | none | Compatibility alias; see below | 200 (idempotent) |
| GET | `/api/v1/auth/me` | JwtAuthGuard | none | 200 + user | 401 |

**Login and `/auth/me` return the same user shape.** Both respond with `{ id, email, full_name, role, branch_id, branch }`, where `branch_id` is `null` for admins and a UUID for managers/cashiers, and `branch` is the nested `Branch` object (or `null`). `login()` re-fetches the user with the branch relation loaded right after issuing tokens, specifically so its response matches `/auth/me` exactly rather than returning the pre-fetch, branch-less row.

## Logout and Browser Cookie Paths

Browser clients must call `POST /api/v1/auth/refresh/logout`. The existing refresh
cookie path matches this endpoint, including cookies issued before this endpoint
was added. No re-login or cookie-path migration is required.

The handler awaits revocation of the matching stored refresh-token hash before
clearing the access cookie at `/` and the refresh cookie at
`/api/v1/auth/refresh`. Clearing uses the original domain, HttpOnly, Secure, and
SameSite options. Logout is public and idempotent, including when the access
token has expired or the refresh cookie is missing, unknown, malformed, already
revoked, or expired. Logout does not mint tokens or revoke unrelated sessions.

`POST /api/v1/auth/logout` remains available for compatibility. A browser does
not send the narrow-path refresh cookie there: it clears cookies but cannot
revoke an absent token. A non-browser client that explicitly supplies the refresh
cookie can still use this alias for revocation. Tests must use a path-aware jar
for browser behavior rather than forcibly attaching every login cookie.

Logout does not invalidate copied access JWTs before expiration. How logout is
ordered against refreshes, in the browser and on the server, is described under
"Concurrent refreshes and logout". Revoking all user sessions upon revoked-token
replay is unchanged. The frontend also retains local logout on network failure;
that alone does not confirm server revocation.

## Programmatic Use

Inside NestJS controllers, use the `@CurrentUser()` decorator to extract the authenticated user:

​```typescript
@Get('protected')
@UseGuards(JwtAuthGuard)
handler(@CurrentUser() user: AuthenticatedUser) {
  return { message: `Hello, ${user.full_name}` };
}
​```

The `AuthenticatedUser` shape is `{ id, email, full_name, role, branch_id, branch }` — never includes `password_hash`. `branch_id` is `null` for admins; `branch` is the nested `Branch` object (or `null`) resolved via the entity relation on every request.

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `JWT_ACCESS_SECRET` | Signs access tokens | 64-char random hex |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime | `15m` |
| `JWT_REFRESH_SECRET` | Signs refresh tokens | 64-char random hex |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime | `7d` |
| `COOKIE_DOMAIN` | Cookie scope | `localhost` (dev), `api.socio.lk` (prod) |
| `COOKIE_SECURE` | HTTPS-only flag: exactly `true` or `false` (default `false`); any other value fails startup. Required `true` when `NODE_ENV=production` | `false` (dev, test), `true` (prod) |

## Future Work

- **Redis cache for user lookups** — currently every authenticated request does a DB lookup by user id. Fine for our scale; worth revisiting at high traffic.
- **Explicit CSRF tokens** — currently rely on `SameSite=Strict`. Add double-submit token pattern if requirements tighten.
- **Refresh token cleanup job** — periodic job to delete rows where `expires_at < NOW() - 30 days` (retain 30 days for audit value).
- **Multi-device session UI** — surface active sessions to users, allow selective revocation.
