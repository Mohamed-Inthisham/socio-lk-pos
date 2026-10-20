# Tracked Followups

Non-blocking issues and tech debt to address opportunistically. When you fix one, delete its entry. When you find one, add it under the appropriate section with a phase/slice tag.

---

## Bugs

- **Stock-lock-ordering latent deadlock.** `SalesService.completeSale` and `voidSale` iterate `sale_lines` by `line_number ASC` and lock Stock rows in that order via `StockService.decrementForSale`/`incrementForReversal`. Two concurrent completes on sales touching products `[P1, P2]` and `[P2, P1]` in different line orders can deadlock. Postgres detects it (kills one tx with `40P01`), so no permanent hang, but the loser gets a 500 with a cryptic message. Fix: collect all `(product_id, branch_id)` pairs across the loop, sort them, lock all before mutating. Same treatment for PU locks. Pre-existing since Phase 6.3; Slice E inherited the exposure. **Priority: high (bumped in Slice G).** Slice G widens the surface with a cross-method Stock/PU inversion: `voidSale`'s trade-in loop locks the PU first (`markReturnedForVoid`) and Stock second (`decrementForVoidedTradeIn`, which needs the PU's `product_id`), while the outgoing loops in both `completeSale` and `voidSale` lock Stock first and PU second. A void of a trade-in sale racing a `completeSale` that sells that same traded-in phone takes the two locks in opposite order. Per the Q8 design lock, not fixed in Slice G — a per-method reorder just moves the asymmetry; the fix has to sort all Stock and PU lock targets globally across `SalesService` (and `PhonePurchasesService.createForTradeIn`) before mutating. _[Phase 6.3, reinforced Slice E, widened Slice G]_

- **API rate limit is per IP, so tills on one shop network share it.** **Priority: medium. Blocks R1 at 3+ concurrent tills.** `ThrottlerModule` in `app.module.ts` applies 10 req/s and 100 req/min to every route, keyed by client IP. All tills behind one shop router share a single public IP and therefore one bucket. A busy scan costs about 3 requests (by-barcode, addLine, stock), so 3 tills scanning steadily reach 100/min and start getting 429s on scans and line edits. Found in Phase 6.4 P1 E: one cashier's terminal hit the limit while reloading the page repeatedly. Fix: key authenticated routes by user instead of IP, by subclassing `ThrottlerGuard` and overriding `getTracker()` to return the user id. `JwtStrategy.validate` maps the token's `sub` to `req.user.id`. and fall back to the IP for anonymous routes. Keep the strict per-IP limit on `/auth/login`. Sketch:

  ```ts
  @Injectable()
  export class UserThrottlerGuard extends ThrottlerGuard {
    protected async getTracker(req: Record<string, any>): Promise<string> {
      return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
    }
  }
  // app.module.ts: { provide: APP_GUARD, useClass: UserThrottlerGuard }
  // req.user exists only if JwtAuthGuard (APP_GUARD in AuthModule) runs before
  // this guard (APP_GUARD in AppModule). Verify the order, or move both into one
  // module in the right order, before relying on it.
  ```
  _[Phase 6.4 P1]_

- **`updated_at` not bumped on QueryBuilder `.update()`.** `StockService.decrementForSale`/`incrementForReversal` and `ProductUnitsService.markSoldForSale`/`markAvailableForReversal` use `manager.createQueryBuilder().update(Entity).set({...})`, which bypasses TypeORM's `@UpdateDateColumn` auto-bump. `updated_at` stays at the row's creation timestamp even after status/quantity changes. Cosmetic — no data-integrity impact — but breaks any "recently changed" ordering. Fix: add `updated_at: () => 'now()'` to each `.set()` clause, or install a Postgres trigger. _[Phase 6.3 Stock, Slice E PU]_

- **Customer can be cleared from a DRAFT that has TRADE_IN payments.** `addPayment` requires `sale.customer_id` for TRADE_IN, but `PATCH /sales/:id` with `customer_id: null` still succeeds afterwards. `completeSale` catches it with a 400 before calling `createForTradeIn` (PhonePurchase needs a customer), so there is no data risk — but the error surfaces late. Fix: in `SalesService.update`, reject clearing `customer_id` when the sale has any TRADE_IN payment. _[Slice G]_ **Resolved** — shipped in #22 (also covers customer reassignment).

- **PERCENT discounts don't always round half-up.** `SalesService.resolveDiscountAmount` (`backend/src/sales/sales.service.ts:1548`) computes `roundToCents((lineSubtotal * value) / 100)` in floats. The `+ Number.EPSILON` nudge in `roundToCents` (`:1486`) only rescues values below ~1, so exact half-cent results often round down: 50% of 4.35 should be 2.18 (half-up) but stores 2.17. No DB constraint is violated and the error is ≤1 cent in the customer's favour. Fix: compute in integer cents (`toCents(unitPrice) * quantity * pct`, half-up on the exact value). That changes stored `discount_amount` for some existing inputs, so this behaviour change needs its own review. Found in the sales money audit alongside the payment-remainder fix. _[Phase 6.3 Slice D]_

- **`AuditLogInterceptor` pre-fetch runs before `ParseUUIDPipe`.** Malformed UUIDs on `PATCH`/`DELETE` routes surface as 500 (interceptor tries to fetch by malformed id) instead of 400 (pipe should reject first). Cosmetic. _[Phase 6.3]_

- **Schema drift between entities and migrations.** `migration:generate --dryrun` on develop prints about 80 lines of drift: hand-named FKs, CHKs and indexes in the migrations that the entities don't declare (or declare with TypeORM's generated names), across most tables. Nothing is wrong at runtime (`synchronize` is off), but a generated migration would drop and recreate constraints. Align the entities, or document the drift, before anyone generates migrations. The buy-back PR removed the `product_units.imei` part. _[buy-back PR]_

## Test-environment friction

- **Login throttle limit is not env-driven.** `/auth/login` throttle is production-appropriate but hostile to e2e tests running 100+ logins from the same IP. Current workaround is a 500ms sleep in `loginAndGetCookies` — raised from 110ms during Slice E when the sales spec hit 108+ tests. Every additional e2e test now costs 500ms of throttle-avoidance sleep. Fix: env var like `THROTTLE_LIMIT` that test config sets high, drop the sleep entirely. Would cut sales e2e run from ~90s to ~30s. _[Phase 5, worsened Slice E]_

- **`customers.e2e-spec.ts` `loginAndGetCookies` expects 201.** `/auth/login` returns 200 (`@HttpCode(HttpStatus.OK)`). Helper needs verification; if it's currently coincidentally passing due to earlier throttle 429s masking things, it'll bite later. _[Slice A]_

- **Audit log write teardown noise in e2e.** After test suite finishes, `AuditLogInterceptor.writeAuditLog` occasionally logs "Connection terminated" errors when the app's teardown closes the pool before an in-flight audit write completes. Non-blocking, but noisy in CI output. Louder now with Slice E adding more audited endpoints. _[Phase 6.3, worsened Slice E]_

- **Intermittent `deadlock detected` in `products.e2e-spec.ts`.** Seen once in a full `npm run test:e2e` run during Slice G: `POST /products › auto-generates SKU and barcode` failed with `40P01` on the `products` INSERT, alongside an `AuditLogInterceptor.writeAuditLog` error. Passes on rerun, and the suite passes in isolation. Likely the same fire-and-forget audit write racing `truncateAllTables`; the 50ms pre-truncate sleep in `test/setup.ts` isn't always enough. Fix: have the interceptor track in-flight writes and await them in teardown/truncate, rather than sleeping. _[Slice G]_

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

- **Customer-return re-stock.** Customer physically returns a phone; separate from a full sale void. Needs its own endpoint and business rules. **Must use a new ProductUnit status (e.g. `RETURN_PENDING`), not RETURNED**, and add it to the WHERE clause of `uq_product_units_imei_live` (migration + entity `@Index` + `LIVE_UNIT_STATUSES` in `product-units/live-imei.ts`): the shop holds the phone, so it is live. RETURNED means "trade-in reversed; the phone is back with the customer" and stays out of the index so a voided trade-in can be re-rung. _[Slice D/E, revised buy-back PR]_

- **Admin endpoint to update `ProductUnit.selling_price` post-intake.** The "price later" workflow (Cashier Option C from Slice D) requires this. Currently there's no way to set the per-unit price after intake if the cashier left it null. _[Slice D]_

- **`ProductType.USED_PHONE` enum value.** Add a specific type for used phones and gate PhonePurchase intake on it, so accidental intake of new-retail products fails cleanly. _[Slice D]_

- **No supplier stock intake with IMEIs (new serialized phones can't be sold in-house).** **Priority: high — its own phase after 6.4 P5.** ProductUnit rows are created only by `POST /phone-purchases` (buying from a customer, `phone-purchases.service.ts` `create`) and by trade-ins at `completeSale` (`createForTradeIn`). `PATCH /stock/:id` changes the quantity only and creates no units, and a serialized in-house sale line needs an existing IN_STOCK unit for its IMEI (`resolveInHouseSerializedLine` → 400 "IMEI '…' is not in stock"). So a new phone from a supplier can't be rung up as a serialized line; today's workarounds (mark it non-serialized and lose the IMEI, a fake "supplier" customer on `POST /phone-purchases`, or the external-supplier line mode) are all wrong. Needs a supplier-receiving endpoint that creates N IN_STOCK units with IMEIs and cost, increments stock, and links the supplier, plus its screen. _[Phase 6.4 P4 recon]_

- **No IMEI inventory screen.** `GET /product-units` (admin/manager) has no frontend: nobody can search an IMEI, see a phone's history (one row per acquisition) or list the units in stock without Swagger. Ships with the supplier-intake phase above. _[Phase 6.4 P4 recon]_

- **No phone-purchase screen.** Buying a phone outright (`POST /phone-purchases`) has no frontend; it was deliberately left out of 6.4 (planning doc §10). Ships with the supplier-intake phase above. The backend already requires the seller's NIC (#29). _[Phase 6.4 P4 recon, §10]_

- **Cross-branch Product cloning admin flow.** Currently a Product lives at exactly one branch. If a Product needs to exist at multiple branches, admin has to re-create manually. _[Slice D]_

- **Inverse `Customer.sales` relation.** Not declared — YAGNI. Add when `GET /customers/:id/sales` lands. _[Slice A/B]_

- **Strict SL NIC format validation.** Current DTO accepts 5–20 chars for foreigner/temporary ID compatibility. Tighten if/when we decide to reject non-SL formats. _[Slice A]_

- **"Create product from purchase" admin-only flow.** _[Slice A/B]_

- **Extend `ProductType` enum for real-business coverage.** DB CHECK exists; add enum values and migration. _[Phase 6.3]_

- **No password-change endpoint.** `UpdateUserDto` omits `password`, and there is no self-service change-password or admin reset route, so a user's password can only be changed directly in the DB. When it lands: verify the current password via a lookup that opts `password_hash` in (it is `select: false` on `User`, see `UsersService.findByEmail`), re-hash with `BCRYPT_ROUNDS`, and revoke the user's refresh tokens. _[password-hash exclusion fix]_

## Go-live setup

- **Create the common used-phone catalogue models before go-live.** A trade-in or phone purchase needs an existing, active, serialized product at the branch, one per model/storage (e.g. "Used iPhone 12 128GB"), and only admins can create products. If the customer's model is missing, the cashier is stuck (the POS shows "No used-phone product for this model. Ask an admin to add one."). Seed the models the shop commonly takes in (`is_serialized = true`, `phone_condition = USED`) at each branch, labelled the way the cashier will search for them ("Used iPhone 12 128GB"). Also create one fallback per main brand, **"Used phone – <brand> (other)"** (e.g. "Used phone – Samsung (other)"), so a trade-in of an uncommon model can still be recorded; an admin can add the proper model later. The customer also needs an NIC on file for a trade-in or phone purchase (P4-13, #29). _[Phase 6.4 P4 planning, revised P4 build]_

- **Fill in each branch's address and phone before go-live.** The printed receipt (Phase 6.4 P5) takes its header from the sale's branch: name, address and phone. `address` and `phone` are nullable, and the receipt skips a null one, so a receipt from a branch without them has no address or phone. There is no branch admin screen in the frontend; set them with `PATCH /branches/:id` (admin) via Swagger or a seed. The shop name and footer text live in `frontend/src/constants/receipt.js` (P5-14). _[Phase 6.4 P5 planning]_

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
- **`ProductsList` loads only the first 200 products.** `GET /products` is now paginated (`limit` ≤ 200). The admin list requests one max-size page and still filters in memory (name/SKU/barcode); the header says "first N of M products" when the catalog is bigger. Fix: add a pager (or "Load more") and switch the text box to the server-side `search` param. Server `search` matches name only, so SKU/barcode matching would need extending it. _[products text search]_
- **Staff may keep a stale `activeBranchId` from before the `mapBackendUser` fix.** `BranchSelector` only defaults the persisted `activeBranchStore` when it is null. Before the fix, `user.branch_id` was always undefined, so staff were defaulted to `activeBranches[0]` instead of their own branch, and that value survives refreshes. A single logout clears it (`logoutUser` calls `activeBranchStore.clear()`), so after deploy it self-heals on each staff member's next logout. Nothing reads `activeBranchId` for staff today, and the POS `BranchContextGuard` reads `user.branch_id` directly, so there is no functional impact while the shop has one branch. Fix if it ever matters: have `BranchSelector` overwrite the store for staff whenever it differs from `user.branch_id`. **Low severity.** _[Phase 6.4 P0]_
- **Admin can switch branch from the global header while a POS DRAFT is open.** The terminal header shows the branch read-only, but an admin can exit to any app page, change the header `BranchSelector`, and return. The DRAFT still belongs to the old branch; the server rejects the mismatch, but the UX is confusing. Fix (P1 or later, once drafts exist in the terminal): while the terminal holds a DRAFT, warn on or disable the global header `BranchSelector` until the sale is completed or discarded. Not P0 scope. **Confirmed reproducible as of the P1 D commit:** `ensureDraftSale` resumes a stored draft only when its `branch_id` matches the terminal branch. After a switch it opens a new DRAFT on the new branch and moves the pointer, and the old DRAFT stays on the server as an orphan, with its lines. Repro: admin opens `/pos` on Main Shop (draft X), switches the header branch to another branch, reopens `/pos` (draft Y); `GET /sales/X` still returns `DRAFT` and nothing references it. Not fixed in P1. _[Phase 6.4 P0, confirmed P1]_
- **POS line discounts have no UI yet (moved to P2).** The Totals panel shows the server's `discount_total`, which is always 0 in P1 because nothing on the terminal sets a line discount. Still to do: a per-line discount control (`PATCH /sales/:id/lines/:lineId` with `{ discount_type: AMOUNT|PERCENT, discount_value }`, and both set to `null` to clear it), the `D` hotkey on the focused cart row (§6), a discount column or badge on `CartLines`, and `APPLY_DISCOUNT` granted to the cashier role (Q11: all roles may discount). The backend already computes `discount_amount` and caps it at the line subtotal, so this is frontend-only. _[Phase 6.4 P1 → P2]_
- **No global axios timeout.** The shared instance in `frontend/src/services/api.js` sets no `timeout`, so a request that hangs (a stalled connection, a server stuck on a lock) leaves its spinner up forever. P5 gives `POST /sales/:id/complete` its own 30 s timeout followed by a re-fetch (planning doc P5-7); every other call still has none. Fix: a default `timeout` on the instance (e.g. 20 s), with the mutation paths re-fetching the sale on timeout as §5 already prescribes for network errors. _[Phase 6.4 P5 recon]_
- **POS stock lookup has no retry.** A failed `GET /stock` (network, 429) leaves the line with a muted "?" ("stock lookup failed, try reloading") until the next add/qty change or a reload; add one delayed retry per the §5 GET retry rule. _[Phase 6.4 P1]_
- **ScanBar: alphanumeric manufacturer barcodes are treated as a name search.** `ScanBar` sends a value to `GET /products/by-barcode` only when it is barcode-shaped (`isBarcodeLike`: 8–20 digits, or an `SLP-` prefix). A manufacturer Code 128 barcode with letters (e.g. `A2849LL/A`) goes to the debounced name search instead, finds nothing, and Enter does nothing. Fix: when Enter is pressed in text mode and the current query has no results, try an exact by-barcode lookup before giving up. Only a 404 means "not found"; the name search stays as it is. About a 10-minute change in `components/pos/ScanBar/index.jsx` plus one test (letters-and-digits value, empty search → by-barcode called → line added). _[Phase 6.4 P1]_

  ```js
  // ScanBar handleKeyDown, Enter branch
  if (isBarcodeLike(query)) {
    submitBarcode(query);
  } else if (resultsCurrent && results[active]) {
    addProduct(results[active]);
  } else if (resultsCurrent && results.length === 0) {
    // Name search came back empty: maybe it's a barcode with letters.
    submitBarcode(query); // by-barcode → addProduct, or "No product found"
  } else if (textMode) {
    // Search still in flight: run it now; on an empty result,
    // fall through to submitBarcode(query) the same way.
    clearTimeout(debounceRef.current);
    dispatch(searchProducts({ query, branchId })).then((action) => {
      if (searchProducts.fulfilled.match(action) && action.payload.length === 0) {
        submitBarcode(query);
      }
    });
  }
  ```
