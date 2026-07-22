# Testing

## Overview

The backend has two layers of tests:

- **Unit tests** (`src/**/*.spec.ts`) — pure logic, mocked collaborators. Fast (< 3s), run in parallel.
- **E2E tests** (`test/**/*.e2e-spec.ts`) — real HTTP + real Postgres. Slower (~5s), run serially.

Total coverage: 47 tests across `diffObjects`, `AuthService`, and end-to-end auth + RBAC flows.

## Scope decisions (5.11)

Tests were scoped to high-risk logic, not blanket coverage:

- **Unit tests focus on `AuthService`** (timing-safe login, refresh rotation, reuse detection) and the `diffObjects` audit utility. These are the trickiest, most security-relevant units.
- **E2E tests cover the whole auth pipeline** — login, /me, refresh, logout — plus RBAC status-code discipline (401 vs 403) and the audit interceptor's end-to-end behavior.
- **Explicitly deferred:** exhaustive DTO validation tests (class-validator is already well-tested by its authors), controller-level unit tests (would duplicate the e2e coverage), and coverage-percentage targets (hitting a number is not the same as testing what matters).

## Test Database

- **DB name:** `socio_lk_pos_test`
- **Same Postgres instance** as dev; only the database name differs.
- Environment sourced from `.env.test` — loaded before every test run by `test/load-test-env.ts` (referenced from `test/jest-e2e.json` `setupFiles`).
- **`BCRYPT_ROUNDS=4`** in `.env.test` — brings hash time from ~250ms to ~4ms, making e2e tests roughly 60x faster without weakening any production behavior.

## E2E Setup Helper (`test/setup.ts`)

`createTestApp()` replicates the essentials of `main.ts`:
- Cookie parser (required for auth flow)
- Global `ValidationPipe` with `whitelist + forbidNonWhitelisted + transform`
- Global `/api/v1` prefix

**Skipped:** helmet (adds only headers), CORS (in-process supertest), Swagger (dev-only). These are noise in tests.

`truncateAllTables()` runs a single Postgres `TRUNCATE ... RESTART IDENTITY CASCADE` against `audit_logs`, `refresh_tokens`, `users`. Called from `beforeEach` in every e2e suite.

## Serial e2e execution

`test/jest-e2e.json` sets `"maxWorkers": 1` so e2e test files run one at a time. Rationale: all suites share a single `socio_lk_pos_test` DB; parallel execution causes one suite's `TRUNCATE` to race with another's writes, producing sporadic FK constraint failures. Per-worker databases would allow parallelism but add complexity not worth it at current project size.

## Running Tests

```bash
# Unit tests (fast, parallel, no DB required)
npm test

# Watch mode for TDD
npm run test:watch

# E2E tests (real DB, serial)
npm run test:e2e
```

## Bugs Caught by Tests (5.11)

Worth logging because these were **live bugs in previously-manually-verified code**:

1. **JWT `jti` collision on fast rotation** — `generateTokens` produced identical JWTs when called twice within the same second (same payload, same secret, same `iat`). Manual testing never triggered this because human-speed login-to-refresh cycles span multiple seconds. E2e login → refresh runs in milliseconds and surfaced the FK-unique-constraint failure on `token_hash`. Fix: added `crypto.randomUUID()` as a `jti` claim in the JWT payload.

2. **Parallel e2e DB races** — Jest ran e2e suites in parallel against a shared DB by default. Adding a second e2e file (`rbac.e2e-spec.ts`) triggered sporadic FK violations as suites truncated tables mid-flight in other suites. Fix: `maxWorkers: 1` in the e2e Jest config.

## Adding a New E2E Test Suite

1. Create `test/<feature>.e2e-spec.ts`.
2. Use `createTestApp()` in `beforeAll`, `truncateAllTables()` in `beforeEach`, `app.close()` in `afterAll`.
3. Seed data directly via `dataSource.getRepository(Entity)` (avoids coupling to service-level behavior you may also be testing).
4. If the test needs cookies, log in via the auth endpoint and use `res.headers['set-cookie']` on subsequent requests (never fake the JWT — that would bypass the JwtStrategy, giving false confidence).

## Adding a New Unit Test

1. Create `<file>.spec.ts` alongside the file under test (co-located, Nest convention).
2. Mock only external collaborators; test real logic. Use `getRepositoryToken(Entity)` for TypeORM repositories.
3. `jest.clearAllMocks()` in `beforeEach` to prevent state bleed between tests.