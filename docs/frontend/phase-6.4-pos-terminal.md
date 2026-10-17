# Phase 6.4 — POS Terminal (Frontend) — Planning

**Status:** P0 (#18), P1 (#20), P2 (#21) and P3 (#26) shipped. The backend buy-back change P4 depends on shipped in #27. P4 (TRADE_IN payment) is planned and not started. Decisions that changed while building are recorded in the §8 "P1 decision log", "P3 decision log" and "P4 decision log", and the sections they touch are marked "revised P1", "revised P3" or "revised P4".

**Target setup:** a laptop (1366×768 reference) with a USB/HID barcode scanner as the till. Tablet and phone layouts are supported as secondary.

**Backend contract:** [docs/backend/sales.md](../backend/sales.md), [docs/backend/used-phones.md](../backend/used-phones.md), Swagger at `/api/docs` (dev). All endpoints below are under `/api/v1` and use the httpOnly-cookie session.

**Grounding notes (facts found while researching, not decisions):**

- Line and payment `POST`/`PATCH`, `PATCH /sales/:id`, `complete`, and `void` **return the full hydrated sale** (branch, cashier, customer, lines, payments, totals). Line/payment `DELETE` and `DELETE /sales/:id` return **204** — re-fetch with `GET /sales/:id`. `POST /sales` returns the **bare new row** (it has no lines or payments yet anyway).
- The hydrated sale includes **`customer`** (null when none; still present, with `deleted_at` set, if the customer was soft-deleted) once the Q13 backend PR (`feature/sales-customer-relation`) is merged. Before that PR, only `customer_id` came back.
- Money fields are numeric **strings** (`"60000.00"`); request bodies take **numbers**.
- `GET /products` is **paginated** (`{ data, meta }`, `limit` ≤ 200) with a server-side `search` param (case-insensitive name substring, 2–100 chars) — added after planning (`feature/products-text-search`); it was a plain array with no search when this doc was written. `GET /products/by-barcode/:barcode` is the scan lookup. `GET /sales` is **paginated** (`{ data, meta }`, filters `branchId`, `cashierId`, `status`, `from`, `to`, `page`, `limit≤200`).
- `GET /product-units?imei=` is **admin/manager only** — a cashier cannot resolve an IMEI to a product today.
- `addLine` does **not** check stock. Insufficient stock surfaces only at `POST /sales/:id/complete` (409).
- A payment's `amount` can never exceed the remaining balance (CASH included: the excess goes in `cash_received`), so a sale can't be overpaid. A line change that would drop `total` below `amount_paid` returns **400** "Cannot reduce the sale total below the amount already paid. Remove or reduce payments first." (#24; it was a raw 500 before). The sale returns `total`, `amount_paid` and `change_due`, but no balance field.
- `POST /sales` requires `branch_id`. Staff users have one; **admins have `branch_id = null`**.
- The frontend's `mapBackendUser` (`frontend/src/services/authService.js`) currently **drops `branch_id` and `branch`** from `/auth/me` and `/auth/login`. Must be fixed before the terminal can create sales.
- The frontend has **no test runner** (no Vitest/Jest/RTL in `package.json`, no test files). `docs/architecture.md` names Vitest + React Testing Library + Playwright as the intended stack.
- There is **no toast component**. Errors render as inline red boxes. "Real Toast primitive" is listed under Deferred infrastructure in `FOLLOWUPS.md`.

---

## 1. Scope

Minimum-viable R1 cashier flow. "R1" = ships in Phase 6.4. "R1.1" = deferred to the next increment.

**Every screen below must work at phone, tablet and desktop widths with a modern look (Q6).** Desktop with keyboard + scanner is the reference layout; on touch devices every keyboard action has a visible control (§6, "Touch and small screens").

| # | Screen / interaction | Purpose | Description | Release |
|---|---------------------|---------|-------------|:-------:|
| 1 | **Login** | Authenticate | Reuse `LoginPage` as-is. After login, cashiers land on `/pos` instead of `/dashboard` (role-based redirect). | R1 |
| 2 | **Terminal shell** | Frame for the whole flow | Full-height layout: scan bar on top, cart on the left with the payments list directly below it _(revised P3, see §8 P3-4)_, sale / customer / totals panel on the right, status strip (branch, cashier, network) at the bottom. Hosts the global hotkey handler and the draft-sale lifecycle (create on first item, resume on reload). | R1 |
| 3 | **Product search / scan input** | Get items into the cart | A single always-focused input. Enter on a value runs an exact barcode lookup first, then falls back to a name/SKU search over the branch catalog with a keyboard-navigable result list. Phones carry both a product label and an IMEI (Q9): if a lookup misses and the value is IMEI-shaped (15 digits), the bar says "That looks like an IMEI — scan the product label first". | R1 |
| 4 | **Serialized item IMEI prompt** | Sell a specific phone | When the chosen product has `is_serialized = true`, a small dialog asks for the IMEI (scan the phone's IMEI label, or type) before calling `addLine` with `quantity: 1`. Handles 400 (IMEI not found / wrong product) and 409 (unit not IN_STOCK, with `existing_unit`). | R1 |
| 5 | **Cart view** | Show and edit lines | Rows show name, IMEI (if any), qty, unit price, discount, line total. Qty edit (non-serialized only) and line remove; every edit replaces the cart from the server response. | R1 |
| 6 | **Line discount** | Price adjustment | Per-line `{ type: AMOUNT|PERCENT, value }` via `PATCH .../lines/:lineId`. All roles may discount for now (Q11): `APPLY_DISCOUNT` is added to the cashier role. | R1 |
| 7 | **Customer attach** | Link the sale to a customer | Search `GET /customers?search=` by name/phone/NIC; pick one, or create inline (`POST /customers` with name, phone, optional NIC), then `PATCH /sales/:id { customer_id }`. Detach sets `null`. Detach, Change and F3 are blocked while a TRADE_IN payment (recorded or pending) exists _(revised P4, see §8 P4-11)_. | R1 |
| 8 | **Payment entry — CASH** | Take cash | Amount defaults to remaining balance; cashier types cash received; change is shown live. Sends `{ payment_method: CASH, amount, cash_received }`. | R1 |
| 9 | **Payment entry — CARD / BANK_TRANSFER / KOKO / MINTPAY** | Take reference-based tenders | Same dialog, method switch hides cash-received and shows a required reference number (auth code / slip ref / provider txn id). | R1 |
| 10 | **Payment entry — TRADE_IN** _(revised P4, see §8 P4 decision log)_ | Accept a used phone as part payment | Method 6 in the `PaymentDialog` (F6 opens it pre-selected). Requires a customer on the sale: without one, the dialog offers **Attach customer** and comes back to TRADE_IN afterwards. Collects the trade-in product (serialized products at the branch, used SKUs first), IMEI, one **Trade-in value** field (sent as both `amount` and `trade_in_buying_price`, empty by default, capped at the balance due), an optional resale price and condition notes. The customer pays the difference; there is no payout or store credit. A phone the shop sold earlier can be traded back in (buy-back, #27). 409 when the IMEI is a phone the shop holds (`IN_STOCK` / `WRITTEN_OFF`). | R1 |
| 11 | **Payment list + remove** | Correct mistakes | Payments panel lists tenders with remaining balance. Remove = `DELETE .../payments/:id`, with no confirm (P3-2), **except TRADE_IN, which confirms** _(revised P4, see §8 P4-10)_. Edit is not exposed (remove + re-add, reaffirmed in P3-1); TRADE_IN is frozen server-side anyway. | R1 (edit: R1.1) |
| 12 | **Complete sale confirmation** | Commit the sale | Enabled only when `amount_paid === total`. Confirm dialog shows totals, tenders, change due; `POST /sales/:id/complete`. Success shows a "Sale complete" panel with sale number and change, then a fresh terminal. 409s (stock, IMEI race, trade-in IMEI) show inline with the offending line/payment highlighted. | R1 |
| 13 | **Discard draft** | Abandon a cart | `DELETE /sales/:id` behind a confirm. Also offered when starting a new sale with a non-empty draft. | R1 |
| 14 | **Recent sales list** | Look up today's sales | Paginated `GET /sales` scoped to this branch (and today by default); shows sale number, time, cashier, total, status. Row opens a read-only detail. | R1 |
| 15 | **Sale detail (read-only)** | Inspect a completed/voided sale | Lines, payments (with reversal stamps), totals, trade-in info. Host for the Void action. | R1 |
| 16 | **Void sale flow** | Reverse a completed sale | Admin/manager only (`VOID_SALE`). Reason required (≥ 3 chars). Cashiers see the button disabled with a tooltip ("visible but disabled" pattern). 409 when a trade-in was resold — message tells the operator to void the later sale first. Since the buy-back change (#27), also 409 "the phone was taken back into stock on a later sale or purchase" when a phone this sale sold was later taken back; voids unwind newest-first (P5; see §8 P4 decision log, B4) _(revised P4)_. | R1 |
| 17 | **Keyboard help overlay** | Discoverability | `?` / F1 opens a cheat sheet of the shortcuts in §6. Hidden on touch-only devices. | R1 |
| 18 | **External-supplier (friendly-shop) lines** | Sell stock sourced from another shop | `addLine` with `external_supplier_id` (+ free-text IMEI for serialized). | **R1.1** (Q12) |
| 19 | **Sale-level notes** | Free-text on the sale | `PATCH /sales/:id { notes }`. | **R1.1 candidate** |
| 20 | **Payment edit** | Fix an amount without remove + re-add | `PATCH .../payments/:id`. Kept out of P3 (P3-1), including inline CASH edit. | **R1.1** |
| 21 | **Recent sales filters beyond "today"** | Historic lookup | Date range, status, cashier filters on the list. | **R1.1** |

---

## 2. Conventions inherited from Phase 6.2 Path B

Everything below already exists in `frontend/src` and the terminal follows it unless §8 overrides.

**Stack:** React 19, Vite 8, React Router 7, Redux Toolkit 2, Zustand 5, axios, react-hook-form 7 + zod 4 (`@hookform/resolvers`), Headless UI 2, Tailwind 4, lucide-react. Plain JavaScript (`.jsx`/`.js`), no TypeScript.

**File structure** — one folder per component, `index.jsx` inside:

```
src/
  components/common/<Primitive>/index.jsx      # Button, InputField, Select, Table, Dialog, Drawer, ConfirmDialog, Tooltip
  components/<feature>/<Component>/index.jsx   # e.g. components/products/AdjustStockDialog
  components/layout/...                        # AppLayout, AppHeader, Sidebar, BranchSelector, UserMenu
  components/auth/...                          # ProtectedRoute, RoleProtectedRoute, LoginForm
  pages/<PageName>/index.jsx                   # routed screens
  services/<resource>Service.js                # thin axios wrappers, return response.data
  store/slices/<name>Slice.js                  # Redux domain state
  store/zustand/<name>Store.js                 # Zustand UI preferences
  schemas/<name>Schema.js                      # zod schemas for forms
  hooks/, constants/
```

**axios** — single instance in `services/api.js`: `baseURL = VITE_API_BASE_URL`, `withCredentials: true`, a 401 interceptor that coalesces concurrent refreshes onto one `POST /auth/refresh` and calls an injected `onAuthFailure` (wired in `main.jsx` to avoid a store import cycle). Services never touch the store:

```js
// services/productsService.js (existing)
export const getProductByBarcode = async (barcode) => {
  const response = await api.get(`/products/by-barcode/${encodeURIComponent(barcode)}`);
  return response.data;
};
```

**Redux slice shape** — reference data via `createAsyncThunk`, `{ items, loading, error, initialized }`, `clearX` reducer called on logout, selectors exported from the slice file:

```js
// store/slices/brandsSlice.js (existing)
export const fetchBrands = createAsyncThunk("brands/fetchBrands",
  async ({ includeInactive = false } = {}, { rejectWithValue }) => {
    try { return await listBrands({ includeInactive }); }
    catch (error) {
      return rejectWithValue(error.response?.data?.message || error.message || "Failed to load brands");
    }
  });
const initialState = { brands: [], loading: false, error: null, initialized: false };
```

**State split (existing ADR, in `store/zustand/activeBranchStore.js`):** Redux for domain state (auth, branches, brands, categories); Zustand for UI preferences (theme, layout, active branch), persisted with `zustand/middleware` `persist`. View-specific lists (e.g. products on `ProductsList`) live in **component `useState`**, not Redux, with a request-id ref to drop stale responses.

**Routing** — `App.jsx` declares all routes. Authenticated routes nest under `<ProtectedRoute><AppLayout /></ProtectedRoute>` and render via `<Outlet />`. Role gating per route with `<RoleProtectedRoute allowedRoles={[...]}>` (redirects to `/dashboard`). Specific paths before param paths (`/products/new` before `/products/:id`).

**Forms** — two patterns in use:
- Larger forms: `useForm({ resolver: zodResolver(schema) })` + `Controller` for custom inputs (`ProductCreate`, `ProductEdit`, `CategoryFormDialog`).
- Small dialogs: `useState` fields + a local `validate()` (`AdjustStockDialog`).

**Errors** — backend message extracted as `err.response?.data?.message` (string or array → first item) and shown in an inline red box inside the page/dialog. No toasts.

**Loading** — `loading` flags; `Button` has a `loading` prop (spinner); full-screen spinner only during session restore; dialogs set `dismissible={false}` while submitting.

**Auth / permissions** — `state.auth.user = { id, email, name, role, avatar }` (mapped from backend `full_name`). `usePermissions()` → `{ can, role, isAdmin, isManager, isCashier }`. `constants/rolePermissions.js` already defines `CREATE_SALE`, `VIEW_SALES`, `VOID_SALE`, `APPLY_DISCOUNT`, `VIEW_CUSTOMERS`, `CREATE_CUSTOMER`. Pattern is **visible but disabled** with a tooltip, not hidden. Logout clears every Redux cache and the active-branch store (shared POS terminals).

**Styling** — Tailwind utility classes, `slate` neutrals, `cyan`/`sky` brand accents (CSS vars in `index.css`), class-based dark mode (`themeStore`), `tabular-nums` for money, LKR via `Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" })` (currently a module-level helper in `ProductsList` — to be lifted to a shared util).

---

## 3. State management strategy

**Recommendation: Redux Toolkit for the in-flight sale; Zustand only for terminal UI preferences; server is the source of truth.**

| Concern | Lives in | Why |
|---------|----------|-----|
| Current draft sale (lines, payments, totals, status) | Redux `posTerminal` slice (`store/slices/posTerminalSlice.js`) | Domain state; matches the existing ADR. DevTools action log is useful when a cashier reports "the total was wrong". |
| Draft sale id across reloads | Zustand `terminalSessionStore` (persisted) | It is a pointer, same category as `activeBranchStore`. Cleared on logout. |
| Product catalog for the branch | **Not held** _(revised P1, 2026-10-15; see §8 P1 decision log)_ | Hybrid loading (§5): exact barcode lookup plus a scoped server search as the cashier types. Only the current search results live in the `posTerminal` slice. |
| Dialog open/close, search results, form fields | Component state | View-local, as in Path B. |
| Recent sales list | Component state on the page | View-specific list, as with `ProductsList`. |

Zustand is **already used** (theme, layout, active branch). It is not proposed for cart state because the cart is server state, not a UI preference.

**`posTerminal` slice shape (as built in P1)** _(revised P1, 2026-10-15; see §8 P1 decision log)_:

```js
{
  draftSaleId: null,     // mirrors terminalSessionStore (persisted pointer)
  draftSale: null,       // full hydrated sale from the last server response
  status: "idle",        // idle | loading | ready | discarding | error | gone
  error: null,           // draft-lifecycle error { message, status }
  pendingLines: [],      // optimistic rows for in-flight addLine calls
  busyLineIds: [],       // lines with an in-flight qty edit / removal
  lineError: null,       // last cart mutation error { message, status, existing_unit }
  scanState: "idle",     // idle | searching (name search) | loading (barcode lookup)
  scanResults: [], scanQuery: null, scanError: null,
  stockByProduct: {},    // { [productId]: { quantity, manage_stock } } for the Q1 warning
  stockErrors: {},       // { [productId]: true }: lookup failed, the line shows "?"
}
```

Later slices add payment, completion (`lastCompleted`) and customer state to this slice.

**Optimistic updates: `addLine` only** _(revised P1, 2026-10-15; see §8 P1 decision log)_. Dispatching `addLine` shows a pending row at once (product name and catalog price, a spinner in place of the line total, controls disabled). The server's hydrated sale replaces it on success; on failure the row is removed and the error shows under the scan bar. **Totals are never optimistic:** the Totals panel shows the server's figures and dims with "Updating…" while any line mutation is in flight. Qty edits and removals aren't optimistic either: the row is dimmed ("busy") until the server answers, and the reducer replaces `draftSale` wholesale. The original reasoning still holds for money: totals, discounts, rounding and line numbers are computed server-side, and a wrong total at a till is worse than a short wait. The pending row only acknowledges the scan at once. Line mutations run one at a time through a queue in the slice, so fast scans reach the server in order and an older response can't overwrite a newer sale.

**Payments** _(revised P3, see §8 P3-5)_. `addPayment` shows a pending row (method and amount, dimmed) that the server sale replaces, or that is removed on failure. `removePayment` hides the row at once and restores it if the call fails. Totals stay server-only, with the same "Updating…" dim. Payment calls go through the same queue as line and customer edits, so they can't race the cart.

**Server ↔ client sync:**

- **A DRAFT is created when the terminal opens** _(revised P1, 2026-10-15; see §8 P1 decision log)_. On mount, `ensureDraftSale` resumes the stored draft or calls `POST /sales { branch_id }`, so the first scan never waits on a create. The cost is one empty DRAFT per terminal session that never gets an item. "New sale" discards with `DELETE /sales/:id` (behind a confirm; disabled while the cart is empty) and opens a fresh one. Concurrent opens (StrictMode, re-renders) are deduplicated with a thunk `condition`.
- After each mutation the client holds exactly what the server returned. Line/payment `DELETE` (204) is followed by `GET /sales/:id`. `PATCH /sales/:id` (customer attach/detach) returns the hydrated sale, including the new `customer`, and replaces the held sale like any other mutation.
- If any call returns 400 "Only DRAFT sales are mutable" or 404, the client drops the draft and shows "This sale is no longer open" (another tab or user completed/discarded it).

**Page reload mid-sale:**

1. On terminal mount, read `draftSaleId` from `terminalSessionStore`.
2. `GET /sales/:id`. If DRAFT and same branch → restore (the customer comes with the sale). If COMPLETED/VOIDED/404, or a different branch → clear the pointer and start fresh. A network or 5xx error does **not** start a fresh draft; the terminal shows "Try again". (Known gap: switching branch leaves the old DRAFT orphaned; see FOLLOWUPS.)
3. Pointer is cleared on complete, discard, and logout.

Alternative (no local pointer) is in §8 Q8.

---

## 4. Routing structure

| URL | Component | Layout | Guard |
|-----|-----------|--------|-------|
| `/login` | `LoginPage` (existing) | none | public. Post-login redirect: cashier → `/pos`, others → `/dashboard` |
| `/pos` | `pages/PosTerminal` | `TerminalLayout` (full-screen, no sidebar — see Q7) | `ProtectedRoute` → `RoleProtectedRoute [admin, manager, cashier]` → `BranchContextGuard` |
| `/pos/sales` | `pages/PosRecentSales` | `TerminalLayout` | same as `/pos` |
| `/pos/sales/:id` | `pages/PosSaleDetail` | `TerminalLayout` | same; Void button gated by `can(VOID_SALE)` inside the page |

Route declaration (matches `App.jsx` style — a second protected layout branch next to the `AppLayout` one):

```jsx
<Route element={<ProtectedRoute><RoleProtectedRoute allowedRoles={["admin","manager","cashier"]}>
                  <BranchContextGuard><TerminalLayout /></BranchContextGuard>
                </RoleProtectedRoute></ProtectedRoute>}>
  <Route path="/pos" element={<PosTerminal />} />
  <Route path="/pos/sales" element={<PosRecentSales />} />
  <Route path="/pos/sales/:id" element={<PosSaleDetail />} />
</Route>
```

**`BranchContextGuard`** resolves the terminal's branch:

- Staff (manager/cashier): `user.branch_id` (requires the `mapBackendUser` fix).
- Admin: `activeBranchStore.activeBranchId`; if null, render a "Pick a branch to open the terminal" panel using the existing `BranchSelector`.
- Exposes the branch via a hook (`useTerminalBranch()`), used for `POST /sales`, catalog fetch, recent-sales filter.

A **"POS" entry** is added to `Sidebar` (visible to all three roles), and `TerminalLayout` has an "Exit terminal" link back to `/dashboard`.

The sale id is **not** in the `/pos` URL (the draft is session state, not a shareable resource). Completed sales are addressable at `/pos/sales/:id`.

---

## 5. Data-fetching pattern

**Recommendation: keep Path B's pattern — service modules over the shared axios instance + `createAsyncThunk` for terminal domain actions; component `useState` for page-local lists. No new data library.**

- **Path B uses:** plain axios services, `createAsyncThunk` for shared reference data, `useState` + request-id ref for page lists. RTK Query, SWR, and TanStack Query are **not installed**.
- Introducing RTK Query would mean two data patterns in one app; its cache-invalidation model also adds little here because line/payment mutations already return the full sale.

**New service:** `services/salesService.js` (`createSale`, `getSale`, `listSales`, `updateSale`, `discardSale`, `addLine`, `updateLine`, `removeLine`, `addPayment`, `removePayment`, `completeSale`, `voidSale`), plus `customersService.js` (`searchCustomers`, `createCustomer`). No `getCustomer` is needed: the sale response carries the customer.

**Thunks** in the `posTerminal` slice wrap service calls and normalize errors to `{ message, status, existing_unit? }`.

**Retries:**

- **GETs:** one automatic retry after 1 s on network error / 5xx (catalog, `GET /sales/:id`, customer search).
- **Mutations: never auto-retried.** `POST .../payments` and `POST .../complete` are not idempotent; a retried payment after a lost response could double-record a tender. On a network error during a mutation, the client re-fetches `GET /sales/:id` and shows the real state ("Connection lost — here is what the server has").

**Offline:** none in R1 (see Q4). A network-status indicator in the status strip (`navigator.onLine` + last request outcome); mutations disabled while offline.

**Catalog loading: hybrid, no preload** _(decided 2026-10-15, after #19 added server-side `search` and made `GET /products` paginated with `limit` ≤ 200; replaces "load the branch catalog once and filter client-side")_. The scan bar routes each value by its shape:

- **Barcode-shaped** (8–20 digits, or an `SLP-` prefix): Enter → `GET /products/by-barcode/:barcode`. A 404 shows inline ("No product found"). A 15-digit miss shows "That looks like an IMEI — scan the product label first" (Q9).
- **Anything else, 2+ chars:** debounced 250 ms → `GET /products?search=<query>&branchId=<terminal branch>&limit=20`, shown as a keyboard-navigable dropdown (↑/↓, Enter, Esc). Each result list is tagged with its query, so Enter never picks a stale list, and out-of-date responses are dropped.

Nothing is cached between searches, so the 200-row cap on `/products` doesn't matter: every search is scoped and limited. Server `search` matches **name only**, so name search doesn't find SKU text or alphanumeric manufacturer barcodes (barcode fallback in FOLLOWUPS).

**Stock (Q1 warning):** after each add or qty change, one `GET /stock?productId=&branchId=`. On draft resume, **one** `GET /stock?branchId=` for the whole cart. The API throttles at 10 req/s per IP, and one lookup per product on reload pushed larger carts past it. A terminal page load is a fixed 5 requests regardless of cart size.

---

## 6. Keyboard-heavy UX

**Approach (Q17, decided — revised 2026-10-13): `react-hotkeys-hook` for the key bindings, registered at `TerminalLayout`, plus native focus management.** Installed in P0; bindings land with the scan bar and dialogs that use them. Headless UI already traps focus inside dialogs and restores it on close; the remaining need is a global keydown map and "return focus to the scan input". The shop has no existing POS, so there is no muscle memory to match: the map below is the design, refined after cashiers use it.

**Global rules:**

- The scan input is the **home position**. Any closed dialog, completed action, or `Esc` on the terminal returns focus to it.
- Function-key shortcuts call `preventDefault()`. **Never bound:** F5 (reload), F11 (fullscreen), F12 (devtools), Ctrl+W/T/N/R (browser-reserved).
- Shortcuts are suppressed while a dialog is open except that dialog's own keys.
- Destructive actions (discard, void) always go through a confirm dialog; Enter confirms, Esc cancels. **Exception: removing a non-trade-in payment has no confirm** _(revised P3, see §8 P3-2; narrowed P4, see §8 P4-10)_. It only affects a DRAFT, and re-adding is one keystroke. Removing a TRADE_IN payment does confirm ("Remove trade-in? You'll need to re-enter the phone details."), because re-adding means re-entering the product, IMEI and prices.

**Barcode scanners:** USB/Bluetooth scanners in HID mode type characters quickly and send Enter. The scan input treats Enter as "submit this value": try exact barcode (`by-barcode`), then catalog name/SKU search. No keystroke-timing heuristics in R1 (a typed SKU + Enter behaves the same as a scan, which is fine). While an `addLine` is in flight, further Enter submissions are **queued in order** and processed sequentially so fast consecutive scans aren't lost or reordered.

| Screen | Key | Action |
|--------|-----|--------|
| Terminal (global) | F2 | Focus scan input |
| | F3 | Customer attach dialog |
| | F4 | Payment dialog (method defaults to CASH) |
| | F6 | Payment dialog with TRADE_IN selected; with no customer on the sale, the customer attach dialog first, then the payment dialog _(revised P4, see §8 P4-1, P4-2)_ |
| | F9 | Complete sale (opens confirm; only when balance is 0) |
| | Ctrl+Delete | Discard draft (confirm) |
| | F1 or `?` (when not typing) | Keyboard help overlay |
| | Alt+R | Recent sales |
| | Esc | Close dialog / clear scan input / return focus |
| Scan input | Enter | Look up and add |
| | ↓ / ↑, Enter | Navigate / pick from search results |
| Cart | Alt+↑ / Alt+↓ | Move line selection |
| | `+` / `-` | Qty ±1 on selected non-serialized line |
| | Delete | Remove selected line (confirm) |
| | `D` | Discount on selected line (if permitted) |
| IMEI prompt | Enter | Submit IMEI |
| Payment dialog | 1–6 | Pick method (CASH, CARD, BANK_TRANSFER, KOKO, MINTPAY, TRADE_IN). 1–5 shipped in P3; **6 = TRADE_IN** in P4 _(revised P4)_ |
| | Tab | Amount → cash received / reference → submit. TRADE_IN: product → IMEI → trade-in value → resale price → notes → submit _(revised P4)_ |
| | Enter | Record payment. **Exception:** Enter in the trade-in IMEI field moves focus to the next field instead of submitting, because a scanner sends Enter after the IMEI _(revised P4, see §8 P4-7)_ |
| Payments panel | Alt+P then ↑/↓, Delete | Select and remove a payment (TRADE_IN asks to confirm, P4-10) |
| Complete confirm | Enter / Esc | Complete / back |
| Sale complete panel | Enter or any scan | Start next sale |
| Customer dialog | type → ↓/↑ → Enter | Search and pick; Ctrl+N new customer |
| Recent sales | ↑/↓, Enter | Open sale; Esc back to terminal |
| Sale detail | V | Void (admin/manager) |

Final bindings get a usability pass with an actual cashier after P1.

### Touch and small screens (Q6)

Keyboard shortcuts are an accelerator, never the only way to do something.

- **Every hotkey action has a visible button.** The shortcut shows as a `Kbd` chip on the button only on devices with a fine pointer and hover (`@media (hover: hover) and (pointer: fine)`).
- **Scanners on tablets/phones:** Bluetooth scanners in HID mode type into the focused input exactly as on desktop. No camera scanning (Q22).
- **No auto-focus loop on touch devices.** Re-focusing the scan input after every action would keep popping the on-screen keyboard. On touch-only devices the scan input focuses only when tapped or after a scan submit.
- **Touch targets** are at least 44×44 px; the quantity stepper uses buttons, not `+`/`-` keys.
- **Dialogs become bottom sheets** below `md` (the existing `Drawer` primitive or a full-height `Dialog` variant), with the primary action pinned at the bottom above the safe-area inset.
- **Destructive actions** use the same confirm dialogs; swipe-to-delete is not used, because it is too easy to trigger by accident at a till.

**Layout per breakpoint (Tailwind defaults):**

| Width | Layout |
|-------|--------|
| `< md` (phone) | Single column: scan bar (sticky top) → customer chip → cart as stacked cards → sticky bottom bar with total, remaining balance, and a **Pay** button. Payments, totals breakdown and complete open as bottom sheets. |
| `md`–`lg` (tablet) | Cart full width; totals + payments panel as a collapsible right drawer, opened by the bottom bar. |
| `≥ lg` (desktop) | Two columns: cart left (~60%), totals + payments + actions right (~40%), status strip at the bottom. Reference layout for screenshots. |

---

## 7. Component architecture

**Shared primitives stay in `components/common/`** (Button, InputField, Select, Table, Dialog, ConfirmDialog, Tooltip, Drawer). New primitives added there only if generic: `MoneyText` (LKR formatting + `tabular-nums`), `Kbd` (shortcut chip, hidden on touch), `Toast` (Q5), `StatusBanner`, `ResponsiveDialog` (renders `Dialog` at `≥ md`, a bottom sheet below it; every terminal dialog uses this), `useMediaQuery` hook.

**Visual direction (Q6):** modern and clean within Path B's existing tokens — card surfaces with soft borders and rounded corners, generous spacing, large `tabular-nums` totals, the cyan/sky accent reserved for the primary action (Pay / Complete), dark mode supported via the existing `themeStore`. No new UI library. The design target is a 1366×768 laptop (Q23): the desktop layout must fit there with the totals/payments column fully visible. Screenshots at 1366×768 (floor), 1920×1080 (ideal) and 390 px (smoke check) are reviewed at the end of P0; the full 390/768/1366 responsive review moves to P1 with the cart.

**Responsive rendering:** the cart renders as a table at `≥ md` (`CartTable`) and as stacked cards below it (`CartCardList`), sharing one row-model selector, so both show the same data and actions.

**Feature components in `components/pos/`**, pages in `pages/Pos*`, shell in `components/layout/TerminalLayout`.

```
components/layout/TerminalLayout/        # full-screen frame, status strip, hotkey provider, <Outlet/>
components/pos/
  BranchContextGuard/
  ScanBar/                               # scan input + search results popover + scan queue
  ImeiPromptDialog/
  CartLines/                             # (revised P1) one responsive component: grid ≥ md, cards < md
  LineDiscountDialog/                    # P2 (FOLLOWUPS)
  NewSaleDialog/                         # discard-draft confirm (was DiscardDraftDialog)
  MobileActionBar/                       # < lg: sticky total + remaining + Pay
  CustomerPanel/
    CustomerAttachDialog/                # search + pick
    CustomerCreateForm/                  # inline create (react-hook-form + zod)
  PaymentDialog/                         # (revised P3) flat folder; method switch; renders one of:
    CashFields/
    ReferenceFields/                     # CARD, BANK_TRANSFER, KOKO, MINTPAY
    TradeInFields/                       # (revised P4) method 6: product combobox, IMEI, trade-in value, resale, notes
  PaymentsList/                          # (revised P3, P4) tenders list + remove (no edit; confirm for TRADE_IN only)
  TotalsPanel/
  CompleteSaleDialog/
  SaleCompletePanel/
  RecentSalesTable/
  SaleDetailView/
  VoidSaleDialog/
  KeyboardHelpOverlay/
pages/PosTerminal/  pages/PosRecentSales/  pages/PosSaleDetail/
services/salesService.js  services/customersService.js
store/slices/posTerminalSlice.js                 # (revised P1) no posCatalogSlice: hybrid loading, §5
store/zustand/terminalSessionStore.js
hooks/useTerminalBranch.js  hooks/useMediaQuery.js     # hotkeys: useHotkeys from react-hotkeys-hook (Q17)
schemas/paymentSchema.js  schemas/customerSchema.js  schemas/voidSchema.js
utils/money.js                           # formatLKR (P1); toCents / fromCents (P3: balance and change math in integer cents)
utils/device.js                          # isTouchOnly (P1)
```

**Payment modal composition:** one `PaymentDialog` owns method selection, amount, and submit; the method-specific fields are child components selected by method. Each child exports its zod schema fragment, and the dialog builds a discriminated union (`z.discriminatedUnion("payment_method", [...])`) mirroring the backend rules (CASH needs `cash_received >= amount`; reference methods need `reference_number`; TRADE_IN needs product, IMEI, buying price = amount, and a customer on the sale). Client validation is a convenience; the server stays authoritative.

**TRADE_IN in the dialog** _(revised P4, see §8 P4 decision log)_. `TradeInFields` replaces the generic Amount field with one **Trade-in value** field; `buildPaymentPayload` sends it as both `amount` and `trade_in_buying_price`. Field order: Product → IMEI → Trade-in value → Resale price (optional) → Condition notes (optional). The method picker becomes a 3×2 grid (`grid-cols-3 sm:grid-cols-6`). The zod tradeIn branch checks: value ≤ balance due (in cents), IMEI 8–50 letters/digits, resale > 0 when given, and the IMEI not already on another trade-in on this sale. The product combobox is a dialog-local lookup (`GET /products?search&branchId&productType=PHONE&limit=20`, filtered to `is_serialized` on the client). The no-customer panel, the Luhn hint and the 409 messages are in P4-2, P4-7.

**Data flow:** pages and feature components dispatch `posTerminal` thunks and read selectors (`selectSale`, `selectBalanceDue` (was `selectRemaining`; revised P3), `selectCanComplete`, `selectHasTradeInPayment` (was `selectHasTradeIn`; revised P4, and it counts pending TRADE_IN rows too, P4-11)); they never call services directly, except dialog-local lookups (customer search, catalog search, trade-in product search).

---

## 8. Open design questions

### Decisions (answered 2026-10-12)

Q6, Q9, Q11, Q12 and Q17 were answered explicitly. The rest were not called out, so their recommended defaults are taken as accepted. Say so if any of them should change.

| Q | Topic | Decision |
|---|-------|----------|
| Q1 | Out of stock on add | Default — warn on the line, don't block |
| Q2 | Trade-in entry | Default — TRADE_IN tab in the payment dialog, sectioned; F6 opens it |
| Q3 | Post-sale summary | Default — in-terminal "Sale complete" panel |
| Q4 | Offline | Default — none; banner + mutations disabled |
| Q5 | Errors | Default — inline + persistent 409 banner + new Toast primitive |
| **Q6** | **Design** | **Modern design, mobile responsive.** No mockups; built within Path B tokens. Responsive rules in §6 "Touch and small screens" and §7 |
| Q7 | Layout | Default — full-screen `TerminalLayout` |
| Q8 | Reload | Default — persisted draft id, server query as fallback |
| **Q9** | **IMEI scanning** | **Phones carry both a product label and an IMEI.** Product-first flow (a) works for R1; IMEI-shaped scans get a hint. Cashier IMEI lookup (b) stays a backend follow-up |
| Q10 | Admin branch | Default — header branch selector |
| **Q11** | **Discounts** | **All roles may discount for now.** Add `APPLY_DISCOUNT` to the cashier role; revisit when shop policy firms up. No backend change (it already allows all roles) |
| **Q12** | **Friendly-shop lines** | **R1.1** |
| Q13 | Customer on sale | Default — backend adds `customer` relation to `findOne` |
| Q14 | Test tooling | Default — Vitest + RTL from P0, Playwright in P6 |
| Q15 | Void reason | Default — presets + optional detail |
| Q16 | Recent sales | Default — today, this branch, all cashiers |
| **Q17** | **Hotkeys** | **No existing POS to match.** `react-hotkeys-hook` with the §6 map; refine after cashier use (revised 2026-10-13 from the vanilla hook) |
| Q18 | Abandoned drafts | Default — confirm and discard |
| Q19 | Customer detach with trade-in | **Resolved in P2** — frontend guard in `CustomerCard` (dimmed Detach + tooltip) backed by slice-level refusal. Backend-side guard in `SalesService.update` shipped in #22 (also covers customer reassignment). P4 extends the frontend guard to Change and F3 (P4-11) |
| Q20 | Language | Default — English only |
| Q21 | Cashier landing | Default — `/pos` |
| **Q22** | **Camera scanning** | **None.** The shop has a hardware barcode scanner; it types into the scan input like a keyboard. Camera scanning is dropped from the roadmap, not deferred |
| **Q23** | **Primary till device** | **A laptop** with the barcode scanner. Desktop-first: the `≥ lg` layout at **1366×768** is the design target (it must fit without scrolling the totals/payments column); 1920×1080 is checked too. Tablet and phone layouts stay fully usable (Q6), as the secondary case |

### P1 decision log (2026-10-15)

Decisions made or changed while building P1. Where they differ from the original planning text, the affected sections are marked "revised P1".

| # | Topic | Decision | Replaces |
|---|-------|----------|----------|
| P1-1 | Catalog loading (§5) | **Hybrid:** by-barcode on Enter for barcode-shaped input; a 250 ms debounced server `search` (branch-scoped, `limit=20`) for text. No catalog preload and no `posCatalogSlice`. Decided after #19 (server search + pagination). | "Load the branch catalog once, filter client-side" |
| P1-2 | Draft creation (§3) | **The DRAFT is created when the terminal opens** (`ensureDraftSale` on mount) and resumed from the persisted pointer on reload. "New sale" is confirm → `DELETE` → fresh draft, and is disabled while the cart is empty. | "No DRAFT until the first item is added" |
| P1-3 | Optimistic UI (§3) | **`addLine` shows a pending row** at once, replaced by the server sale on success and removed on failure. Totals, qty edits and removals stay server-authoritative (busy rows, "Updating…" totals). Line mutations are queued in order. | "Optimistic updates: none" |
| P1-4 | Slice name | **`posTerminal`** (`store/slices/posTerminalSlice.js`). The draft pointer lives in `terminalSessionStore` (Zustand persist, cleared on logout). | `terminalSlice` |
| P1-5 | Serialized add (Q9, §1 #4) | **The IMEI prompt opens _before_ `addLine`.** The backend rejects a serialized line without `imei_snapshot` (400), so the flow is: scan the product label → prompt → `addLine({ product_id, quantity: 1, imei_snapshot })`. 400/409 errors stay inline in the prompt, with `existing_unit.status`. Serialized lines (those with an IMEI) lock qty at 1. | "After adding, show an IMEI prompt" (P1 brief wording) |
| P1-6 | Stock warning (Q1 b) | Brought forward from P6. Warns when branch stock is below the product's qty **summed across lines**; never blocks. Resume uses one branch-wide stock request (rate limit). A failed lookup shows a muted "?". | P6 |
| P1-7 | Cart components (§7) | One responsive **`CartLines`** instead of `CartTable` + `CartCardList`. | Two components |
| P1-8 | P1 scope | Narrowed to scan bar, cart, totals, draft lifecycle, stock warning and F2/focus. Later slices per the P1 brief: customer attach → P2, payments → P3, TRADE_IN → P4, complete → P5. Line discounts → P2 (FOLLOWUPS). Mobile sticky action bar → P6. | §9 P1 row (payments + complete in P1) |
| P1-9 | Focus (§6) | F2 (from anywhere, including inputs) and Esc (outside inputs) focus the scan bar. Qty Enter, line delete and closing the New sale dialog hand focus back to it. Steppers keep focus (busy = `aria-disabled`, not `disabled`). No automatic hand-offs on touch-only devices, and no auto-focus on mount when the pointer is coarse. | — |

### P3 decision log (2026-10-15)

Decisions made before building P3 (payment entry). Where they differ from the original planning text, the affected sections are marked "revised P3".

| # | Topic | Decision | Replaces |
|---|-------|----------|----------|
| P3-1 | Payment edit (§1 #11, #20, §10) | **Not in P3.** No inline CASH edit and no `updatePayment` in the service or slice; a wrong tender is fixed by remove + re-add. Edit stays R1.1. | P3 brief (inline CASH edit) |
| P3-2 | Remove-payment confirm (§6) | **No confirm.** An explicit exception to the §6 "destructive actions confirm" rule: the payment is on a DRAFT and re-adding is one keystroke. Removal is optimistic (hidden at once, restored on failure). | §6 global rule (remove payment confirmed) |
| P3-3 | Payment service | `addSalePayment` / `removeSalePayment` (matching `addSaleLine` / `removeSaleLine`) added to **`salesService.js`** (§5), not a new `payments.js`; the slice thunks are `addPayment` / `removePayment`. | P3 brief (`services/payments.js`) |
| P3-4 | Payment components (§7) | **Flat folders** like the other pos components: `components/pos/PaymentDialog/` (with `CashFields` and `ReferenceFields` inside) and `components/pos/PaymentsList/`. **Placement:** `PaymentsList` sits in the **left column, directly below the cart** (and right after the cart in the single-column layouts), not in the right-hand column. At a real 1366×768 laptop viewport (~640px tall) the right column (Current sale, Customer, Totals) has no room left, while the cart has spare height; P4 trade-in rows would add more. The cart flexes (`lg:min-h-40`); Payments keeps its natural height, shows up to 3 rows and scrolls beyond that, and renders nothing before the first tender. Rows switch from stacked to a table on the card's own width (container query, ≥ 32rem; ~538px viewport). The right column keeps a scroll fallback with Totals (Pay / Ready) sticky at the bottom. | `components/pos/Payments/{PaymentsPanel, PaymentDialog}`; payments panel in the right-hand column (§1 #2) |
| P3-5 | Optimistic UI (§3) | A pending row on add (as `addLine`). Remove hides the row at once and restores it on failure (unlike lines, which dim while removing). Totals stay server-only with the existing "Updating…" dim. All payment calls go through the serial mutation queue. | — (§3 covered lines only) |
| P3-6 | Pay entry point | A **"Pay LKR X"** button in the Totals panel (X = balance due) plus **F4**; both open the PaymentDialog. Multi-tender = open the dialog again; one payment per submission. | — |
| P3-7 | Fully paid | The Totals panel shows a calm **"Ready to complete"** state when the cart is non-empty and the balance is 0. No complete button (P5). No overpaid state: the backend makes overpayment impossible. | — |
| P3-8 | Method keys (§6) | Number keys **1–5** pick CASH, CARD, BANK_TRANSFER, KOKO, MINTPAY inside the dialog. 6 / TRADE_IN arrives with P4. | 1–6 |
| P3-9 | Money math | Balance and change are computed in **integer cents** (`toCents` / `fromCents` in `utils/money.js`), never by float subtraction. Balance due = `total − amount_paid` from the server sale. | — |
| P3-10 | Backend fixes found in P3 recon | **Fixed in #24** before P3. (B1) The remaining-balance check compared floats, so paying the exact remainder after a partial payment with cents was rejected ("50.20 exceeds remaining balance 50.20"); it now compares in cents. (B2) A cart change that would drop `total` below `amount_paid` hit a DB CHECK and returned 500; it now returns 400 "Cannot reduce the sale total below the amount already paid. Remove or reduce payments first." #24 also bounds AMOUNT discounts in cents. | — |
| P3-11 | Bottom sheets below `md` (§6) | **Deferred to P6.** The PaymentDialog is a centred modal at every width, like every other dialog in the app; no dialog has the §6 bottom-sheet variant yet. P6 adds it for all terminal dialogs at once. | §6 "Dialogs become bottom sheets below `md`" (for P3) |
| P3-12 | Quick-tender chips (§1 #8) | **Deferred to P6.** The CASH form has no quick-tender chips (Exact / next 500 / next 1,000 / 5,000) in P3. The cashier types the cash received and sees the live change (P3-9); P6 can add chips that fill Cash received. | — |

### P4 decision log (2026-10-17)

Decisions made before building P4 (TRADE_IN payment). Where they differ from the original planning text, the affected sections are marked "revised P4".

**Business answers (from the shop):**

1. **A trade-in is almost always worth less than the purchase.** The customer pays the difference. There is no payout and no store credit. Buying a phone outright is the separate phone-purchase flow, which is not in 6.4 (§10).
2. **The catalogue has one used-phone product per model and storage** (e.g. "Used iPhone 12 128GB"). Only admins create products. Before go-live, an admin creates the common used-phone models (FOLLOWUPS, Go-live setup).
3. **Buy-backs are common.** Customers often trade in phones they bought from the shop, so P4 must not block an IMEI the shop sold before.

**Backend prerequisite: buy-back (#27).** One ProductUnit row per acquisition, so a SOLD or RETURNED IMEI can be traded in again; only `IN_STOCK` / `WRITTEN_OFF` IMEIs collide (409). #27 also added `trade_in_product` to each TRADE_IN payment on the hydrated sale, requires `trade_in_selling_price` ≥ 0.01 when sent, and rejects inactive trade-in products. Its design decisions (B1–B9) are in the #27 PR and in [used-phones.md](../backend/used-phones.md) § One row per acquisition. The one P5 needs is **B4**: voiding a sale whose phone was later taken back returns 409 "the phone was taken back into stock on a later sale or purchase"; voids unwind newest-first (§1 #16). **RETURNED** means "trade-in reversed by a void; the phone is back with the customer", not a phone the shop holds.

| # | Topic | Decision | Replaces |
|---|-------|----------|----------|
| P4-1 | Where the form lives (Q2, §7) | **`TradeInFields` inside `PaymentDialog` as method 6.** For TRADE_IN the generic Amount field is replaced by one **"Trade-in value"** field that sends both `amount` and `trade_in_buying_price`. Order: Product → IMEI → Trade-in value → Resale price (optional) → Condition notes. The picker becomes 3×2 (`grid-cols-3 sm:grid-cols-6`), checked at a ~640px-tall viewport. | Separate amount and buying-price fields "locked together" (§1 #10) |
| P4-2 | No customer attached (§1 #10) | Picking 6 shows an inline **"Trade-in needs a customer"** panel with **Attach customer**: close the PaymentDialog → open the CustomerAttachDialog → on attach, reopen the PaymentDialog with TRADE_IN selected. **F6** with no customer goes straight into that sequence. | — |
| P4-3 | Picking the product | A combobox over `GET /products?search=&branchId=&productType=PHONE&limit=20`, filtered to `is_serialized` on the client (no server filter), with USED SKUs (`phone_condition === "USED"`) first and a "Used" badge. Empty state: **"No used-phone product for this model. Ask an admin to add one."** No product creation from the till. | — |
| P4-4 | Worth more than the balance | Keep the backend rule (every payment is capped at the balance due). The UI caps Trade-in value at the balance with a clear message ("Trade-in value can't exceed the balance due (LKR X)…"). No payout or credit (business answer 1). | — |
| P4-5 | Default value | **Empty**, not pre-filled with the balance: the value becomes the unit's cost. | "Amount defaults to balance due" (P3) for this method |
| P4-6 | Resale price | Optional; > 0 when given (backend ≥ 0.01). A non-blocking warning when it is below the trade-in value. | — |
| P4-7 | IMEI input | One scanner-friendly input. **A scanner's Enter moves focus to the next field instead of submitting** (§6). Hard rule = the backend's (8–50 letters/digits). A 15-digit value failing Luhn gets a soft "Check digit doesn't match — rescan?" hint (non-blocking). Blocked on the client if another trade-in on this sale already has the IMEI. 409 messages by `existing_unit.status`: IN_STOCK "Already in stock"; WRITTEN_OFF needs a manager; `existing_unit: null` → a generic "already in inventory". **No SOLD block: buy-backs are supported** (#27). The null case can't happen when the payment is added (that only pre-checks); it comes from the live-IMEI index at complete. P4 keeps the generic message as a fallback, and the real case is handled with complete-time 409s in P5. | — |
| P4-8 | PaymentsList row (§7) | Keep the fixed row heights (stacked `h-18` 72px, table `h-14` 56px). Label "Trade-in"; one detail line `<product name> · <IMEI>`, mono, truncated, with a `title` tooltip. Resale price and notes are not shown (sale detail, P5). | — |
| P4-9 | Product name source | From the hydrated sale: `payment.trade_in_product.name` (#27). | — |
| P4-10 | Remove (§6) | **Confirm for TRADE_IN only** ("Remove trade-in? You'll need to re-enter the phone details."). Other tenders keep P3-2's no-confirm; the §6 exception narrows to non-trade-in payments. | P3-2 for TRADE_IN rows |
| P4-11 | Customer guard (Q19, §1 #7) | Keep P2's Detach guard and **also guard Change (and F3) while a trade-in exists** (#22 rejects reassignment as well as detach on the backend). `selectHasTradeInPayment` counts pending TRADE_IN rows too. | Detach-only guard (P2) |
| P4-12 | Not in P4 | Payout or store credit; creating products from the till; editing a trade-in (it's frozen: remove and re-add); the phone-purchase intake screen (§10); complete-time 409 handling (P5); condition fields or photos beyond free-text notes. Buy-back needs no P4 work: it is an ordinary trade-in. | §9 P4 row ("409 at add and complete") |

### Scheduling decisions

- **Phone purchase intake screen** (`POST /phone-purchases`, buying a phone outright): **not in 6.4** (§10).
- **Q13 backend change** (`customer` relation on `GET /sales/:id`): **landed now as its own small backend PR, before P0** (branch `feature/sales-customer-relation`), so the frontend never needs the extra `GET /customers/:id` workaround. That PR also fixes a bug the change exposed: `PATCH /sales/:id { customer_id }` would have written the previously loaded customer back.

### Question record

Q22 and Q23 were raised after the first round, so they appear only in the table above.

The original questions as asked, kept for the reasoning. The table above is authoritative.

**Q1. Product out of stock when added.** `addLine` doesn't check stock; complete fails with 409.
- (a) Allow; fail at complete with a clear message naming the line. (b) Fetch stock on add (`GET /stock?productId&branchId`) and warn but allow. (c) Block at add time client-side.
- **Default: (b)** — warn badge on the line ("Only 0 in stock"), not a block. Stock counts can be wrong and the shop may physically have the item. Costs one extra GET per add.

**Q2. Trade-in entry — one modal or multi-step?**
- (a) One dialog, sections: customer check → phone (product, IMEI) → price (buying, optional selling) → notes. (b) Wizard with 3 steps. (c) Trade-in as a tab inside the payment dialog.
- **Default: (c) with (a)'s layout** — TRADE_IN is a payment method server-side; one payment dialog keeps the mental model. F6 opens it pre-switched to TRADE_IN.

**Q3. Post-sale summary / receipt preview — same screen or separate?** Printing is Phase 6.6.
- (a) In-terminal "Sale complete" panel (sale number, total, change due), next scan starts a new sale. (b) Separate route `/pos/sales/:id/receipt`. (c) Both.
- **Default: (a)**; receipt route arrives with 6.6.

**Q4. Offline tolerance.**
- (a) None — require network; disable mutations and show a banner when offline. (b) Queue mutations locally and replay. (c) Full offline mode.
- **Default: (a).** (b)/(c) conflict with server-authoritative stock/IMEI checks and sale numbering.

**Q5. Error presentation.**
- (a) Inline only (current pattern). (b) Inline for validation + persistent banner in the terminal for transaction errors (409s) + a minimal Toast for success. (c) Modal for every error.
- **Default: (b)** — and build the `Toast` primitive now (it's already on FOLLOWUPS). 409s at complete must stay visible until dismissed, with the offending line/payment highlighted.

**Q6. Visual design system.** There is no design file in the repo; Path B established Tailwind tokens and common components.
- (a) Dev improvises within Path B's look. (b) You provide mockups/wireframes first. (c) Adopt a component library.
- **Decided:** modern design, mobile responsive, no mockups — (a) plus the responsive rules in §6/§7.

**Q7. Terminal layout — full-screen or inside the app shell?**
- (a) Own `TerminalLayout` without sidebar/header. (b) Inside `AppLayout` (sidebar visible). (c) Inside `AppLayout` with the sidebar auto-collapsed.
- **Default: (a)** — screen space goes to the cart; exit link returns to the app.

**Q8. Draft persistence across reload.**
- (a) Persist `draftSaleId` locally (Zustand persist), re-fetch on mount. (b) No local state; on mount query `GET /sales?status=DRAFT&cashierId=<me>&branchId=<b>` and resume the newest. (c) Don't resume; reload loses the cart (draft stays orphaned server-side).
- **Default: (a)**, with (b) as fallback when the pointer is missing. Note: (b) can find several drafts — parked sales (6.5) is what properly handles that.

**Q9. Scanning an IMEI directly.** Cashiers can't resolve IMEI → product (`/product-units` is admin/manager only).
- (a) Product-first only: scan/search product, then IMEI prompt (works today). (b) Add a cashier-accessible backend lookup (e.g. `GET /product-units/by-imei/:imei` returning product + status) so scanning a phone's IMEI sticker adds it directly. (c) Open `/product-units` read to cashiers.
- **Decided:** phones carry both labels → (a) for R1, (b) as a backend follow-up if the two-step flow proves slow.

**Q10. Admin at the terminal.** Admins have no `branch_id`.
- (a) Use the header `activeBranchStore` selection; block with a picker if unset. (b) Admins cannot use the terminal. (c) Ask on every terminal open.
- **Default: (a).**

**Q11. Discount permission.** Frontend `APPLY_DISCOUNT` is admin + manager only; the **backend lets any role set line discounts**.
- (a) Follow the frontend permission — cashiers see the discount control disabled (backend gap logged in FOLLOWUPS). (b) Let cashiers discount (change `rolePermissions`). (c) Cashier discount up to a cap, above that needs a manager.
- **Decided:** (b) for now — all roles may discount.

**Q12. External-supplier (friendly-shop) lines in R1?** Backend supports them; settlement is 6.7.
- (a) R1: supplier picker on add. (b) R1.1. (c) With 6.7.
- **Decided:** (b) R1.1.

**Q13. Customer on the sale response.** `GET /sales/:id` has no `customer` relation.
- (a) Frontend fetches `GET /customers/:id` when `customer_id` changes. (b) Backend adds `customer` to `findOne` relations (one-line change + test).
- **Default: (b)** as a tiny backend prerequisite; (a) works meanwhile.

**Q14. Frontend test tooling.** None exists.
- (a) Add Vitest + React Testing Library in slice 1; unit-test reducers/selectors/money utils and component-test dialogs. (b) Also add Playwright for 2–3 end-to-end flows against the real backend + test DB. (c) No automated frontend tests in 6.4.
- **Default: (a) now, (b) in the last slice.** Test counts in §9 assume this.

**Q15. Void reason input.**
- (a) Free text only (min 3 chars). (b) Preset reasons (customer return, wrong item, wrong price, duplicate) + optional detail. (c) Preset + required detail.
- **Default: (b)** — the preset fills the text, so the backend contract is unchanged.

**Q16. Recent sales scope.**
- (a) Today, this branch, all cashiers. (b) Today, this branch, own sales only for cashiers. (c) Last N sales, any day.
- **Default: (a)**; cashiers can still see colleagues' sales (backend reads are unscoped).

**Q17. Hotkey implementation and bindings.**
- (a) Vanilla hook (no dependency). (b) `react-hotkeys-hook`. (c) `tinykeys`.
- **Decided:** (b) `react-hotkeys-hook` (revised 2026-10-13; originally (a)); no existing POS, so the §6 map stands.

**Q18. Abandoned drafts.** Starting a new sale or logging out with a non-empty draft.
- (a) Prompt: "Discard current sale?" → `DELETE`. (b) Leave it as an orphan DRAFT. (c) Block until completed or discarded.
- **Default: (a)** on new sale; on logout, warn and discard. Orphan cleanup job is out of scope.

**Q19. Removing the customer while a TRADE_IN payment exists.** The backend allows it (FOLLOWUPS entry) and fails later at complete.
- (a) Frontend blocks the detach with a message. (b) Also fix the backend now. (c) Leave it.
- **Default: (a)** in 6.4; backend fix stays in FOLLOWUPS.
- **Resolved in P2** — frontend guard in `CustomerCard` (dimmed Detach + tooltip) backed by slice-level refusal. Backend-side guard in `SalesService.update` shipped in #22 (also covers customer reassignment).

**Q20. Language.**
- (a) English only. (b) English + Sinhala. (c) English + Sinhala + Tamil.
- **Default: (a)** for 6.4; strings kept in components (no i18n library yet).

**Q21. Cashier landing page.**
- (a) Cashiers land on `/pos` after login. (b) Everyone lands on `/dashboard`.
- **Default: (a).**

---

## 9. Build order (slices)

Each slice is a vertical, demoable increment. "unit" = reducers/selectors/utils (Vitest), "component" = React Testing Library. **Every slice ships its screens responsive** (Q6): its component tests cover the desktop and the `< md` rendering, and the slice demo includes a phone-width check. Responsiveness is not a polish pass at the end.

| Slice | Ships | Depends on | Tests (rough) |
|-------|-------|-----------|:-------------:|
| **P0 — Foundations + terminal shell** (narrowed 2026-10-13) | Vitest + RTL setup; `mapBackendUser` keeps `branch_id`/`branch`; `react-hotkeys-hook` installed (Q17); full-screen `TerminalLayout` shell (top bar, status strip, `<Outlet/>`); `BranchContextGuard` + `useTerminalBranch`; `/pos` route + Sidebar link; cashier login redirect to `/pos` (Q21); empty `PosTerminal` page. **Runnable:** log in as cashier → land on an empty terminal; admin picks a branch first. Ends with screenshots at 1366×768 (floor), 1920×1080 (ideal) and 390 px (smoke check only). | — | 14 unit, 18 component |
| **P1 — First runnable cart, payments + complete** | Moved from P0: `salesService`, `terminalSlice`, `posCatalogSlice`, `utils/money`; `TerminalLayout` breakpoint layouts, `ResponsiveDialog`, `useMediaQuery`, `MobileActionBar`; `ScanBar` (barcode + name search, IMEI-shaped hint) adding **non-serialized** lines; `CartTable` + `CartCardList` with qty edit + remove; `TotalsPanel`; discard draft. Then: `PaymentDialog` (bottom sheet on phone) with CASH + reference methods; `PaymentsPanel` with remove; `CompleteSaleDialog`; `SaleCompletePanel`; 409 banner on complete (insufficient stock); reload recovery (Q8); network banner; `Toast`. **First real end-to-end sale.** _(Revised P1: narrowed, see §8 P1-8. Shipped scan bar, cart, totals, draft lifecycle, stock warning and F2/focus, with 40 tests in the P1 test files.)_ | P0 | ~31 unit, ~22 component |
| **P2 — Customers** | `CustomerAttachDialog` (search, pick, detach), `CustomerCreateForm` (inline create, NIC 409 → offer existing); customer shown in terminal; `customersService`. | P0 (Q13 backend tweak optional) | 8 unit, 12 component |
| **P3 — Payment entry** _(revised P3; serialized lines shipped in P1, see P1-5)_ | `addPayment` / `removePayment` in `salesService`; payment thunks through the serial mutation queue (pending row on add, optimistic remove); `toCents` / `fromCents`; Totals panel Paid + Balance due rows, "Pay LKR X" button + F4, "Ready to complete" state; `PaymentDialog` (method picker with keys 1–5, amount defaults to balance due) with `CashFields` (cash received, live change in cents) and `ReferenceFields` (required reference for CARD, BANK_TRANSFER, KOKO, MINTPAY); multi-tender by reopening the dialog; `PaymentsList` with remove (no edit, no confirm). No TRADE_IN (P4), no complete (P5). See §8 P3 decision log. | P1 | ~10 unit, ~20 component |
| **P4 — Trade-in** _(revised P4)_ | TRADE_IN as method 6 in `PaymentDialog` (see §8 P4 decision log). Built in five steps, each a checkpoint: **A.** `methods.js` key 6; `paymentSchema` tradeIn branch (value ≤ balance, IMEI shape, resale > 0, no duplicate IMEI on the sale); `buildPaymentPayload` sends `amount = trade_in_buying_price`; the pending payment row carries the `trade_in_*` fields and the trade-in selectors count pending rows. **B.** `TradeInFields`: product combobox (P4-3), IMEI with Enter → next field and the Luhn hint (P4-7), trade-in value, resale price, notes; Amount swapped for Trade-in value; 3×2 picker; 409 messages by `existing_unit.status`. **C.** No-customer flow (P4-2: inline panel, attach then reopen, F6); Change / F3 guard (P4-11). **D.** PaymentsList TRADE_IN row (P4-8, P4-9); TRADE_IN-only remove confirm (P4-10). **E.** Planning-doc touch-ups and FOLLOWUPS entries. The P2 Detach guard stays as built (Q19); P4 adds Change / F3. Trade-in IMEI 409 at add only: complete-time 409s are P5. Buy-back needs no P4 work (#27). | P1, P2, P3; backend #27 | 8 unit, 12 component |
| **P5 — Recent sales + void** | `/pos/sales` list (paginated, today/branch), `/pos/sales/:id` detail; `VoidSaleDialog` (Q15) gated by `VOID_SALE`; resold-trade-in 409 message, and the taken-back-later 409 from #27 (B4, §1 #16) _(revised P4)_. | P1 | 6 unit, 12 component |
| **P6 — Keyboard, discounts, polish + E2E** | Full §6 hotkey map with `Kbd` chips on pointer devices, `KeyboardHelpOverlay`, scan queue hardening, focus-return audit (keyboard) and no-auto-focus check (touch); stock warning (Q1); line discounts with `APPLY_DISCOUNT` granted to cashiers (Q11); merge on rescan: a non-serialized product already in the cart increments the existing line's qty instead of adding a new line _(added P3)_; user-friendly error mapping for network/raw errors in cart and payment messages (e.g. "Network Error") _(added P3)_; Playwright smoke flows: cash sale, split tender, serialized + trade-in sale, void — each at a desktop viewport, with the cash sale and trade-in also at a 390 px mobile viewport. | P0–P5 | 10 unit, 10 component, 6 e2e |
| **Total** | | | **~83 unit, ~90 component, ~6 e2e** |

**Backend prerequisites (small, separate PRs):** Q13 (customer relation on `findOne`) lands before P0. Optional later: Q9(b) cashier IMEI lookup.

---

## 10. Deferred scope

Not in Phase 6.4:

- **Parked / held sales** (multiple open carts per cashier) — **Phase 6.5**.
- **Receipts:** thermal printing, PDF, SMS/WhatsApp receipt — **Phase 6.6**. 6.4 shows an on-screen summary only.
- **External-sourcing settlement** (friendly-shop payables, `Supplier.getSalesCount` UI) — **Phase 6.7**. Selling external-supplier lines is R1.1 per Q12.
- **User management frontend** (create/edit users, roles, branch assignment, password change) — **Phase 6.8**.
- **AWS deployment** — **Phase 6.9**.
- **Phone purchase intake screen** (`POST /phone-purchases`, buying a phone outright, not as a trade-in) — backend exists; frontend deliberately not in 6.4 (confirmed).
- **Customer management pages** (full CRUD list, soft delete/restore) — only inline search/create inside the terminal ships.
- **Product-unit admin browser** (`/product-units` list/detail).
- **Refunds / partial returns** (void is all-or-nothing; customer-return flow is a backend followup).
- **Payment edit** (`PATCH` payments, including inline CASH edit; reaffirmed in P3-1), sale-level notes, recent-sales filters beyond today — R1.1.
- **Camera barcode/IMEI scanning** — not planned; the shop uses a hardware scanner (Q22).
- **Offline mode**, multi-language UI, cash drawer integration, card-terminal integration, customer-facing display.
- **Multi-branch scoping** of reads (R9).
