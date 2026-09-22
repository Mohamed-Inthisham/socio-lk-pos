# Tracked Followups

Non-blocking issues and tech debt to address opportunistically. When you fix one, delete its entry. When you find one, add it under the appropriate section with a phase/slice tag.

---

## Bugs

- **Stock-lock-ordering latent deadlock.** `SalesService.completeSale` and `voidSale` iterate `sale_lines` by `line_number ASC` and lock Stock rows in that order via `StockService.decrementForSale`/`incrementForReversal`. Two concurrent completes on sales touching products `[P1, P2]` and `[P2, P1]` in different line orders can deadlock. Postgres detects it (kills one tx with `40P01`), so no permanent hang, but the loser gets a 500 with a cryptic message. Fix: collect all `(product_id, branch_id)` pairs across the loop, sort them, lock all before mutating. Same treatment for PU locks. Pre-existing since Phase 6.3; Slice E inherited the exposure. _[Phase 6.3, reinforced Slice E]_

- **`updated_at` not bumped on QueryBuilder `.update()`.** `StockService.decrementForSale`/`incrementForReversal` and `ProductUnitsService.markSoldForSale`/`markAvailableForReversal` use `manager.createQueryBuilder().update(Entity).set({...})`, which bypasses TypeORM's `@UpdateDateColumn` auto-bump. `updated_at` stays at the row's creation timestamp even after status/quantity changes. Cosmetic — no data-integrity impact — but breaks any "recently changed" ordering. Fix: add `updated_at: () => 'now()'` to each `.set()` clause, or install a Postgres trigger. _[Phase 6.3 Stock, Slice E PU]_

- **IMEI collision race between pre-check and INSERT (PhonePurchase).** `PhonePurchasesService.create` pre-checks for IMEI collision but the actual INSERT could still race a concurrent creation, surfacing as a raw Postgres `23505` → 500. Fix: catch `23505` in the insert and translate to a structured 409 matching the pre-check's payload shape. _[Slice D]_

- **`AuditLogInterceptor` pre-fetch runs before `ParseUUIDPipe`.** Malformed UUIDs on `PATCH`/`DELETE` routes surface as 500 (interceptor tries to fetch by malformed id) instead of 400 (pipe should reject first). Cosmetic. _[Phase 6.3]_

## Test-environment friction

- **Login throttle limit is not env-driven.** `/auth/login` throttle is production-appropriate but hostile to e2e tests running 100+ logins from the same IP. Current workaround is a 500ms sleep in `loginAndGetCookies` — raised from 110ms during Slice E when the sales spec hit 108+ tests. Every additional e2e test now costs 500ms of throttle-avoidance sleep. Fix: env var like `THROTTLE_LIMIT` that test config sets high, drop the sleep entirely. Would cut sales e2e run from ~90s to ~30s. _[Phase 5, worsened Slice E]_

- **`customers.e2e-spec.ts` `loginAndGetCookies` expects 201.** `/auth/login` returns 200 (`@HttpCode(HttpStatus.OK)`). Helper needs verification; if it's currently coincidentally passing due to earlier throttle 429s masking things, it'll bite later. _[Slice A]_

- **Audit log write teardown noise in e2e.** After test suite finishes, `AuditLogInterceptor.writeAuditLog` occasionally logs "Connection terminated" errors when the app's teardown closes the pool before an in-flight audit write completes. Non-blocking, but noisy in CI output. Louder now with Slice E adding more audited endpoints. _[Phase 6.3, worsened Slice E]_

- **`SaleNumberCounter` real-DB concurrency test is mocked.** No real-DB test exercises the counter under concurrent pressure. Add one if a race bug ever surfaces. _[Phase 6.3]_

## Refactors and cleanups

- **Rename `StockService.incrementForReversal` now that it has multiple callers.** Slice E is the second caller (void); may get a third with the RETURNED→IN_STOCK re-stock flow. "ForReversal" is narrower than what it does. Candidate: `increment(manager, productId, branchId, qty)` with a docstring covering the callers. _[Slice D]_

- **Promote `assertCustomerReference` to a shared method on `CustomersService`.** Currently duplicated logic; do it when a third caller lands. _[Slice D]_

- **Add `cashier.branch_id` to JWT payload.** Would save a DB round trip in `SalesService.create`, `PhonePurchasesService.create`, and future places that need "cashier's branch." _[Slice D]_

- **Migrate other unit specs from `clearAllMocks()` to `resetAllMocks()`.** `resetAllMocks()` correctly clears queued `mockResolvedValueOnce` chains; `clearAllMocks()` doesn't. This bit Slice D. Migrate other specs when they next need touching. _[Slice D]_

- **Consolidate duplicate seed helpers across e2e specs into `test/helpers.ts`.** Every spec has its own `seedBranch`, `seedUser`, etc. Accepted duplication for now; consolidate when it becomes painful. _[Slice A]_

- **Standardize query-param casing.** Codebase mixes `branchId` (camelCase) with `customer_id` (snake_case) across list endpoints. Pick one. _[Slice D]_

- **Response envelope camelCase but entities snake_case.** `PaginatedResponse` meta uses `totalPages`, `hasNext`; entities inside `data` use `product_unit_id`, `sale_number`. Live with it or normalize once. _[Slice A/B]_

- **`SalesService` growth.** Currently ~1200 lines after Slice E. Consider splitting into `SaleLinesService` + `SalePaymentsService` + orchestrator. Slice G (trade-ins) will push it further. _[Phase 6.3, worsened Slice E]_

## Deferred features

- **Buy-back flow.** Customer re-selling a phone we previously sold to them. New endpoint or extended intake path. Related to but distinct from the RETURNED flow. _[Slice D]_

- **Returned phone re-stock (RETURNED → IN_STOCK).** Customer physically returns a phone; separate from a full sale void. Needs its own endpoint and business rules. _[Slice D/E]_

- **Admin endpoint to update `ProductUnit.selling_price` post-intake.** The "price later" workflow (Cashier Option C from Slice D) requires this. Currently there's no way to set the per-unit price after intake if the cashier left it null. _[Slice D]_

- **`ProductType.USED_PHONE` enum value.** Add a specific type for used phones and gate PhonePurchase intake on it, so accidental intake of new-retail products fails cleanly. _[Slice D]_

- **Admin frontend for `Product.is_serialized` toggle.** No UI yet. Land with Phase 6.8 or the Product-admin UI. _[Slice D]_

- **Cross-branch Product cloning admin flow.** Currently a Product lives at exactly one branch. If a Product needs to exist at multiple branches, admin has to re-create manually. _[Slice D]_

- **Inverse `Customer.sales` relation.** Not declared — YAGNI. Add when `GET /customers/:id/sales` lands. _[Slice A/B]_

- **Strict SL NIC format validation.** Current DTO accepts 5–20 chars for foreigner/temporary ID compatibility. Tighten if/when we decide to reject non-SL formats. _[Slice A]_

- **"Create product from purchase" admin-only flow.** _[Slice A/B]_

- **Extend `ProductType` enum for real-business coverage.** DB CHECK exists; add enum values and migration. _[Phase 6.3]_

## Deferred infrastructure

- **Backend `stock_adjustments` audit table + frontend reason field + history view.** _[earlier phases]_
- **Real Toast primitive for success notifications.** _[earlier phases]_
- **Suppress expected 401s on session-restore check.** _[earlier phases]_
- **Multi-branch list scoping.** Deferred to R9. _[earlier phases]_
- **Backend pagination on `/brands` and `/categories`.** _[earlier phases]_
- **Concurrent billing.** Deferred to multi-cashier launch. _[earlier phases]_
- **Password change flow.** Phase 6.8 or earlier. _[earlier phases]_

## Frontend

- **Sweep 6 unused `eslint-disable` directives.** _[Path B]_
- **Login response DTO vs `/auth/me` response shape drift.** _[Path B]_