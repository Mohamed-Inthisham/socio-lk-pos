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
- `ip_address` — `req.ip`, so `X-Forwarded-For` counts only through trusted proxies (see "Client IP and trusted proxies" below)
- `user_agent` — captured from request header, truncated to 500 chars
- `created_at` — login time

This metadata supports future features (session management UI, "log out other devices") and enriches audit logs.

### Client IP and trusted proxies

`req.ip` is the one client IP the backend uses: the throttler keys on it, the audit log records it, and refresh-token sessions store it. Express derives it from the `trust proxy` setting, applied from `TRUST_PROXY` by `applyTrustProxy` (`backend/src/config/trust-proxy.ts`) in `main.ts` and in the e2e test app:

- **`false` (and unset, outside production):** no proxy is trusted. `req.ip` is the connected peer and a client-sent `X-Forwarded-For` is ignored.
- **A hop count, `1`–`5`:** trust that many hops by position, whatever their addresses. With a header that has at least that many entries, `req.ip` is the entry that many places from the right; anything a client wrote before it is ignored. **Safe only if the count matches the real proxy chain exactly and the backend can't be reached around the proxies.** If `X-Forwarded-For` has fewer entries than the hop count (the count is too high, or a request bypassed a proxy), Express walks off the left end and returns the left-most entry, which the client wrote: for example a count of `2` and a client sending `X-Forwarded-For: 6.6.6.6` straight to the backend gives `req.ip` = `6.6.6.6`.
- **An allowlist (preferred):** comma-separated IPs, CIDR ranges and Express's named ranges. `req.ip` is the right-most address in the chain that isn't on the list. CIDR prefixes must be at least `/8` for IPv4 and `/32` for IPv6, so broad ranges can't add up to every address (as `0.0.0.0/1,128.0.0.0/1` would); that still fits any VPC subnet or provider range. The named ranges are exempt from the minimum:
  - `loopback`: `127.0.0.0/8`, `::1/128`
  - `linklocal`: `169.254.0.0/16`, `fe80::/10`
  - `uniquelocal`: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`. This trusts every private address, so it is only safe if no untrusted client can reach the backend from a private address (for example another workload in the same VPC, a VPN, or the shop LAN in an on-premises setup). Prefer the proxies' own subnets.

`true` (trust everything), `0`, hop counts above 5, prefixes shorter than the minimum (including `/0`), netmask notation and malformed entries fail startup.

**Production must set `TRUST_PROXY` explicitly.** With `NODE_ENV=production` the backend refuses to start if it is unset; set `false` if clients reach the backend directly, otherwise the proxies' addresses (or the exact hop count). With `false` behind a load balancer or CDN, every client appears as the proxy's address and shares one throttle allowance. The production proxy chain isn't decided yet, so no value is prescribed here.

## Login rate limit

`POST /api/v1/auth/login` has its own limit per client IP, on top of the global `short` (10 a second) and `long` (100 a minute) limits every route has. All three are set up in `backend/src/config/throttle.ts`; the `login` throttler applies only to the handler marked `@LoginThrottle()`.

- **Limit:** `LOGIN_THROTTLE_LIMIT` requests per `LOGIN_THROTTLE_TTL_SECONDS` (defaults 20 per 900 s, the production values). A blocked IP waits out the same window.
- **What counts:** every request that reaches the route — successful logins, wrong passwords and malformed bodies (guards run before validation and the password check). Refused requests never reach bcrypt.
- **Key:** the route plus the trusted `req.ip` (see "Client IP and trusted proxies"). Other routes, including refresh and logout, are unaffected.
- **Response:** `429` with `{ statusCode: 429, message: "Too many login attempts. Please wait a few minutes and try again." }` and a `Retry-After-login` header (seconds). Other routes keep the throttler's default 429 message. The frontend shows its own copy of that message for any 429 from login.

Limits of this protection:

- Counts are kept **in memory in each backend process**. With several instances behind a load balancer each keeps its own count, so the effective limit is the setting times the number of instances; a restart clears them.
- It depends on a correct production `TRUST_PROXY`. With `false` behind a load balancer every client is the proxy's address, so all logins share one allowance and one client can block everyone's logins.
- It is per IP, not per account: guessing spread across many addresses isn't slowed, and tills behind one shop IP share the allowance. Per-account protection is a separate follow-up.

e2e runs raise `LOGIN_THROTTLE_LIMIT` in `backend/test/load-test-env.ts` (only if it isn't already set), because the specs log in far more often than the production limit allows; `test/login-throttle.e2e-spec.ts` sets a low limit to test the wiring.

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
| `TRUST_PROXY` | Proxies whose `X-Forwarded-For` sets `req.ip`: `false` (none), a hop count `1`–`5`, or an allowlist of IPs, CIDRs (at least `/8` IPv4, `/32` IPv6) and named ranges. Unset means `false`, except that production refuses to start without it. `true` fails startup. See "Client IP and trusted proxies" | unset or `false` (dev, test); production: explicit, depends on the proxy chain |
| `LOGIN_THROTTLE_LIMIT` | `POST /auth/login` requests per client IP per window: whole number 1–1000 (default 20). See "Login rate limit" | unset (prod: 20); e2e: 1000 via `test/load-test-env.ts` |
| `LOGIN_THROTTLE_TTL_SECONDS` | Login window and block length in seconds: whole number 1–86400 (default 900) | unset (900) |

## Future Work

- **Redis cache for user lookups** — currently every authenticated request does a DB lookup by user id. Fine for our scale; worth revisiting at high traffic.
- **Explicit CSRF tokens** — currently rely on `SameSite=Strict`. Add double-submit token pattern if requirements tighten.
- **Refresh token cleanup job** — periodic job to delete rows where `expires_at < NOW() - 30 days` (retain 30 days for audit value).
- **Multi-device session UI** — surface active sessions to users, allow selective revocation.
