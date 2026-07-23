# Authentication

This document covers the authentication design, endpoint reference, and security decisions for SOCIO.LK POS. Authorization (role checks) is documented separately in [rbac.md](./rbac.md).

## Overview

Authentication uses **JWT with rotating refresh tokens**, transported via **httpOnly cookies**. Sessions are tracked server-side in the `refresh_tokens` table for revocation and audit purposes.

## Token Strategy

Two tokens per session:

| Token | Lifetime | Cookie name | Cookie path | Purpose |
|-------|----------|-------------|-------------|---------|
| Access | 15 min | `access_token` | `/api/v1/` | Sent on every authenticated request |
| Refresh | 7 days | `refresh_token` | `/api/v1/auth/refresh` | Used only to obtain new access tokens |

### Why two tokens

- **Blast radius:** if an access token is stolen, the attacker has ≤15 minutes to abuse it before it expires.
- **UX:** the refresh token lets users stay logged in for 7 days without re-entering credentials.
- **Scoping:** the refresh cookie's narrow `Path` means it's only sent on refresh requests — every other request only exposes the short-lived access token.

### Why cookies (not response body / localStorage)

- **XSS resistance:** `HttpOnly` cookies cannot be read by JavaScript.
- **Automatic transport:** the browser attaches cookies on every request; no manual header management.
- **CSRF mitigation:** `SameSite=Strict` blocks cookies on cross-site requests.

## Cookie Configuration

Both cookies use the same base options:

- `HttpOnly: true` — inaccessible to JavaScript
- `SameSite: 'strict'` — never sent on cross-site requests
- `Secure: <env>` — HTTPS-only in production (controlled by `COOKIE_SECURE`)
- `Domain: <env>` — scoped to configured host (controlled by `COOKIE_DOMAIN`)

## Refresh Token Rotation

Every use of the refresh token:

1. Verifies the JWT signature and expiry.
2. Looks up the session by SHA-256 hash of the token.
3. If the session was already revoked → **reuse detected**: revoke all sessions for that user and reject.
4. Otherwise: mark the old session revoked, issue new access + refresh tokens, create a new session row.

### Why rotation

Rotation reduces the useful lifetime of a compromised refresh token to a single request. If an attacker uses a stolen token before the legitimate user, the attacker gets new tokens — but as soon as the legitimate user tries to refresh, the (now revoked) old token triggers reuse detection and both parties are logged out. The legitimate user re-authenticates and is fine; the attacker is locked out.

### Why hash the token in the DB

Refresh tokens have high entropy (~200 bits), so brute-forcing them is impossible regardless of hash speed. We use fast **SHA-256** for the DB hash — different threat model from passwords (which use slow bcrypt). If the database is ever leaked, hashed refresh tokens are useless to an attacker.

### Why every JWT includes a `jti` claim

Every access and refresh JWT includes a `jti` (JWT ID) claim populated with a fresh `crypto.randomUUID()`. Without it, two tokens issued in the same second with identical other claims (same `sub`, same `iat`, same `exp`) would be byte-identical, producing identical SHA-256 hashes. Since `refresh_tokens.token_hash` is unique, the second insert would fail with a constraint violation.

This is not hypothetical — it surfaced during rapid-rotation e2e tests in Phase 5.11 and was fixed by adding `jti` to the payload before signing. The claim is not used for verification; its only job is to guarantee uniqueness.

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
| POST | `/api/v1/auth/logout` | none | none | 200 + cleared cookies | 200 (idempotent) |
| GET | `/api/v1/auth/me` | JwtAuthGuard | none | 200 + user | 401 |

## Programmatic Use

Inside NestJS controllers, use the `@CurrentUser()` decorator to extract the authenticated user:

​```typescript
@Get('protected')
@UseGuards(JwtAuthGuard)
handler(@CurrentUser() user: AuthenticatedUser) {
  return { message: `Hello, ${user.full_name}` };
}
​```

The `AuthenticatedUser` shape is `{ id, email, full_name, role }` — never includes `password_hash`.

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `JWT_ACCESS_SECRET` | Signs access tokens | 64-char random hex |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime | `15m` |
| `JWT_REFRESH_SECRET` | Signs refresh tokens | 64-char random hex |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime | `7d` |
| `COOKIE_DOMAIN` | Cookie scope | `localhost` (dev), `api.socio.lk` (prod) |
| `COOKIE_SECURE` | HTTPS-only flag | `false` (dev), `true` (prod) |

## Future Work

- **Redis cache for user lookups** — currently every authenticated request does a DB lookup by user id. Fine for our scale; worth revisiting at high traffic.
- **Explicit CSRF tokens** — currently rely on `SameSite=Strict`. Add double-submit token pattern if requirements tighten.
- **Refresh token cleanup job** — periodic job to delete rows where `expires_at < NOW() - 30 days` (retain 30 days for audit value).
- **Multi-device session UI** — surface active sessions to users, allow selective revocation.
