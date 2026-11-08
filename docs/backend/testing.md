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
- Environment sourced from `.env.test`, which is required (see [Safety checks](#safety-checks)) — loaded before every test run by `test/load-test-env.ts` (referenced from `test/jest-e2e.json` `setupFiles`).
- **`BCRYPT_ROUNDS=4`** in `.env.test` — brings hash time from ~250ms to ~4ms, making e2e tests roughly 60x faster without weakening any production behavior.

### Safety checks

The e2e reset wipes every table, so each of these must hold first. A failure stops the run, and the error names what is required, never the value found.

1. **`.env.test` must load.** A missing or unreadable file stops the run, with no fallback to `.env`. `loadTestEnv` (`src/config/test-database-guard.ts`) does this from `test/load-test-env.ts`, a Jest `setupFiles` entry, so it runs before any spec or the app.
2. **The effective environment must be the local test database.** `DB_NAME` must be exactly `socio_lk_pos_test`, and `DB_HOST` exactly `localhost`, `127.0.0.1` or `::1`. "Effective" includes the shell: dotenv never overrides a variable that is already set, so a shell value is the one checked. `DB_PORT` isn't checked: any port can be a local Postgres or a tunnel, so a fixed list would reject valid setups without proving the server is local.
3. **The live connection must be the test database.** `truncateAllTables()` first runs `SELECT current_database()` on the connection it truncates with, and throws unless the answer is exactly `socio_lk_pos_test` (`test/e2e-database-guard.ts`). Every spec resets before its first write, so this one check covers them all.

`DB_NAME` and `DB_HOST` can't come from `.env`: the guard has already required both by the time `ConfigModule` reads that file. Any other key missing from `.env.test`, such as `DB_PORT`, `DB_USERNAME` or `DB_PASSWORD`, can still come from the shell or from `.env`. A local port tunnelled to another server passes the host check, and the connection check too if that server has a database of that name.

`npm run migration:run:test` follows the first two rules. With `NODE_ENV=test`, `src/database/data-source.ts` calls `loadTestEnv` as it loads, and the TypeORM CLI only connects after that. It doesn't read `.env`, so a key missing from `.env.test` and the shell fails validation. Commands without `NODE_ENV=test`, such as `migration:run`, are unchanged.

**Status:** these checks have unit tests that use no database. They have not yet run in a real e2e run or migration.

## E2E Setup Helper (`test/setup.ts`)

`createTestApp()` replicates the essentials of `main.ts`:
- Cookie parser (required for auth flow)
- Global `ValidationPipe` with `whitelist + forbidNonWhitelisted + transform`
- Global `/api/v1` prefix

**Skipped:** helmet (adds only headers), CORS (in-process supertest), Swagger (dev-only). These are noise in tests.

`truncateAllTables()` checks the connected database (see [Safety checks](#safety-checks)), then runs a single Postgres `TRUNCATE ... RESTART IDENTITY CASCADE` in a transaction, on every entity table, found from TypeORM metadata so new entities are covered automatically. The `migrations` table is not an entity, so migration state survives. The transaction sets `socio.allow_ledger_truncate` with `SET LOCAL`, because the append-only stock ledger tables refuse `TRUNCATE` otherwise. Called from `beforeEach` or `beforeAll` in every e2e suite.

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