# Phase 6.4 — POS Terminal (Frontend) — Planning

**Status:** P0 (#18), P1 (#20), P2 (#21), P3 (#26) and P4 (#30) shipped. P4's backend prerequisites shipped in #27 (buy-back) and #29 (a trade-in or phone purchase needs the customer's NIC, P4-13). P5 (complete sale, confirmation panel, printed receipt) is planned in the §8 "P5 decision log" and built on `feature/phase-6.4-p5-complete` (steps A–F); its backend PRs are merged: #32 (step 0), #33 (a warranty period per sale line, P5-18) and #34 (No warranty, the Price each discount and line money in cents, P5-19, P5-20). Line discounts moved into P5 (P5-20). P5 shipped in #35. Recent sales, sale detail and void move to P6 (P5-15). **P6 (recent sales, sale detail, reprint, void with a manager PIN) is done**: planned in the §8 "P6 decision log", shipped in backend #38 (step 0a) and #39 (step 0b) and the frontend branch `feature/pos-p6-frontend` (steps A–E); what shipped and what changed while building is in §8 "P6 as built". **Returns and refunds become P7** (P6-24); keyboard, polish and E2E move to **P8**. **P7 (returns and refunds) is planned** in the section 8 "P7 decision log" (P7-1 – P7-26): three backend PRs first, in order 0c (global lock order), 0a (the INSPECTION status) and 0b (returns), then frontend steps A–G. Decisions that changed while building are recorded in the §8 "P1 decision log", "P3 decision log", "P4 decision log", "P5 decision log", "P6 decision log" and "P7 decision log", and the sections they touch are marked "revised P1", "revised P3", "revised P4", "revised P5", "revised P6" or "revised P7".

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
| 6 | **Line discount** _(revised P5, see §8 P5-20)_ | Price adjustment | Per line, a **percent** off or a final **price each** (`{ discount_type: PERCENT|UNIT_PRICE, discount_value }` via `PATCH .../lines/:lineId`; both `null` removes it). `LineDiscountDialog`, opened by the line's Discount button or `D` on the focused row. All roles may discount, with no limit (Q11): `APPLY_DISCOUNT` is granted to the cashier role. AMOUNT stays in the API but the till doesn't offer it. | R1 |
| 7 | **Customer attach** | Link the sale to a customer | Search `GET /customers?search=` by name/phone/NIC; pick one, or create inline (`POST /customers` with name, phone, optional NIC), then `PATCH /sales/:id { customer_id }`. Detach sets `null`. Detach, Change and F3 are blocked while a TRADE_IN payment (recorded or pending) exists, with the tooltip "Remove the trade-in payment first" _(revised P4, see §8 P4-11)_. NIC stays optional on the customer, but a trade-in needs it (P4-13). | R1 |
| 8 | **Payment entry — CASH** | Take cash | Amount defaults to remaining balance; cashier types cash received; change is shown live. Sends `{ payment_method: CASH, amount, cash_received }`. | R1 |
| 9 | **Payment entry — CARD / BANK_TRANSFER / KOKO / MINTPAY** | Take reference-based tenders | Same dialog, method switch hides cash-received and shows a required reference number (auth code / slip ref / provider txn id). | R1 |
| 10 | **Payment entry — TRADE_IN** _(revised P4, see §8 P4 decision log)_ | Accept a used phone as part payment | Method 6 in the `PaymentDialog` (F6 opens it pre-selected). Requires a customer on the sale: without one, the dialog offers **Attach customer** and comes back to TRADE_IN afterwards. The customer also needs an NIC on file: without one, the dialog asks for it inline (P4-13; the backend enforces it too, #29). Collects the trade-in product (serialized products at the branch, used SKUs first), IMEI, one **Trade-in value** field (sent as both `amount` and `trade_in_buying_price`, empty by default, capped at the balance due), an optional resale price and condition notes. The customer pays the difference; there is no payout or store credit. A phone the shop sold earlier can be traded back in (buy-back, #27). 409 when the IMEI is a phone the shop holds (`IN_STOCK` / `WRITTEN_OFF`). | R1 |
| 11 | **Payment list + remove** | Correct mistakes | Payments panel lists tenders with remaining balance. Remove = `DELETE .../payments/:id`, with no confirm (P3-2), **except TRADE_IN, which confirms** _(revised P4, see §8 P4-10)_. Edit is not exposed (remove + re-add, reaffirmed in P3-1); TRADE_IN is frozen server-side anyway. | R1 (edit: R1.1) |
| 12 | **Complete sale confirmation** _(revised P5, see §8 P5 decision log)_ | Commit the sale | A **Complete sale** button replaces the Totals panel's Ready box (P5-3), plus **F9** (P5-4); both need a fully paid sale and no mutation in flight. The confirm dialog shows total, tenders and change due, and refreshes branch stock first: a shortfall is listed and blocks Complete (P5-6). `POST /sales/:id/complete`, at most once (P5-7). Errors stay in the dialog, with the offending line or trade-in payment highlighted and the NIC field inline for #29's 400 (P5-8). Success shows the in-terminal "Sale complete" panel (P5-9) while the next DRAFT is created in the background (P5-10). | R1 |
| 12a | **Printed receipt** _(added P5; was Phase 6.6, see §10)_ | Give the customer a receipt at every sale | An 80mm receipt (Xprinter XP-80T, USB, Windows driver) printed with `window.print()` from a print-only layout (P5-11, P5-13). Prints automatically on complete; **Reprint** on the Sale complete panel and **Reprint last receipt** on the Current sale card until the next sale completes (P5-12). Silent printing via Chrome/Edge `--kiosk-printing` on the till (P5-16, `docs/frontend/pos-till-setup.md`). Each line prints its warranty (P5-18, P5-19) and its discount (P5-20). No ESC/POS, no cash drawer. | R1 |
| 13 | **Discard draft** | Abandon a cart | `DELETE /sales/:id` behind a confirm. Also offered when starting a new sale with a non-empty draft. | R1 |
| 14 | **Recent sales list** _(P6, revised P5, P6)_ | Look up the branch's sales | `/pos/sales`: the branch's COMPLETED and VOIDED sales for one Colombo day (today by default, a day stepper for other days), by `completed_at`, newest first (P6-2); one search box over sale number, customer name/phone and IMEI, across all dates (P6-3). Rows: time, sale number, customer, cashier, total, status (P6-5). Opened by the header's **Sales** button or Alt+R (P6-1). | R1 |
| 15 | **Sale detail (read-only)** _(P6, revised P5, P6)_ | Inspect a completed/voided sale | `/pos/sales/:id`: lines (IMEI, discount, warranty with its end date and an "expired" tag), tenders (incl. trade-in resale price and notes), totals, customer (no NIC), cashier; when voided, who voided it, when, why, and who approved it (P6-6). Hosts **Reprint receipt** (marked "REPRINT"; a voided sale prints "VOIDED — NOT VALID", P6-7) and **Void**. | R1 |
| 16 | **Void sale flow** _(P6, revised P4, P5, P6)_ | Reverse a completed sale made by mistake | `VoidSaleDialog`: preset reason (+ detail), what the void puts back, what to hand back to the customer (outside the system until P7), then Void. **Every void is approved with a manager's or admin's PIN**, on every session: a manager or admin on their own session enters their own PIN (or picks another approver); a cashier's till needs a manager or admin to enter theirs (P6-8, P6-15 – P6-21). The resold-trade-in and taken-back 409s name the later sale; a phone bought back on a later phone purchase blocks the void for good (P6-11, P6-22). No time limit (P6-23). Returns are not voids: P7. | R1 |
| 16a | **Approval PIN** _(added P6)_ | A manager or admin approves every void | Per-user 6-digit PIN, hashed; each manager or admin sets their own from the user menu (current password required); an admin can clear one but never sets one; lockout after 5 wrong PINs, stored in the database; audited; reused by P7 returns (P6-15 – P6-21). | R1 |
| 16b | **Returns and refunds** _(added P6, see §8 P6-24; revised P7, see section 8 P7 decision log)_ | Take back some or all items of a sale, days later | **P7**: Return items (R) on Sale detail opens `ReturnDialog`. Partial returns linked to the original sale lines, up to the quantity sold (P7-2); refund up to what was paid for those units, lowerable (P7-3), in cash or back to a non-cash payment of the sale (P7-4); non-phone items Back to stock or Damaged (P7-8); phones to INSPECTION until a manager passes them on **Phones to check** (P7-6, P7-7); a line outside warranty needs an override reason (P7-22, P7-23); every return approved with a manager's or admin's PIN (P7-9); a two-copy return slip (P7-17). A sale with a return can't be voided (P7-11). | R1 (P7) |
| 17 | **Keyboard help overlay** | Discoverability | `?` / F1 opens a cheat sheet of the shortcuts in §6. Hidden on touch-only devices. | R1 |
| 18 | **External-supplier (friendly-shop) lines** | Sell stock sourced from another shop | `addLine` with `external_supplier_id` (+ free-text IMEI for serialized). | **R1.1** (Q12) |
| 19 | **Sale-level notes** | Free-text on the sale | `PATCH /sales/:id { notes }`. | **R1.1 candidate** |
| 20 | **Payment edit** | Fix an amount without remove + re-add | `PATCH .../payments/:id`. Kept out of P3 (P3-1), including inline CASH edit. | **R1.1** |
| 21 | **Recent sales filters beyond "today"** _(revised P6)_ | Historic lookup | Date range, status, cashier filters on the list. The day stepper and the all-dates search ship in P6 (P6-2, P6-3). | **R1.1** |

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

Later slices add payment, completion (`lastCompleted`) and customer state to this slice. _(Revised P5:)_ P5 adds `completing` and `completed` to `status`, the completed sale (`lastCompletedSale`) for the Sale complete panel and the receipt, and a complete error `{ kind, message, status, line_id?, payment_id? }` (P5-7, P5-8).

**Optimistic updates: `addLine` only** _(revised P1, 2026-10-15; see §8 P1 decision log)_. Dispatching `addLine` shows a pending row at once (product name and catalog price, a spinner in place of the line total, controls disabled). The server's hydrated sale replaces it on success; on failure the row is removed and the error shows under the scan bar. **Totals are never optimistic:** the Totals panel shows the server's figures and dims with "Updating…" while any line mutation is in flight. Qty edits and removals aren't optimistic either: the row is dimmed ("busy") until the server answers, and the reducer replaces `draftSale` wholesale. The original reasoning still holds for money: totals, discounts, rounding and line numbers are computed server-side, and a wrong total at a till is worse than a short wait. The pending row only acknowledges the scan at once. Line mutations run one at a time through a queue in the slice, so fast scans reach the server in order and an older response can't overwrite a newer sale.

**Payments** _(revised P3, see §8 P3-5)_. `addPayment` shows a pending row (method and amount, dimmed) that the server sale replaces, or that is removed on failure. `removePayment` hides the row at once and restores it if the call fails. Totals stay server-only, with the same "Updating…" dim. Payment calls go through the same queue as line and customer edits, so they can't race the cart.

**Server ↔ client sync:**

- **A DRAFT is created when the terminal opens** _(revised P1, 2026-10-15; see §8 P1 decision log)_. On mount, `ensureDraftSale` resumes the stored draft or calls `POST /sales { branch_id }`, so the first scan never waits on a create. The cost is one empty DRAFT per terminal session that never gets an item. "New sale" discards with `DELETE /sales/:id` (behind a confirm; disabled while the cart is empty) and opens a fresh one. Concurrent opens (StrictMode, re-renders) are deduplicated with a thunk `condition`.
- After each mutation the client holds exactly what the server returned. Line/payment `DELETE` (204) is followed by `GET /sales/:id`. `PATCH /sales/:id` (customer attach/detach) returns the hydrated sale, including the new `customer`, and replaces the held sale like any other mutation.
- If any call returns 400 "Only DRAFT sales are mutable" or 404, the client drops the draft and shows "This sale is no longer open" (another tab or user completed/discarded it).

**Page reload mid-sale:**

1. On terminal mount, read `draftSaleId` from `terminalSessionStore`.
2. `GET /sales/:id`. If DRAFT and same branch → restore (the customer comes with the sale). If COMPLETED/VOIDED/404, or a different branch → clear the pointer and start fresh. A network or 5xx error does **not** start a fresh draft; the terminal shows "Try again". (Known gap: switching branch leaves the old DRAFT orphaned; see FOLLOWUPS.)
3. Pointer is cleared on complete, discard, and logout. _(Revised P5:)_ on complete it moves to the next DRAFT, created in the background (P5-10), and `terminalSessionStore` also persists `lastCompletedSaleId` for "Reprint last receipt" (P5-12), cleared on logout like the pointer.

Alternative (no local pointer) is in §8 Q8.

---

## 4. Routing structure

| URL | Component | Layout | Guard |
|-----|-----------|--------|-------|
| `/login` | `LoginPage` (existing) | none | public. Post-login redirect: cashier → `/pos`, others → `/dashboard` |
| `/pos` | `pages/PosTerminal` | `TerminalLayout` (full-screen, no sidebar — see Q7) | `ProtectedRoute` → `RoleProtectedRoute [admin, manager, cashier]` → `BranchContextGuard` |
| `/pos/sales` | `pages/PosRecentSales` | `TerminalLayout` | same as `/pos` |
| `/pos/sales/:id` | `pages/PosSaleDetail` | `TerminalLayout` | same; Void for every role; every void needs a manager's or admin's PIN in the dialog, the session user's own on a manager's or admin's session _(revised P6, see §8 P6-8, P6-17)_ |

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
- **Mutations: never auto-retried.** `POST .../payments` and `POST .../complete` are not idempotent; a retried payment after a lost response could double-record a tender. On a network error during a mutation, the client re-fetches `GET /sales/:id` and shows the real state ("Connection lost — here is what the server has"). _(Revised P5:)_ `POST .../complete` gets its own 30 s timeout and the same re-fetch: a COMPLETED sale is treated as success (P5-7). There is no global axios timeout (FOLLOWUPS).

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
- Function-key shortcuts call `preventDefault()`, on every press, also when the shortcut does nothing at that moment (otherwise the browser's own action runs: F6 would move focus to the address bar). Verified for F6 in real Chrome 155 and Edge 155 with an OS-level keystroke _(P4-14)_. **Never bound:** F5 (reload), F11 (fullscreen), F12 (devtools), Ctrl+W/T/N/R (browser-reserved).
- Shortcuts are suppressed while a dialog is open except that dialog's own keys.
- Destructive actions (discard, void) always go through a confirm dialog; Enter confirms, Esc cancels. **Exception: removing a non-trade-in payment has no confirm** _(revised P3, see §8 P3-2; narrowed P4, see §8 P4-10)_. It only affects a DRAFT, and re-adding is one keystroke. Removing a TRADE_IN payment does confirm ("Remove trade-in? You'll need to re-enter the phone details."), because re-adding means re-entering the product, IMEI and prices.

**Barcode scanners:** USB/Bluetooth scanners in HID mode type characters quickly and send Enter. The scan input treats Enter as "submit this value": try exact barcode (`by-barcode`), then catalog name/SKU search. No keystroke-timing heuristics in R1 (a typed SKU + Enter behaves the same as a scan, which is fine). While an `addLine` is in flight, further Enter submissions are **queued in order** and processed sequentially so fast consecutive scans aren't lost or reordered.

| Screen | Key | Action |
|--------|-----|--------|
| Terminal (global) | F2 | Focus scan input |
| | F3 | Customer attach dialog (ignored while a TRADE_IN payment holds the customer, P4-11) |
| | F4 | Payment dialog (method defaults to CASH) |
| | F6 | Payment dialog with TRADE_IN selected (same rule as F4: Pay enabled, no other dialog open); with no customer on the sale, the customer attach dialog first, then the payment dialog _(revised P4, see §8 P4-1, P4-2, P4-14)_ |
| | F9 | Complete sale: opens the confirm, under the same rule as the Complete sale button (fully paid, nothing in flight, no other dialog open). Every F9 is prevented (Edge's F9 opens Immersive Reader); verified with an OS-level keystroke at the start of P5 step B, F10 as the fallback _(revised P5, see §8 P5-4)_ |
| | Ctrl+Delete | Discard draft (confirm) |
| | F1 or `?` (when not typing) | Keyboard help overlay |
| | Alt+R | Recent sales (P6). Verified with an OS-level keystroke in Chrome 155 and Edge 155 at the start of P6 step B: the page gets it, no fallback needed _(revised P6, see §8 P6-1)_ |
| | Esc | Close dialog / clear scan input / return focus |
| Scan input | Enter | Look up and add |
| | ↓ / ↑, Enter | Navigate / pick from search results |
| Cart | Alt+↑ / Alt+↓ | Move line selection |
| | `+` / `-` | Qty ±1 on selected non-serialized line |
| | Delete | Remove selected line (confirm) |
| | `D` | Discount on the focused line: opens `LineDiscountDialog` (if permitted; every role is, Q11) _(built P5, see §8 P5-20)_ |
| IMEI prompt | Enter | Submit IMEI |
| Payment dialog | 1–6 | Pick method (CASH, CARD, BANK_TRANSFER, KOKO, MINTPAY, TRADE_IN). 1–5 shipped in P3; **6 = TRADE_IN** in P4 _(revised P4)_ |
| | Tab | Amount → cash received / reference → submit. TRADE_IN: product → IMEI → trade-in value → resale price → notes → submit _(revised P4)_ |
| | Enter | Record payment. **Exceptions:** Enter in the trade-in IMEI field moves focus to the next field instead of submitting, because a scanner sends Enter after the IMEI _(revised P4, see §8 P4-7)_; Enter in the trade-in product combobox picks the highlighted product and moves to the IMEI; Enter in the customer-NIC field saves the NIC (P4-13) |
| Payments panel | Alt+P then ↑/↓, Delete | Select and remove a payment (TRADE_IN asks to confirm, P4-10). Alt+P is P8 (was P6, revised P5; was P7, revised P6); P4 ships the remove buttons |
| Remove trade-in confirm | Enter / Esc | Remove (focused on open) / keep _(P4-10)_ |
| Complete confirm | Enter / Esc | Complete (focused on open) / back. Disabled while completing, and while a stock shortfall is listed (P5-6) _(revised P5)_ |
| Sale complete panel | Enter (empty scan bar) or any scan | Start next sale; a scan also adds that item to the next draft. Reprint is a button, no hotkey _(revised P5, see §8 P5-9, P5-10)_ |
| Customer dialog | type → ↓/↑ → Enter | Search and pick; Ctrl+N new customer |
| Recent sales (P6) | ↑/↓, Enter | Open sale; Esc back to terminal _(revised P6)_. `/` focuses the search box; ←/→ (outside the search box) step the day |
| Sale detail (P6) | P | Reprint receipt (marked "REPRINT", P6-7) _(added P6)_ |
| | V | Void: opens `VoidSaleDialog`, which always asks for a manager's or admin's PIN; on their own session the approver defaults to them (P6-17, P6-20) _(revised P6)_ |
| | Esc | Back to the list |
| Void dialog (P6) | 1–6 | Pick a reason preset; Enter voids once the reason, the approver and the PIN are valid; Void is never focused on open _(added P6, see §8 P6-10)_ |

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
    TradeInProductPicker                 # (P4) the product combobox (P4-3)
    TradeInCustomerPanel                 # (P4) "needs a customer" / "needs the customer's NIC" (P4-2, P4-13)
    tradeIn.js                           # (P4) shared trade-in helpers and copy
  PaymentsList/                          # (revised P3, P4) tenders list + remove (no edit; confirm for TRADE_IN only)
  RemoveTradeInDialog/                   # (P4) the TRADE_IN remove confirm (P4-10)
  TotalsPanel/                           # (revised P5) Complete sale button replaces the Ready box (P5-3)
  CompleteSaleDialog/                    # (P5) confirm + stock re-check + complete errors (P5-5, P5-6, P5-8)
  SaleCompletePanel/                     # (P5) replaces cart + right column after complete (P5-9)
  Receipt/                               # (P5) the 80mm print-only layout (P5-11), rendered into #receipt-root
  LineDiscountDialog/                    # (P5) percent / price each for one cart line (P5-20)
  RecentSalesTable/                      # P6: rows + day stepper + search (P6-2, P6-3, P6-5)
  SaleDetailView/                        # P6: lines, tenders, totals, void banner (P6-6)
  VoidSaleDialog/                        # P6: reason presets, effects, approval (P6-9, P6-10, P6-17)
  ManagerApprovalFields/                 # (P6) approver select + PIN; reused by P7 returns (P6-17)
  ApprovalPinDialog/                     # (P6) set / change your approval PIN, from the user menu (P6-18)
  KeyboardHelpOverlay/
pages/PosTerminal/  pages/PosRecentSales/  pages/PosSaleDetail/
services/salesService.js  services/customersService.js  services/approvalsService.js   # (P6) approvers list, PIN set
utils/colomboDay.js                      # (P6) a Colombo day → ISO bounds with +05:30 (P6-2)
utils/voidErrors.js                      # (P6) classify void errors V1–V8 and PIN errors (P6-11, P6-19)
store/slices/posTerminalSlice.js                 # (revised P1) no posCatalogSlice: hybrid loading, §5
store/zustand/terminalSessionStore.js
hooks/useTerminalBranch.js  hooks/useMediaQuery.js     # hotkeys: useHotkeys from react-hotkeys-hook (Q17)
schemas/paymentSchema.js  schemas/customerSchema.js  schemas/voidSchema.js
utils/money.js                           # formatLKR (P1); toCents / fromCents (P3: balance and change math in integer cents)
utils/device.js                          # isTouchOnly (P1)
utils/imei.js                            # Luhn check for the trade-in IMEI hint (P4-7)
utils/completeErrors.js                  # (P5) classify complete errors E1–E12 into kinds (P5-8)
utils/printReceipt.js                    # (P5) measure the receipt, set @page size, window.print() (P5-13)
constants/receipt.js                     # (P5) shop texts, terms, footer and print layout (P5-14)
constants/warranty.js                    # (P5) warranty periods and labels, No warranty first (P5-18, P5-19)
utils/receipt.js                         # (P5) receipt wording: amounts, Colombo date, warranty and discount labels
utils/discount.js                        # (P5) discount labels and the dialog's preview, in the server's cent math (P5-20)
```

**Payment modal composition:** one `PaymentDialog` owns method selection, amount, and submit; the method-specific fields are child components selected by method. Each child exports its zod schema fragment, and the dialog builds a discriminated union (`z.discriminatedUnion("payment_method", [...])`) mirroring the backend rules (CASH needs `cash_received >= amount`; reference methods need `reference_number`; TRADE_IN needs product, IMEI, buying price = amount, and a customer on the sale). Client validation is a convenience; the server stays authoritative.

**TRADE_IN in the dialog** _(revised P4, see §8 P4 decision log)_. `TradeInFields` replaces the generic Amount field with one **Trade-in value** field; `buildPaymentPayload` sends it as both `amount` and `trade_in_buying_price`. Field order: Product → IMEI → Trade-in value → Resale price (optional) → Condition notes (optional). The method picker becomes a 3×2 grid (`grid-cols-3 sm:grid-cols-6`). The zod tradeIn branch checks: value ≤ balance due (in cents), IMEI 8–50 letters/digits, resale > 0 when given, and the IMEI not already on another trade-in on this sale. The product combobox is a dialog-local lookup (`GET /products?search&branchId&productType=PHONE&limit=20`, filtered to `is_serialized` on the client). The no-customer panel, the Luhn hint and the 409 messages are in P4-2, P4-7. _As built:_ Product spans the width and IMEI | Trade-in value and Resale | Notes sit in two columns from `sm`, so the empty form is 588px tall and fits a ~640px viewport (P4-1). Trade-in value is its own form field (`trade_in_buying_price`, empty by default), so switching from Cash never carries the balance over (P4-5). Without a customer, or with a customer who has no NIC, `TradeInCustomerPanel` replaces the fields and Record payment is disabled (P4-2, P4-13). The dialog opens on a method via `initialMethod` (F6, and the return from attaching a customer). After a failed submit, focus goes to the first field in error in on-screen order.

**Data flow:** pages and feature components dispatch `posTerminal` thunks and read selectors (`selectSale`, `selectBalanceDue` (was `selectRemaining`; revised P3), `selectCanComplete`, `selectHasTradeInPayment` (was `selectHasTradeIn`; revised P4, and it counts pending TRADE_IN rows too, P4-11), `selectTradeInImeis` (P4-7)); they never call services directly, except dialog-local lookups (customer search, catalog search, trade-in product search). The customer's NIC is saved through the `saveCustomerNic` thunk (P4-13), queued with the sale mutations.

---

## 8. Open design questions

### Decisions (answered 2026-10-12)

Q6, Q9, Q11, Q12 and Q17 were answered explicitly. The rest were not called out, so their recommended defaults are taken as accepted. Say so if any of them should change.

| Q | Topic | Decision |
|---|-------|----------|
| Q1 | Out of stock on add | Default — warn on the line, don't block |
| Q2 | Trade-in entry | Default — TRADE_IN tab in the payment dialog, sectioned; F6 opens it |
| Q3 | Post-sale summary | Default — in-terminal "Sale complete" panel. _Revised P5:_ plus a printed 80mm receipt at every sale, in P5 rather than Phase 6.6 (P5-9 – P5-13) |
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
| Q14 | Test tooling | Default — Vitest + RTL from P0, Playwright in P8 (was P6, revised P5; was P7, revised P6) |
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
| P1-8 | P1 scope | Narrowed to scan bar, cart, totals, draft lifecycle, stock warning and F2/focus. Later slices per the P1 brief: customer attach → P2, payments → P3, TRADE_IN → P4, complete → P5. Line discounts → P2 (FOLLOWUPS; built in P5, revised P5, see P5-20). Mobile sticky action bar → P6 (now P8, revised P5, P6). | §9 P1 row (payments + complete in P1) |
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
| P3-11 | Bottom sheets below `md` (§6) | **Deferred to P8** (was P6, revised P5; was P7, revised P6). The PaymentDialog is a centred modal at every width, like every other dialog in the app; no dialog has the §6 bottom-sheet variant yet. P8 adds it for all terminal dialogs at once. | §6 "Dialogs become bottom sheets below `md`" (for P3) |
| P3-12 | Quick-tender chips (§1 #8) | **Deferred to P8** (was P6, revised P5; was P7, revised P6). The CASH form has no quick-tender chips (Exact / next 500 / next 1,000 / 5,000) in P3. The cashier types the cash received and sees the live change (P3-9); P8 can add chips that fill Cash received. | — |

### P4 decision log (2026-10-17, updated 2026-10-20)

Decisions made before building P4 (TRADE_IN payment), and P4-13 – P4-15 made while building it. Where they differ from the original planning text, the affected sections are marked "revised P4". Rows that changed while building say "_Revised in build:_".

**Business answers (from the shop):**

1. **A trade-in is almost always worth less than the purchase.** The customer pays the difference. There is no payout and no store credit. Buying a phone outright is the separate phone-purchase flow, which is not in 6.4 (§10).
2. **The catalogue has one used-phone product per model and storage** (e.g. "Used iPhone 12 128GB"). Only admins create products. Before go-live, an admin creates the common used-phone models (FOLLOWUPS, Go-live setup).
3. **Buy-backs are common.** Customers often trade in phones they bought from the shop, so P4 must not block an IMEI the shop sold before.

**Backend prerequisite: buy-back (#27).** One ProductUnit row per acquisition, so a SOLD or RETURNED IMEI can be traded in again; only `IN_STOCK` / `WRITTEN_OFF` IMEIs collide (409). #27 also added `trade_in_product` to each TRADE_IN payment on the hydrated sale, requires `trade_in_selling_price` ≥ 0.01 when sent, and rejects inactive trade-in products. Its design decisions (B1–B9) are in the #27 PR and in [used-phones.md](../backend/used-phones.md) § One row per acquisition. The one P5 needs is **B4**: voiding a sale whose phone was later taken back returns 409 "the phone was taken back into stock on a later sale or purchase"; voids unwind newest-first (§1 #16). **RETURNED** means "trade-in reversed by a void; the phone is back with the customer", not a phone the shop holds.

| # | Topic | Decision | Replaces |
|---|-------|----------|----------|
| P4-1 | Where the form lives (Q2, §7) | **`TradeInFields` inside `PaymentDialog` as method 6.** For TRADE_IN the generic Amount field is replaced by one **"Trade-in value"** field that sends both `amount` and `trade_in_buying_price`. Order: Product → IMEI → Trade-in value → Resale price (optional) → Condition notes. The picker becomes 3×2 (`grid-cols-3 sm:grid-cols-6`), checked at a ~640px-tall viewport. _Revised in build:_ to fit that viewport the fields after Product sit in two columns from `sm` (IMEI | Trade-in value, Resale | Notes). Measured with the mocked-API harness: the empty form is 588px and fits 1366×650 and 1526×640. The all-errors state is 644px, so it scrolls 26–36px; at 1526×640 Record payment sits 3px below the fold (accepted). Trade-in value is its own form field, not Amount. | Separate amount and buying-price fields "locked together" (§1 #10) |
| P4-2 | No customer attached (§1 #10) | Picking 6 shows an inline **"Trade-in needs a customer"** panel with **Attach customer**: close the PaymentDialog → open the CustomerAttachDialog → on attach, reopen the PaymentDialog with TRADE_IN selected. **F6** with no customer goes straight into that sequence. | — |
| P4-3 | Picking the product | A combobox over `GET /products?search=&branchId=&productType=PHONE&limit=20`, filtered to `is_serialized` on the client (no server filter), with USED SKUs (`phone_condition === "USED"`) first and a "Used" badge. Empty state: **"No used-phone product for this model. Ask an admin to add one."** No product creation from the till. | — |
| P4-4 | Worth more than the balance | Keep the backend rule (every payment is capped at the balance due). The UI caps Trade-in value at the balance with a clear message ("Trade-in value can't exceed the balance due (LKR X)…"). No payout or credit (business answer 1). _Revised in build:_ the full message is "Trade-in value can't exceed the balance due (LKR X). Add items, or record the phone purchase separately." | — |
| P4-5 | Default value | **Empty**, not pre-filled with the balance: the value becomes the unit's cost. | "Amount defaults to balance due" (P3) for this method |
| P4-6 | Resale price | Optional; > 0 when given (backend ≥ 0.01). A non-blocking warning when it is below the trade-in value. | — |
| P4-7 | IMEI input | One scanner-friendly input. **A scanner's Enter moves focus to the next field instead of submitting** (§6). Hard rule = the backend's (8–50 letters/digits). A 15-digit value failing Luhn gets a soft "Check digit doesn't match — rescan?" hint (non-blocking). Blocked on the client if another trade-in on this sale already has the IMEI. 409 messages by `existing_unit.status`: IN_STOCK "Already in stock"; WRITTEN_OFF needs a manager; `existing_unit: null` → a generic "already in inventory". **No SOLD block: buy-backs are supported** (#27). The null case can't happen when the payment is added (that only pre-checks); it comes from the live-IMEI index at complete. P4 keeps the generic message as a fallback, and the real case is handled with complete-time 409s in P5. _Revised in build:_ the 409 shows on the IMEI field and clears when the IMEI changes: IN_STOCK "Already in stock: the shop holds a phone with this IMEI."; WRITTEN_OFF "This IMEI is on a written-off phone. Ask a manager to check it."; otherwise "This IMEI is already in inventory." The Luhn hint is amber and the payment still records. | — |
| P4-8 | PaymentsList row (§7) | Keep the fixed row heights (stacked `h-18` 72px, table `h-14` 56px). Label "Trade-in"; one detail line `<product name> · <IMEI>`, mono, truncated, with a `title` tooltip. Resale price and notes are not shown (sale detail, P5). | — |
| P4-9 | Product name source | From the hydrated sale: `payment.trade_in_product.name` (#27). _As built:_ a pending row carries the product the cashier picked (same `{ id, name }` shape); with no product on the payment, the row shows the IMEI alone. | — |
| P4-10 | Remove (§6) | **Confirm for TRADE_IN only** ("Remove trade-in? You'll need to re-enter the phone details."). Other tenders keep P3-2's no-confirm; the §6 exception narrows to non-trade-in payments. _Revised in build:_ the confirm (`RemoveTradeInDialog`) also shows the phone (`<product name> · <IMEI>`, wrapped, not truncated) and the trade-in value. Remove is focused on open (Enter confirms, Esc keeps). After a removal focus returns to the scan bar; after Keep, to the row's remove button. The removal itself stays optimistic (P3-5). | P3-2 for TRADE_IN rows |
| P4-11 | Customer guard (Q19, §1 #7) | Keep P2's Detach guard and **also guard Change (and F3) while a trade-in exists** (#22 rejects reassignment as well as detach on the backend). `selectHasTradeInPayment` counts pending TRADE_IN rows too. _Revised in build:_ both buttons use `aria-disabled` with the tooltip "Remove the trade-in payment first" (was "Remove TRADE_IN payment first" on Detach). | Detach-only guard (P2) |
| P4-12 | Not in P4 | Payout or store credit; creating products from the till; editing a trade-in (it's frozen: remove and re-add); the phone-purchase intake screen (§10); complete-time 409 handling (P5); condition fields or photos beyond free-text notes. Buy-back needs no P4 work: it is an ordinary trade-in. | §9 P4 row ("409 at add and complete") |
| P4-13 | Customer NIC (decided 2026-10-20) | **A trade-in needs the customer's NIC**, so a phone that turns out to be stolen can be traced to whoever handed it over. Picking Trade-in for a customer without an NIC shows "Trade-in needs the customer's NIC" with an inline NIC field and Save NIC (`PATCH /customers/:id`, 5–20 characters; another customer's NIC shows inline); the trade-in fields replace it once saved. NIC stays optional on customers otherwise. **Backend enforces it too (#29):** `addPayment` TRADE_IN, `completeSale` (once per sale, before materializing; rolls back) and `POST /phone-purchases` return 400 without an NIC. | NIC optional everywhere |
| P4-14 | F6 in the browser | **Verified 2026-10-20:** a page can intercept F6. With an OS-level F6 (not a simulated one) in Chrome 155 and Edge 155, `preventDefault()` on keydown kept focus in the page; without it, focus went to the address bar. Every F6 is prevented, also when it does nothing (no fallback key needed). Firefox not tested. | — (a fallback such as F4 then 6 was the plan if F6 couldn't be intercepted) |
| P4-15 | Trade-in row at phone width | **Kept as P4-8.** In the stacked layout (390px) a long product name truncates the detail line before the IMEI ("Used iPhone 12 Pro …"). Accepted: the till is a desktop, the remove confirm shows the full phone, and so will P6's sale detail _(revised P5)_. | — (option: IMEI first in the stacked layout) |

### P5 decision log (2026-10-20)

Decisions made before building P5 (complete sale, confirmation, receipt). Where they differ from the original planning text, the affected sections are marked "revised P5".

**Business input (from the shop):**

1. **Customers expect a printed receipt at every sale**, so receipts are in P5, not Phase 6.6 (§10, Q3).
2. **Printer: Xprinter XP-80T**, 80mm paper, USB (it also supports Bluetooth and LAN). **No cash drawer.**
3. **Browser printing through the Windows driver:** a print-only 80mm layout and `window.print()`. No ESC/POS, no WebUSB. Auto-cut comes from the driver setting; silent printing from Chrome/Edge `--kiosk-printing` on the till (documented, no code).

**What `completeSale` does today (P5 recon).** `POST /sales/:id/complete` has no body and returns 200 with the hydrated sale (`status`, `sale_number`, `completed_at`, branch, cashier, customer, lines, payments). One transaction: lock the sale row → DRAFT check → at least one line → `amount_paid = total` in cents → per line, stock decrement then unit → SOLD → trade-in customer and NIC checks → trade-ins become stock → sale number → COMPLETED. Any failure rolls back everything, including the sale number. The sale number is `INV-YYYYMMDD-NNNN` on the Colombo date of completion, unique **per branch**. Because the sale row is locked first, a second complete waits, then sees COMPLETED and gets 400: the sale completes at most once and stock is never decremented twice. The errors, with the step-0 changes:

| # | Cause | Status and message | After step 0 |
|---|---|---|---|
| E1 | Sale not found | 404 `Sale not found` | — |
| E2 | Not a DRAFT | 400 `Cannot complete a COMPLETED sale. Only DRAFT sales can be completed.` (or VOIDED). Not matched by the slice's "gone" check | — |
| E3 | No lines | 400 `Cannot complete a sale with no lines…` | — |
| E4 | Paid ≠ total | 400 `Cannot complete sale: amount_paid X does not equal total Y` | — |
| E5 | Not enough stock (first short line only) | 409 `Insufficient stock for "<name>": requested N, available M` | + `product_id` (and `line_id` if cheap) |
| E6 | A line's phone is no longer IN_STOCK (another draft sold it) | 409 `Cannot sell IMEI '<imei>'…` + `existing_unit` (its `id` is the line's `product_unit_id`) | — |
| E7 | Trade-in with no customer | 400 (can't happen since #22) | — |
| E8 | Trade-in customer has no NIC (#29) | 400 `A trade-in needs the customer's NIC` | — |
| E9 | Trade-in product deactivated since it was added | 400 `Product <uuid> not found or inactive` | Product name instead of the UUID |
| E10 | Trade-in IMEI now held by the shop (pre-check) | 409 `IMEI already exists in inventory` + `existing_unit` | + `imei`, `payment_id` |
| E11 | Same, caught by the live-IMEI index | 409, same message, `existing_unit: null` | + `imei`, `payment_id` |
| E12 | Deadlock (40P01, FOLLOWUPS) or data-integrity error | 500 | — |

**Backend prerequisite: step 0, one micro-PR before P5 is built** (P5-1, P5-2). It also corrects two wrong statements found in recon: the comments at `sales.service.ts` `completeSale` step 4 and `SaleNumberCountersService.generateNext` say a rollback "burns" a sale number (it doesn't: the counter is in the same transaction, as `sales.md` says), and `docs/backend/sales.md` says a repeated complete would decrement stock twice (the DRAFT check returns 400).

| # | Topic | Decision | Replaces |
|---|---|---|---|
| P5-1 | Warranty on the receipt (backend) | **Snapshot at complete.** New nullable `sale_lines.warranty_months_snapshot` and `checking_warranty_days_snapshot` (migration with up/down). Inside the `completeSale` transaction, each line's product is read in the per-line loop and both values are copied onto the line, so the sale records exactly what applied when it was sold, and drafts that already exist are covered. No backfill: sales completed before the migration keep null, and the receipt prints no warranty for null or 0. _Shipped in #32, then replaced by P5-18 (#33): one warranty code per line, chosen at the till, with `warranty_until` set at complete._ | — (warranty was on Product only and not in the sale response) |
| P5-2 | Complete-time 409 details (backend) | In the same micro-PR: the trade-in 409s (E10, E11) gain `imei` and `payment_id`; the insufficient-stock 409 (E5) gains `product_id`, and `line_id` if it is cheap to pass; E9 names the product instead of its UUID. | — |
| P5-3 | Complete control | A **"Complete sale"** button replaces the Totals panel's Ready box, in the same place as Pay. "Paid in full · change due X" stays as a line above it. Same rule as Pay (P3-7): an open, fully paid draft with nothing in flight; while syncing it dims. | P3-7's Ready box (no button) |
| P5-4 | Hotkey | **F9**, as §6 reserved it, under the button's rule. Every F9 is `preventDefault`-ed: Edge opens Immersive Reader on F9 (Firefox has Reader View). Verified with an OS-level F9 in Chrome and Edge at the start of step B, as P4-14 did for F6; **F10** if F9 can't be intercepted. | — |
| P5-5 | Confirm before completing | **Yes.** `CompleteSaleDialog` shows total, the tenders and change due; Complete is focused on open (Enter completes, Esc goes back). F9 → Enter is two keys, and undoing a completed sale needs a manager's void. | — |
| P5-6 | Stock check before completing | Opening the confirm refreshes branch stock (one `GET /stock?branchId=`, `refreshCartStock`). A shortfall is listed in the dialog ("<name>: N needed, M in stock") and **disables Complete**, with **Check again**. The server would return 409 for it anyway. If the lookup fails, Complete stays enabled and the 409 is the guard. This is the first place stock blocks anything: adding still only warns (Q1). | Q1 "warn, don't block" (at complete only) |
| P5-7 | Double-submit and lost responses | **No backend change.** A `completing` status disables the button and F9, and the thunk's `condition` refuses a second run. The complete goes through the mutation queue, after any queued edits. A 30 s timeout on this request only. On a network error, timeout, 5xx or E2, the client re-fetches `GET /sales/:id`: COMPLETED → success (panel and receipt from that sale); DRAFT → the error with "Try again" (safe: nothing was saved); VOIDED or 404 → the existing "gone" banner. | — (no idempotency key) |
| P5-8 | Complete errors | Shown **in the confirm dialog, which stays open**; `utils/completeErrors.js` classifies them. **E5:** "Not enough stock: <name> (requested N, available M)", the cart's stock badges refreshed, and **Close and fix cart**. **E6:** that line highlighted, "Phone <IMEI> was sold on another sale. Remove the line." **E8:** the P4-13 NIC field inline (shared with `TradeInCustomerPanel`); saving it re-enables Complete. **E10/E11:** the trade-in row (by `payment_id`) highlighted in PaymentsList, "This trade-in phone (<IMEI>) is already in stock. Remove the trade-in and check the phone." **E9:** "The trade-in product <name> was deactivated. Remove the trade-in and re-add it." **E3/E4/E7:** re-fetch the sale and show a generic message. **E12:** "Couldn't complete. Nothing was saved. Try again." Highlights stay until the next cart or payment change. | §1 #12 "409s show inline" (no detail) |
| P5-9 | Sale complete panel | **`SaleCompletePanel` replaces the cart and the right column**; the scan bar stays live and focused (a modal would trap focus and break "any scan starts the next sale"). Content: "Sale complete", sale number and time, **Change due** largest (when there is cash change), total, paid, the tenders (up to 4 rows, then "+N more"), the customer, **Reprint receipt** and **Next sale (Enter)**. Measured with the mocked-API harness at 1366×650 and 1526×640 (Q23). | — |
| P5-10 | Next sale | **The next DRAFT is created in the background** as soon as complete succeeds, and the pointer moves to it (as P1-2: the first scan never waits for a create). Enter in the empty scan bar, Next sale, or **a scan** closes the panel; a scan also adds that item to the new draft. If the create fails, the panel shows "Try again" in place of Next sale. | — |
| P5-11 | Receipt content | **Header:** shop name, branch name, address and phone (null ones skipped). Invoice number, date and time (Colombo), cashier, customer name and phone with the middle digits masked; **no NIC**. **Lines:** name; IMEI for phones; `qty × price` and line total; discount when non-zero; "Warranty 12 months · Checking 7 days" when non-zero (P5-1). **Totals:** subtotal, discount, **TOTAL**. **Tenders** in order: Card / Bank transfer / Koko / Mintpay with reference; Trade-in with model and IMEI; Cash with cash received and change. **Footer:** thanks and warranty/returns terms. Black only (a thermal printer dithers grey); ~72mm printable width. _As built (step E, revised P5):_ the logo replaces the shop name, with the tagline as text under it; the customer's **full** phone (the shop's choice), still no NIC; per line "Warranty: 12 months (until 21 Oct 2027)", "Checking only" or nothing for No warranty (P5-18, P5-19), and "Discount (20%)" / "Discount (160.00 each)" (P5-20); a numbered T&C block before the footer. Page 72mm wide, 64mm of content from a 1.2mm left margin, height measured + 1mm with a 90mm minimum (the printer spike). | — |
| P5-12 | When it prints | **Automatically on complete.** **Reprint receipt** on the Sale complete panel, and a persisted `lastCompletedSaleId` (`terminalSessionStore`, cleared on logout): the Current sale card offers **Reprint last receipt** (`GET /sales/:id`) until the next sale completes, also after a reload. A browser can't see printer errors (paper out, jam), so reprint is the only recovery. Reprinting older sales comes with P6's sale detail. | — |
| P5-13 | How it prints | The receipt renders into a dedicated `#receipt-root`. `@media print` hides everything else and forces black on white (also in dark mode). Before `window.print()`, `utils/printReceipt.js` measures the receipt and sets `@page { size: 80mm <height>mm; margin: 0 }`, so the driver doesn't feed a long fixed page of blank paper before the cut. Tested without the printer via Chrome print preview → Save as PDF; component tests mock `window.print`. **A printer spike opens step B:** a minimal 80mm page with a dynamic `@page` height, printed on the real XP-80T (page length, auto-cut, margins) before the receipt is built. | — (a hidden iframe was the alternative) |
| P5-14 | Shop details and footer | **Shop name and footer text in `constants/receipt.js`**; branch name, address and phone from the sale's `branch`. The shop supplies the shop name, the branch address and phone, and the footer text before step E; until then the code uses clearly marked placeholders, listed at the step-E checkpoint. There is no branch admin screen, so a go-live entry in FOLLOWUPS covers filling in branch address and phone. A backend settings source can come later. _Supplied 2026-10-21 (step E): logo, tagline, T&C and footer are in `constants/receipt.js`; no placeholders remain._ | — |
| P5-15 | Void, recent sales, sale detail | **Not in P5.** They become **P6 — Recent sales, sale detail, reprint, void**: §1 #14–16, the B4 and resold-trade-in 409s, reprinting any sale, `voider` on `findOne`, and a `completed_at` filter for "today" (`GET /sales` filters on `created_at`, so a draft opened one evening and completed the next morning would be missing). Polish and E2E move to P7: earlier references to P6 as the polish slice (P1-6, P1-8, P3-11, P3-12, Q14, §6 Alt+P) now mean P7, and since P6 (P6-24) they mean **P8**: P7 is Returns and refunds. | §9 "P5 — Recent sales + void" |
| P5-16 | Till setup | Documented in a new `docs/frontend/pos-till-setup.md` (step F): XP-80T driver with 80mm paper and cut at end of document; XP-80T as the Windows default printer; a Chrome or Edge shortcut with `--kiosk-printing` opening `/pos`; one manual print first to set margins None, scale 100% and headers/footers off. No code. _As built (revised P5):_ the spike settled driver paper **80(72)mm x 3276mm**, Horizontal Offset 0, cutter per page + partial cut, feed 15mm; Chrome paper **80(72)mm x 3276mm** (its own default, 297mm, shrinks long receipts), Margins **Default**, Scale **Custom 100**, headers/footers off. `docs/frontend/pos-till-setup.md` has the steps and the kiosk check (a short and a long receipt print silently, full size, one cut). | — |
| P5-17 | Not in P5 | Void, recent sales, sale detail, reprinting older sales (P6); SMS, WhatsApp or PDF receipts; ESC/POS or WebUSB; cash drawer (the shop has none); editing a completed sale; sale notes; the Toast primitive; bottom sheets (P3-11); a backend settings source; cleaning up orphan drafts. _Line discounts were listed here; they moved into P5 (P5-20)._ | — |

**Added while building P5 (2026-10-20 / 21, from the shop):**

| # | Topic | Decision | Replaces |
|---|---|---|---|
| P5-18 | Warranty per line | **One warranty period per sale line, chosen at the till** (#33). Codes: CHECKING, WEEK_1, WEEK_2, MONTH_1/2/3/6/12/18/24. A product has a `default_warranty` (the product forms' Default warranty select); a line starts on it and the cashier can change it in the cart while the sale is a DRAFT (a compact select per line, saved after 400ms of quiet). `completeSale` sets `warranty_until` = the Colombo completion date + the period (null for CHECKING); the receipt prints "Warranty: 12 months (until 21 Oct 2027)". The confirm dialog lists the items with their warranty (up to 3, then "+N more"). | P5-1's snapshot of the product's months / checking days |
| P5-19 | No warranty | **A `NO_WARRANTY` code, listed first and the default for new products** (#34). Existing products keep their code (no data change). Like CHECKING it has no `warranty_until`; the receipt prints **nothing** for it, and **"Checking only"** for CHECKING (was "Checking only, no warranty after leaving the shop"). | CHECKING as the only "no warranty" |
| P5-20 | Line discounts at the till | **Moved into P5.** Two modes: **percent** (`PERCENT`, 0–100) and **price each** (`UNIT_PRICE`, #34: the final price per unit, 0 up to the unit price; the discount is (unit price − price each) × qty, so it follows qty changes). Line money is computed in integer cents and PERCENT rounds half-up exactly (#34, FOLLOWUPS F3). `LineDiscountDialog`: the mode buttons (1 / 2, ←/→), one value field pre-filled with the line's discount, a live preview ("2 × 160.00 = 320.00 (−80.00)"), Apply (Enter), Remove discount, Esc; 0% or the unit price itself removes the discount; server errors stay in the dialog (incl. #24 "Remove or reduce payments first"). A line without a discount opens on the mode last applied on this till (persisted locally). Cart: "Discount" under the unit price, `D` on the focused row; a discounted line shows the original price struck through, the new one, and a "−20%" / "160.00 each" badge under the line total (rows stay 71px). The confirm dialog shows a Discount row; the receipt prints "Discount (20%)" / "Discount (160.00 each)" per line. Every role may discount, with no limit (Q11). | P5-17 "line discount UI" (was P7) |

### P6 decision log (2026-10-22)

Decisions made before building P6 (recent sales, sale detail, reprint, void). Where they differ from the original planning text, the affected sections are marked "revised P6".

**Business answers (from the shop):**

1. **Voids are a manager's or admin's**, and a cashier's till can void when a manager or admin enters their **approval PIN** there. The PIN is reused for later approvals (P7 returns).
2. **No time limit** on voids.
3. **Returns happen regularly, including partial ones** (1 of 5 items, days later). Void and re-ring is not the answer: returns get their own slice, **P7**, right after P6. Void stays for mistakes.
4. **Refunds stay outside the system until P7.** A void records only its reason.
5. **A sale whose phone was later bought back on a phone purchase is never voided.** The buy-back is a real transaction of its own and the phone is already in stock through it. No "reverse a phone purchase" feature.
6. **Every void needs a manager's or admin's PIN, on every session**, a manager's or admin's own included: a till left logged in as a manager must not allow PIN-free voids (review of the P6 plan).
7. **Each person sets their own PIN.** An admin can clear a PIN but never sets one for someone else; a new manager sets theirs after first login.
8. **A returned phone isn't sellable until it's checked** (for P7): a new status that keeps it in the live-IMEI index; no fault → IN_STOCK, faulty → back to its supplier (with the supplier-receiving phase). Non-phone returned items are decided when P7 is planned.

**What `voidSale` does today (P6 recon).** `POST /sales/:id/void { void_reason }` (3–500 characters, trimmed), admin and manager only, `@Auditable('Sale', VOID)`, returns the hydrated sale. One transaction, sale row locked: COMPLETED check → each in-house line back to stock (external-supplier lines and untracked products skipped) → each sold phone SOLD → IN_STOCK → each trade-in phone IN_STOCK → RETURNED and its stock −1 (the PhonePurchase stays as history) → every payment stamped `reversed_at` / `reversal_reason` (amounts kept; **no refund is recorded**) → the sale VOIDED with `voided_at`, `voided_by`, `void_reason`; `sale_number`, `completed_at`, lines and totals are kept. VOIDED is terminal. The errors:

| # | Cause | Status and message (today) |
|---|---|---|
| V1 | Reason missing, under 3 or over 500 characters | 400 |
| V2 | Caller is a cashier | 403 |
| V3 | Sale not found | 404 |
| V4 | Not COMPLETED (a DRAFT, or already VOIDED) | 400 `Cannot void a VOIDED sale. Only COMPLETED sales can be voided.` A repeated void is therefore safe: a lost response is settled by re-fetching |
| V5 | A trade-in phone from this sale was resold | 409 `…trade-in phone (IMEI '…') has been resold in a subsequent sale. Void the subsequent sale first…` + `existing_unit`; the later sale isn't named |
| V6 | A phone this sale sold was taken back later (B4): a buy-back trade-in on a later sale, or a phone purchase | 409 `…the phone (IMEI '…') was taken back into stock on a later sale or purchase. Void that sale first…` + `existing_unit` (null when only the live-IMEI index caught it) |
| V7 | Trade-in stock below 1 at void time (integrity) | 409 with product and branch UUIDs in the message |
| V8 | Other integrity failures (unit or purchase missing, unit in an unexpected state) | 500 |

Also found: `GET /sales` filters and sorts on `created_at` only, joins branch and cashier only (no customer), has no search, and reads a date-only `from` / `to` as a UTC day, not a Colombo day (FOLLOWUPS). `findOne` doesn't load `voider`. The receipt ignores `status`, so a voided sale (including "Last receipt" after a void) prints as a valid receipt.

| # | Topic | Decision | Replaces |
|---|---|---|---|
| P6-1 | Where it lives (§4) | **Routes inside `TerminalLayout`**, as §4 planned: `/pos/sales` (list) and `/pos/sales/:id` (detail). A **Sales** button in the terminal header, and **Alt+R** from the terminal. Alt+R is checked with an OS-level keystroke in Chrome and Edge at the start of step B (as P4-14 did for F6); **F7** if it can't be intercepted. Esc: detail → list → `/pos`. Leaving `/pos` unmounts the terminal; the draft is resumed from its pointer on return (P1-2), and step B checks that the Sale complete panel survives the round trip. _Revised in step B:_ **Alt+R verified 2026-10-22** with an OS-level Alt+R in Chrome 155 and Edge 155: the page receives it and keeps focus, and neither browser uses it (with or without `preventDefault`), so no F7 fallback; it is `preventDefault`-ed anyway and ignored while a dialog is open. **Esc in the search box clears a non-empty search first** (back to the day); the next Esc goes to `/pos`. The round trip **didn't** keep the Sale complete panel (remounting re-ran `ensureDraftSale`, which reset the terminal); `ensureDraftSale` now does nothing while the sale is completing or completed. An open draft and its cart come back as they were. | — (an overlay over the terminal was the alternative) |
| P6-2 | Default range | **One Colombo day by `completed_at`, COMPLETED and VOIDED, newest completion first**; today by default, with a **day stepper** (← date →). The client sends the day's bounds as ISO timestamps with `+05:30` (`utils/colomboDay.js`), never date-only strings. Status, cashier and date-range filters stay R1.1 (§1 #21). | `created_at`, today only |
| P6-3 | Search | **One search box → `q` on `GET /sales`**: sale number (contains, so "0042" finds INV-20261021-0042), customer name or phone (contains), and **exact IMEI** on sale lines and trade-in payments. A search **ignores the day** and covers the whole branch (a customer back with a phone months later). 2+ characters, debounced 250 ms, as the scan bar. | — |
| P6-4 | Who sees what (Q16) | **Unchanged: every role sees all of the terminal branch's sales**; cashiers reprint colleagues' receipts. Admins see the terminal branch. Backend reads stay unscoped (R9). | — |
| P6-5 | List rows | Time, sale number, customer, cashier, total, status (a red **Voided** badge). Pages of 50 with **Load more**; ↑/↓ and Enter; stacked cards below `md` (the common `Table`). Needs `customer` on each list row (backend, step 0a). | §1 #14 (no customer) |
| P6-6 | Detail content | **Header:** sale number, status, completion time, cashier, customer name and phone (**no NIC**, as the receipt). **Lines:** IMEI, `qty × price`, discount label (P5-20), warranty with its end date and an **"expired" tag** once `warranty_until` has passed. **Tenders:** reference; cash received and change; trade-in product, IMEI, value, **resale price and notes** (deferred here by P4-8). **Totals.** **Voided:** a banner with when, the reason, who approved it (`voider`) and, when it was someone else, whose session it was (`void_requester`, P6-17); payments marked "Reversed". **Actions:** Reprint (P) and Void (V). Two columns from `lg` (lines left; tenders, totals and actions right), measured with the mocked-API harness at 1366×650 and 1526×640, and at 390px. | — |
| P6-7 | Reprint marking | **A reprint from the detail page prints "REPRINT · <date and time printed>"** under the invoice number. The Sale complete panel's Reprint and **Last receipt** stay unmarked: they replace a failed first print (P5-12). **A voided sale prints a "VOIDED — NOT VALID" block** (voided date and time, reason) at the top and again above the footer, and no change line. "Last receipt" always re-fetches the sale, so a sale voided since prints that way too. Checked with Save as PDF, then one real print of each on the XP-80. _Revised in step C:_ if Last receipt's re-fetch fails it prints nothing (an inline error), never the in-memory copy; the detail page's Reprint re-fetches too. The top VOIDED block is the first thing on the paper (above the logo). The detail page shows "No warranty" (muted); the receipt still prints nothing for it (P5-19). Real prints: REPRINT in step C, VOIDED at the D2 checkpoint. | P5-12 (no marking) |
| P6-8 | Who voids | **Every void is approved with a manager's or admin's PIN, on every session** (business answer 6, P6-15 – P6-21): on a cashier's session a manager or admin enters theirs; on a manager's or admin's session they enter their own (or pick another approver). No void without a PIN, so a till left logged in as a manager can't void on its own. Every role sees Void enabled; the dialog asks for the approval. | §1 #16 "admin/manager only; cashiers see the button disabled" |
| P6-9 | Reason (Q15) | Presets, keys 1–6: **Customer returned the items · Wrong item rung up · Wrong price · Duplicate sale · Payment failed · Other**. Optional detail, **required for Other**. Sent as one `void_reason`: "Wrong price — <detail>", or the preset alone, or the detail alone for Other; at most 500 characters. Returns of a few items aren't voids (P7), but "Customer returned the items" stays for a whole-sale return until P7 ships. | Q15 (presets not named) |
| P6-10 | Confirm flow | `VoidSaleDialog` shows the sale number and total, the reason, and **what the void does**: "N items back to stock", "Phones back in stock: IMEI…", "**Trade-in phone goes back to the customer:** IMEI… — take it off the shelf". Then **what to hand back, outside the system**: "LKR X cash", "Reverse card payment ref …", "Koko / Mintpay ref …" (P6-12). Focus opens on the reason; Enter voids only once the reason, the approver and the PIN (P6-17, P6-20) are valid; Void is never focused on open. | §6 "Enter confirms" (for void) |
| P6-11 | Void errors | Shown in the dialog, classified by `utils/voidErrors.js`. **V5 / V6:** the IMEI and a **link to the later sale** (P6-22). **Bought back on a phone purchase:** "This sale can't be voided: the phone (IMEI …) was bought back on a later purchase." (P6-22). **V4, a network error, a timeout or any 5xx (V8 included):** re-fetch `GET /sales/:id`; VOIDED → success (the void went through, or another manager did it), COMPLETED → the error with Try again. _Revised in step A:_ a 5xx no longer says "Nothing was changed": the client can't know that, so it reconciles like a lost response. **The POST is never resent automatically**, not on a lost response, a timeout or a 5xx: reconciling is a re-fetch only, since a resend would spend another PIN attempt and could write a second audit row. **V3:** "This sale no longer exists." **V7** (the integrity 409; its transaction rolled back): "Couldn't void. Nothing was changed.", no re-fetch. PIN errors: P6-19. | §1 #16 (409 wording only) |
| P6-12 | Money already paid | **Refunds happen outside the system until P7** (business answer 4): the void only stamps the payments as reversed. The dialog lists what to give back (P6-10); `docs/frontend/pos-till-setup.md` and the cashier notes say so. | — |
| P6-13 | After a void | The detail page shows the voided sale from the response; the list row is re-read on return. A **void slip only on request**: Reprint on the voided sale (P6-7). | — |
| P6-14 | Layout | List and detail fit 1366×650 and 1526×640 without scrolling the page (the list and the lines scroll inside); judged with the mocked-API harness (Q23); 390px smoke check. | — |
| P6-15 | Approval PIN: the model | **Per user, admins and managers only.** New `users` columns: `approval_pin_hash` (bcrypt with `BCRYPT_ROUNDS`; **`select: false` and `@Exclude`**, exactly like `password_hash`, so it is never loaded unless a query opts in with `addSelect`, and never serialized), `approval_pin_set_at`, `approval_pin_failed_attempts` (smallint, default 0), `approval_pin_locked_until` (timestamptz, null). _Revised in 0b:_ the count and the lock are also **`@Exclude`**, so no user response carries them (the PIN check reports them in its own error bodies); `/auth/me` and login read `has_approval_pin` and `approval_pin_set_at` from the database, never the JWT. **Exactly 6 digits.** **Weak-PIN rule** (exact): with the digits d1…d6, a PIN is rejected when every step d(i+1) − d(i), for i = 1…5, is the same value and that value is **0, +1 or −1**: all one digit (`000000` … `999999`), ascending runs (`012345`, `123456`, `234567`, `345678`, `456789`) and descending runs (`543210`, `654321`, `765432`, `876543`, `987654`). No wrap-around (`890123` is allowed). That is 20 rejected PINs; the rest of the 1,000,000 are allowed. Not unique (two people may pick the same PIN; the approver is named, P6-16). `/auth/me` gains `has_approval_pin` (a boolean); the hash never leaves the server. Changing a user's role to cashier, or deactivating them, clears the PIN. **Secret-exposure e2e (step 0b):** extended to assert that `approval_pin_hash` (and any `pin` field) appears in **no** response: user responses (`/auth/login`, `/auth/me`, `GET` / `PATCH /users/:id`), sale responses (`GET /sales`, `GET /sales/:id` with `cashier`, `voider` and `void_requester`), every void response (success and each error), the approver list, and the PIN set and clear endpoints. | — |
| P6-16 | Approval PIN: who approves | **The approver is picked by name, then enters the PIN** (not the PIN alone: that would bcrypt-compare every manager's hash and break on a shared PIN). `GET /approvers?branchId=` (all roles) returns **only `{ id, full_name }`** for the **active admins** and the **active managers of that branch** who **have a PIN set**; nothing else (no role, email, branch, PIN state or lock state). A manager approves for their own branch; an admin for any branch. The session user may approve their own session (P6-17). _Revised in 0b:_ **non-admins may ask only for their own branch** (any other `branchId` is 403); admins may ask for any branch. | — |
| P6-17 | Void with approval | `POST /sales/:id/void { void_reason, approval: { approver_id, pin } }`, opened to **all three roles**; **`approval` is required on every void** (400 from the DTO without it), a manager's or admin's own session included (business answer 6). The approver must be active, have a PIN, not be locked, and be an admin or a manager of the sale's branch; they **may be the session user**. **Recording:** `voided_by` keeps its meaning, the admin or manager who authorized the void (`docs/backend/sales.md`), so it is the **approver**; a new `void_requested_by` (FK users) is the **session user** (the same person when a manager approves their own void). The migration backfills `void_requested_by = voided_by` on existing VOIDED sales (before 0b only managers and admins voided, on their own session), and `CHK_sales_void_requested_consistency` requires it exactly on VOIDED sales. Both load on `findOne` (`voider`, `void_requester`). _Revised in 0b:_ **the session user must be at the sale's branch** (admins: any branch), otherwise 403 `VOID_WRONG_BRANCH`; this is checked, with 404 and not-COMPLETED (400), **before** the PIN, so a void that can't happen never uses a PIN attempt. **The VOID audit row moved into the void's transaction** (the `AuditLogInterceptor` has no changes for VOID and doesn't know the approver, so `@Auditable` came off the endpoint): actor = the session user, `changes` with `voided_by` and `void_requested_by`, and the description "Voided with approval by <approver> (<id>); requested by <session user> (<id>)". Existing void e2e tests send no `approval` and change at the 0b checkpoint (old / new / reason listed there). | V2 (cashier always 403); void on a manager's own authority |
| P6-18 | Setting the PIN | **Decided: each admin or manager sets their own PIN, and only their own** (business answer 7): `PUT /auth/me/approval-pin { current_password, pin }`; the password proves it's them; it resets the attempt count and the lock. A new manager sets theirs after first login; until then they can't approve. In the app: **Approval PIN** in the user menu (admins and managers), `ApprovalPinDialog` with current password, new PIN and confirm, and "Set on <date>" / "Not set". **An admin can clear anyone's PIN** (`DELETE /users/:id/approval-pin`; via Swagger until the Phase 6.8 user screens), after which that user sets a new one. **An admin never sets another user's PIN**: a PIN someone else knows no longer shows who approved. **Both are audited:** `APPROVAL_PIN_SET` (actor = the user, target = themselves) and `APPROVAL_PIN_CLEARED` (actor = the admin, target = the user whose PIN was cleared), each with `approval_pin_set_at` only; **the PIN, the hash and `current_password` never reach the audit log** (step 0b checks how `AuditLogInterceptor` builds `changes` and keeps request-body PIN and password fields out). _Revised in D1:_ the user-menu item is **hidden for cashiers** (`PERMISSIONS.SET_APPROVAL_PIN`, admins and managers; a cashier can never hold a PIN), not shown disabled; it reads "Set on <date, time>" or "Not set". The dialog mirrors the weak-PIN rule (`utils/pin.js`, copied from `weak-pin.ts`), sends only `{ current_password, pin }`, updates the session user from the PUT response (`authSlice.approvalPinSet`, no extra `/auth/me`), and shows `WRONG_PASSWORD` (password cleared and refocused), 400s and other failures inside the dialog. After it closes, a `pos:return-focus` window event lets the terminal hand focus back to the scan bar (`utils/posFocus.js`); elsewhere focus returns to the menu button. | — |
| P6-19 | Rate limit and lockout | Per approver: **5 wrong PINs in a row lock that approver's PIN for 15 minutes.** The count and the lock are **stored in the database** (`approval_pin_failed_attempts`, `approval_pin_locked_until`), so they survive an API restart and hold across API instances; they are written in their own committed transaction before the void's, so a failed attempt counts even though nothing is voided. **A correct PIN resets the count to zero** and clears the lock; once a lock has expired, the count starts again from zero. _Revised in 0b: specific codes and messages instead of a generic "Approval failed."_ Every body is `{ message, code }`, never the PIN: wrong PIN → **403** `WRONG_PIN` with `attempts_left` ("Wrong PIN. 3 attempts left."); the 5th in a row and any attempt while locked → **423** `PIN_LOCKED` with `locked_until` ("<name>'s PIN is locked until 14:32."; the 5th prefixes "Wrong PIN. "); refused approvers → **403** `APPROVER_NOT_FOUND` ("Approval failed: approver not found."), `APPROVER_INACTIVE`, `APPROVER_NOT_MANAGER`, `APPROVER_WRONG_BRANCH`, `APPROVER_NO_PIN` ("<name> has no approval PIN set."); a wrong current password when setting a PIN → 403 `WRONG_PASSWORD`. Never 401 (the axios interceptor would try a token refresh). Every failed attempt and every lockout is written to the audit log (`APPROVAL_PIN_FAILED`, `APPROVAL_PIN_LOCKED`, target = the approver, never the PIN). A lockout blocks the approver's PIN approvals, not their login. **Consequence:** since every void needs a PIN (P6-17), **a locked-out manager can't void, their own session included, until the lock expires, another manager or admin approves, or an admin clears their PIN** (and they set a new one). A cashier mistyping, or guessing, can therefore hold one manager's voids for 15 minutes; accepted. The global per-IP throttle stays (FOLLOWUPS); the lockout is the real guard. | — |
| P6-20 | Approval in the void dialog | **Every** `VoidSaleDialog` has a **Manager approval** block (`ManagerApprovalFields`): approver select (from `GET /approvers`) and a 6-digit PIN field (`type="password"`, `inputMode="numeric"`, `autoComplete="off"`; _revised after D2:_ `autoComplete="one-time-code"`, because Chrome ignores `off` and filled a saved login into the void dialog, the email into Detail and the password into the PIN; the field also discards any input that isn't the user's). **On a manager's or admin's session the approver defaults to the logged-in user** (when they're on the list), and they may pick another; on a cashier's session none is preselected. The PIN is **never stored**: not in Redux, not in local storage, cleared after every attempt, never logged. Errors inline: "Wrong PIN. 3 attempts left.", "<name>'s PIN is locked until 14:32. Another manager can approve, or an admin can clear the PIN.", a manager with no PIN of their own "Set your approval PIN first (user menu → Approval PIN), or pick another approver.", and with no approvers at all "No manager has set an approval PIN yet. A manager sets it from the user menu → Approval PIN." | — |
| P6-21 | Reuse (P7) | **Built generic:** an `ApprovalsService.verify({ approverId, pin, action, branchId, requestedBy, ip })` that every approving endpoint calls with its own action. _Revised in 0b:_ `verify` **opens its own transaction and commits it** before the approved action's transaction opens (it does not take the caller's `EntityManager`), and it locks the approver's row (`SELECT … FOR UPDATE`), so a refused or rolled-back action can never undo a failed attempt or a lock, and simultaneous guesses queue; it returns the outcome from the transaction and throws only after the commit. Actions: `SALE_VOID` now, returns in P7. On the frontend, the `ManagerApprovalFields` component. One request carries the action and the PIN: no approval tokens to store, expire or replay. | — (a two-step approval token was the alternative) |
| P6-22 | Later-sale 409s (B4) | Both void 409s gain `imei`, a `reason` (`RESOLD` / `TAKEN_BACK_ON_SALE` / `BOUGHT_BACK_ON_PURCHASE`) and `later_sale` (`{ id, sale_number }`, or null for a phone purchase) (step 0a). The POS words them: **RESOLD** "The trade-in phone (IMEI …) was sold on INV-…. Void that sale first." **TAKEN_BACK_ON_SALE** "The phone (IMEI …) was traded back in on INV-…. Void that sale first." **BOUGHT_BACK_ON_PURCHASE** (business answer 5): the backend message becomes "This sale can't be voided: the phone (IMEI …) was bought back on a later purchase." and the block is permanent. The race case (`existing_unit: null`) keeps a generic "taken back on a later sale or purchase" message. | V5 / V6 wording |
| P6-23 | Time limit | **None** (business answer 2). | — |
| P6-24 | Returns and refunds | **Not in P6: a new slice, P7 — Returns and refunds**, planned when P6 ships (§9). Keyboard, polish and E2E move from P7 to **P8**, and every earlier "P7" for polish now means P8. What P7 is known to need (business answers 3 and 8, recorded, not decided in detail): partial returns linked to the original sale line, days later; refund amount and method recorded; returned items and IMEIs back to stock; a printed return slip; manager PIN approval (P6-21). **A returned phone goes to a new non-sellable status (e.g. `INSPECTION`)**, which must join `uq_product_units_imei_live` (the shop holds it; FOLLOWUPS "Customer-return re-stock"). After checking: no fault → IN_STOCK; faulty → returned to the supplier it came from, which depends on supplier receiving and so belongs with that phase. Non-phone returned items (back to stock, or damaged) are decided when P7 is planned. | §10 "Refunds / partial returns" (not in 6.4) |
| P6-25 | Not in P6 | Returns, exchanges, refund records, store credit (P7); un-void; editing a completed sale; status, cashier and date-range filters (R1.1); backend branch scoping (R9); a barcode on the receipt; reversing a phone purchase (never, P6-22); an audit-log screen; end-of-day or Z reports; approval tokens; a PIN screen for other users (6.8); the Toast primitive, bottom sheets and Playwright (P8). | — |

### P6 as built (2026-10-22)

**Done.** Backend #38 (0a) and #39 (0b); frontend on `feature/pos-p6-frontend` (steps A–E). Frontend suite: 895 tests in 56 files. Layouts judged with the mocked-API harness at 1366×650 and 1526×640 in light and dark, plus a 390px smoke check; the real checks were done on the dev backend and the shop's XP-80.

| Step | What shipped |
|---|---|
| 0a (#38) | `GET /sales`: `completedFrom` / `completedTo` (time and offset required), `sort=completed_at`, `q` (sale number, customer name or phone, exact IMEI), `customer` on each row, a `(branch_id, completed_at)` index; `voider` on `findOne`; the void 409s gain `imei`, `reason` and `later_sale`. |
| 0b (#39) | The approval PIN: `users` PIN columns and `sales.void_requested_by` (migration `AddApprovalPinAndVoidRequestedBy`), `ApprovalsService.verify` with the stored lockout, `GET /approvers`, `PUT /auth/me/approval-pin`, `DELETE /users/:id/approval-pin`, `approval` required on every void, the audit entries and the secret-exposure e2e. |
| A | `listSales` (bounds sent URL-encoded, `+05:30` as `%2B05:30`, proved against real HTTP), `voidSale` (30 s timeout, never resent), `approvalsService`, `utils/colomboDay.js`, `utils/voidErrors.js`, `schemas/voidSchema.js`, PIN fields kept by `mapBackendUser`. |
| B | `/pos/sales` and `/pos/sales/:id` in the terminal, the header Sales button and Alt+R, the day list (stepper, all-dates search, Load more), state in the URL so Esc from a sale restores the list (up to the 200-row cap), the common `Table`'s `activeKey` / `fill` / `dense`. |
| C | `SaleDetailView` (header without NIC, voided banner, lines with warranty and Expired, tenders with trade-in resale and notes, Reversed tags, totals), Reprint (P) with "REPRINT · <time>", the VOIDED receipt, `ScrollFade`, entity-shaped test fixtures (`test/saleEntities.js`). |
| D1 | User menu → Approval PIN (`ApprovalPinDialog`): current password, PIN, confirm; the weak-PIN rule mirrored from the backend; errors in the dialog; nothing stored. |
| D2 | `VoidSaleDialog` with `ManagerApprovalFields` on every session, Void and V on completed sales, every void and PIN error in the dialog by code, re-read on a lost response. |
| E | This section, `pos-till-setup.md` §6 (go-live), FOLLOWUPS. |

**Decisions that changed while building** (each also noted in its row above):

- **A 5xx re-reads the sale** like a lost response, and the POST is never resent; only the V7 integrity 409 says "Nothing was changed" (P6-11, step A).
- **Esc in the search box clears a non-empty search first**; the next Esc leaves the list (P6-1, step B). Alt+R was verified with an OS-level keystroke in Chrome 155 and Edge 155: no F7 fallback.
- **Returning to `/pos` keeps the Sale complete panel and an open cart**: `ensureDraftSale` does nothing while a sale is completing or completed (a bug the P6-1 round-trip check found, step B).
- **A list row's customer is the Customer entity's `name`**, not `full_name` (found on the real backend in step B; test fixtures are copied from the backend entities since).
- **"Last receipt" always re-fetches** and prints nothing if that fails, never the in-memory copy; the detail page's Reprint re-fetches too (P6-7, step C).
- **The VOIDED block prints first on the paper, above the logo**, and again above the footer, with no Change line (P6-7, step C).
- **The detail page's totals and Reprint are their own region** at the bottom of the right column, with tenders scrolling above, so the total is always in view at ~640px (step C).
- **The approval PIN field is shared** (`PinField`, extracted from D1 in D2): other scripts' digits become 0–9, anything else shows "Digits only", a paste is filtered before the 6-digit cut.
- **The user menu's Approval PIN is hidden for cashiers**, and closing it hands focus back to the scan bar through a `pos:return-focus` event (P6-18, step D1).
- **The void dialog puts "Hand back, outside the system" first**, above the stock lines, so the money is always visible; lines from another shop read "not added to our stock. Return them to that shop yourself."; the approver list is fetched fresh on every open; one POST per press (P6-10, P6-20, step D2).
- **Real prints split across steps:** REPRINT checked on the XP-80 in step C, the voided screen and VOIDED receipt in D2 (step C).
- **No browser autofill in the PIN dialogs** (fix after E): with a saved login, Chrome treated the void dialog's Detail and the password-type PIN as a login form, putting the saved email into Detail (and so into a void reason) and the password into the PIN. `PinField` now uses `autocomplete="one-time-code"` (Chrome ignores `off`) and discards input that isn't the user's; checked in a real Chrome with a saved password (P6-20).

### P7 decision log (2026-10-23)

Decisions made before building P7 (returns and refunds). Where they differ from earlier planning text, the affected sections are marked "revised P7".

**Business answers (from the shop, 2026-10-23):**

1. **Refund = what the customer actually paid for those units**: the line total after its discount, shared per unit in cents, rounded so that all the returns on a line add up exactly to `line_total` (P7-3).
2. **The refund may be lower than that, never higher**, with the reason saying why, approved by the same PIN (P7-3).
3. **On a trade-in sale the trade-in share can be refunded as cash**, PIN-approved; the dialog shows "includes LKR X from a trade-in". The trade-in phone stays with the shop (P7-5).
4. **Refund methods:** cash, or back to a non-cash payment used on this sale with the reference of its reversal; never TRADE_IN; no store credit (P7-4).
5. **Returns are allowed within the warranty period.** Outside it a return is still allowed, but only as a manager's or admin's exception with an override reason. "Checking only", "No warranty" and an expired warranty are all outside warranty. No other time limit (P7-22, P7-23).
6. **Several returns on one sale**, up to the quantity sold on each line (P7-2).
7. **Items from another shop:** refunded, not added to our stock; the shop returns them to that shop (P7-8).
8. **A returned phone is never resold without inspection**: a manager or admin marks it passed (P7-6, P7-7).
9. **Non-phone items:** the cashier chooses Back to stock or Damaged per line (P7-8).
10. **A cashier can start a return; a manager or admin approves with their PIN**, on every session, as for voids (P7-9).
11. **Return slip:** two copies, the customer's and a shop copy with a signature line for cash refunds (P7-17).
12. **A sale with a return can't be voided, and a voided sale can't have returns** (P7-11, P7-12). Exchanges are a return followed by a new sale; the receipt's "Exchanges & Warranty" wording stays (P7-21).

**What exists today (P7 recon).**

- **Sales.** A COMPLETED sale is frozen except for the void (`docs/backend/sales.md`). Nothing records a return. Each line has its price snapshot, `discount_amount`, `line_total`, `external_supplier_id`, `warranty` / `warranty_until` (backfilled on old lines by `WarrantyPeriodPerLine`) and the phone it sold (`product_unit_id`), but no returned count. `voidSale` (`sales.service.ts` `voidSale`) puts back **the full quantity** of every line and flips every sold phone SOLD → IN_STOCK. On a sale with a return that would restock the returned items twice and fail with a 500 on a phone in INSPECTION (`markAvailableForReversal` expects SOLD), so voids after a return are refused (P7-11). `voidWithApproval` (checks without locks, then `verify`, then the action's transaction) is the pattern returns copy. Invoice numbers come from `sale_number_counters` (one row per branch and Colombo day, `UQ_sale_counter_branch_date`), formatted `INV-…`.
- **Phones.** Unit statuses are `IN_STOCK, SOLD, RETURNED, WRITTEN_OFF` (enum; an unnamed entity `@Check`; the migration's named `CHK_product_units_status`). The live-IMEI index `uq_product_units_imei_live` covers `IN_STOCK, WRITTEN_OFF` and is defined in three places that move together: the entity `@Index`, the `ProductUnitsImeiUniqueWhenLive` migration and `LIVE_UNIT_STATUSES` (`product-units/live-imei.ts`). `LIVE_UNIT_STATUSES` drives the trade-in and phone-purchase "already held" checks, so adding INSPECTION there blocks taking in a phone that is being inspected. Only IN_STOCK phones can be sold, so INSPECTION is unsellable with no further change. **Gap:** `assertExternalSerializedImeiNotInStock` checks IN_STOCK only, so a held WRITTEN_OFF (and, after P7, INSPECTION) IMEI could be rung up as another shop's phone; fixed in step 0a. The "taken back later" check (`reacquired`, `reacquiredConflict`, P6-22) applies to returns too: after a buy-back the old unit stays SOLD, so a return on the original sale must be refused as a void is.
- **Stock.** `decrementForSale`, `incrementForReversal`, `decrementForVoidedTradeIn`, each locking the stock row and skipping `manage_stock = false`. A serialized product's stock counts its phones, so a returned phone adds +1 only when it passes inspection. Returns add a third flow that locks stock rows and phones: the lock-order deadlock in FOLLOWUPS gets worse, hence step 0c first.
- **Payments.** The only reversal is the void's `reversed_at` / `reversal_reason`; no money handed back is recorded anywhere. P7 adds refund rows and leaves `payments` untouched.
- **Approvals.** `ApprovalsService.verify` already takes an `action`; P7 passes `SALE_RETURN`. Nothing in `verify` changes.
- **Audit.** `VOID` exists, written inside the void's transaction. P7 adds `RETURN` and `INSPECTION_PASSED`, written the same way.
- **`REFUND_SALE`** (`frontend/src/constants/rolePermissions.js`) is admins-only and used only by `DashboardDemo`; there is no backend counterpart.
- **Frontend pieces to reuse:** `ManagerApprovalFields`, `PinField`, `VoidSaleDialog` (layout, the "hand back" block), `SaleDetailView`, `SaleDetailLines`, `Receipt` and `printReceipt`, `voidErrors.js` (codes, re-read on a lost response), `colomboDay.js`.

**Data model (two migrations, step 0a then 0b).**

_Migration `AddProductUnitInspectionStatus` (0a):_ `product_units` — drop `CHK_product_units_status` by name and recreate it with `INSPECTION`; drop and recreate `uq_product_units_imei_live` with `WHERE status IN ('IN_STOCK', 'WRITTEN_OFF', 'INSPECTION')`. `down()` refuses with a clear message while any unit is INSPECTION (those rows are real; never changed to make a revert pass), as the buy-back migration's `down()` does. Code: the enum, the entity `@Check` and `@Index`, `LIVE_UNIT_STATUSES`; the migration comment's "RETURN_PENDING" becomes INSPECTION.

_Migration `CreateSaleReturns` (0b):_

- **`sale_number_counters.kind`** `varchar(10) NOT NULL DEFAULT 'SALE'`, CHK `kind IN ('SALE', 'RETURN')`. `UQ_sale_counter_branch_date` is replaced by a unique key on `(branch_id, kind, counter_date)`. `generateNext(manager, branchId, kind = 'SALE')` formats `INV-…` or `RET-…`.
- **`sale_lines.returned_quantity`** `int NOT NULL DEFAULT 0`, `CHK_sale_lines_returned_qty` (`returned_quantity >= 0 AND returned_quantity <= quantity`), so the database stops an over-return even under a race. The only column a return writes on a completed sale: a count; the sale's money never changes.
- **`sale_returns`**

  | Column | Type | Notes |
  |---|---|---|
  | `id` | uuid | |
  | `return_number` | varchar(20) NOT NULL | `RET-YYYYMMDD-NNNN`; `UQ_sale_returns_branch_number (branch_id, return_number)` |
  | `sale_id` | uuid NOT NULL | FK `sales`, RESTRICT; indexed |
  | `branch_id` | uuid NOT NULL | FK `branches`; always the sale's branch |
  | `reason` | varchar(500) NOT NULL | CHK: 3+ characters after trimming |
  | `refund_due` | numeric(12,2) NOT NULL | The most that may be refunded: the sum of the lines' `refund_share` (P7-3) |
  | `refund_total` | numeric(12,2) NOT NULL | What was refunded: the sum of the refund rows. CHK `refund_total >= 0 AND refund_total <= refund_due` |
  | `out_of_warranty` | boolean NOT NULL | True when any returned line is outside warranty (P7-22) |
  | `override_reason` | varchar(500) NULL | CHK `(out_of_warranty) = (override_reason IS NOT NULL AND length(trim(override_reason)) >= 3)` (P7-23) |
  | `approved_by` | uuid NOT NULL | FK `users`: the approver |
  | `requested_by` | uuid NOT NULL | FK `users`: the session user |
  | `client_request_id` | uuid NOT NULL | Unique (`UQ_sale_returns_client_request_id`); P7-15, P7-24 |
  | `created_at`, `updated_at` | timestamptz | `created_at` is when the return was made |

  Index on `(branch_id, created_at)`. No status column: a return is final, like a void.
- **`sale_return_lines`**

  | Column | Type | Notes |
  |---|---|---|
  | `id` | uuid | |
  | `sale_return_id` | uuid NOT NULL | FK `sale_returns`, RESTRICT |
  | `sale_line_id` | uuid NOT NULL | FK `sale_lines`, RESTRICT; indexed |
  | `quantity` | int NOT NULL | CHK > 0 |
  | `refund_share` | numeric(12,2) NOT NULL | CHK ≥ 0; this line's share of what was paid (P7-3) |
  | `out_of_warranty` | boolean NOT NULL | Worked out by the server when the return is made (P7-22) |
  | `disposition` | varchar(20) NOT NULL | CHK `RESTOCKED`, `DAMAGED`, `INSPECTION`, `NOT_OUR_STOCK`, `UNTRACKED` |
  | `product_unit_id` | uuid NULL | FK `product_units`; CHK `(disposition = 'INSPECTION') = (product_unit_id IS NOT NULL)` |

  Unique `(sale_return_id, sale_line_id)`.
- **`sale_refunds`**

  | Column | Type | Notes |
  |---|---|---|
  | `id` | uuid | |
  | `sale_return_id` | uuid NOT NULL | FK `sale_returns`, RESTRICT; indexed |
  | `method` | varchar(20) NOT NULL | CHK `CASH, CARD, BANK_TRANSFER, KOKO, MINTPAY` (never TRADE_IN) |
  | `amount` | numeric(12,2) NOT NULL | CHK > 0 |
  | `original_payment_id` | uuid NULL | FK `payments`; CHK `(method = 'CASH') = (original_payment_id IS NULL)`; partial index where not null |
  | `reference_number` | varchar(100) NULL | CHK: required (non-blank) when `method != 'CASH'` |
  | `created_at` | timestamptz | |

- **Cross-table rules, service only** (inside the return's transaction, sale row locked): the refund rows add up to `refund_total`; `refund_due` is the sum of the lines' `refund_share`; `sale_returns.out_of_warranty` is true exactly when a line's is; a non-cash refund's `original_payment_id` is a non-TRADE_IN payment of this sale, and the refunds against one payment never exceed its `amount`. Because every `refund_share` is a share of `line_total`, all refunds on a sale can never exceed its total.
- `down()` drops the three tables and `returned_quantity`, and restores `UQ_sale_counter_branch_date`; it refuses while `RETURN` counter rows exist.

**What a return does (one transaction, after the PIN).** Lock the sale row; COMPLETED check. Per returned line, under the global lock order (step 0c): our stock, not a phone, Back to stock → `RESTOCKED`, stock +qty; Damaged → `DAMAGED`, no stock change; a product without stock tracking → `UNTRACKED`; another shop's line → `NOT_OUR_STOCK`; a serialized phone from our stock (quantity always 1) → the "taken back later" check, then SOLD → **INSPECTION**, no stock change, `INSPECTION` with its unit. Then `returned_quantity += qty` per line, the refund rows, the `RET-` number, the return row and the `RETURN` audit row. **Inspection pass:** INSPECTION → IN_STOCK, stock +1, an `INSPECTION_PASSED` audit row. A faulty phone stays in INSPECTION until the supplier-receiving phase.

**Endpoints.** Returns live in their own `SaleReturnsService` and `SaleReturnsController` under `backend/src/sales/` (P7-26).

`POST /sales/:id/returns` — all roles, at the sale's branch (admins: any).

```
{ client_request_id: uuid,
  lines:   [{ sale_line_id, quantity, condition?: 'RESALEABLE' | 'DAMAGED' }],
           // condition: required for non-phone lines from our stock with stock tracking, refused otherwise
  refunds: [{ method, amount, original_payment_id?, reference_number? }],
           // empty only when nothing is refunded
  reason: string (3–500),
  override_reason?: string (3–500),   // required when a returned line is outside warranty
  approval: { approver_id, pin } }
→ 201 { return_id, sale }   (sale hydrated as GET /sales/:id)
→ 200 { return_id, sale }   on an accepted resend (P7-15, P7-24)
```

Checked in this order. Everything before the PIN runs without locks, so a return that can't go through never spends a PIN attempt:

| # | Cause | Status, `code` and extra fields |
|---|---|---|
| R1 | Malformed body: no lines, quantity < 1, a line twice, condition missing or not allowed, a non-cash refund without a reference or original payment, CASH with an original payment, reason or override reason the wrong length | 400 (validation) |
| R2 | Sale not found | 404 `Sale not found` |
| R3 | `client_request_id` already used: by **this sale and this session user** → the recorded return, 200, nothing else checked and no PIN; by another sale or another user → refused, never revealing that return | 409 `CLIENT_REQUEST_ID_CONFLICT` |
| R4 | Sale not COMPLETED (a draft, or voided) | 400 `SALE_NOT_COMPLETED` |
| R5 | Session user not at the sale's branch (admins: any) | 403 `RETURN_WRONG_BRANCH` |
| R6 | A line isn't on this sale | 400 `LINE_NOT_ON_SALE` + `sale_line_id` |
| R7 | More than is left to return | 409 `RETURN_QTY_EXCEEDED` + `sale_line_id`, `returnable` |
| R8 | A phone taken back later (buy-back trade-in or phone purchase) | 409 `PHONE_TAKEN_BACK` + `imei`, `reason`, `later_sale` (P6-22's reasons) |
| R9 | A line outside warranty and no `override_reason` | 400 `OVERRIDE_REASON_REQUIRED` + `sale_line_ids` |
| R10 | Refunds add up to more than the server's figure | 400 `REFUND_TOO_HIGH` + `refund_due` |
| R11 | TRADE_IN, or a non-cash refund whose `original_payment_id` isn't a non-TRADE_IN payment of this sale, or a method that differs from that payment's | 400 `REFUND_METHOD_NOT_ALLOWED` + `method`, `original_payment_id` |
| R12 | More back to one payment than is left of it | 409 `REFUND_EXCEEDS_PAYMENT` + `payment_id`, `refundable` |
| — | `ApprovalsService.verify` (`action: 'SALE_RETURN'`) | 403 `WRONG_PIN` / `APPROVER_*`, 423 `PIN_LOCKED` (docs/backend/approvals.md) |
| — | The transaction re-checks R4, R7, R8, R9 (the Colombo date may have moved on) and R12 under its locks | Same codes; nothing is saved |
| — | Two requests with the same new `client_request_id` at once | The loser hits the unique key and is answered as R3 |

`override_reason` sent when no line is outside warranty is ignored (stored null). Every 4xx body is `{ message, code, … }`; none carries the PIN.

`GET /sales/:id` gains `lines[].returned_quantity` and `returns[]`: `id`, `return_number`, `created_at`, `reason`, `override_reason`, `out_of_warranty`, `refund_due`, `refund_total`, `client_request_id`, `approver` and `requester` (`{ id, full_name }`), `lines[]` (`sale_line_id`, `quantity`, `refund_share`, `out_of_warranty`, `disposition`, `product_unit` `{ id, imei }`) and `refunds[]` (`method`, `amount`, `reference_number`, `original_payment_id`).

`GET /sales`: each row gains `return_state` (`NONE`, `PARTIAL` when some but not all quantity is returned, `FULL`) and `refunded_total`; `q` also matches `RET-` numbers (contains), finding the original sale.

`POST /sales/:id/void`: a sale with any return → 409 `SALE_HAS_RETURNS`, checked before the PIN.

`GET /sale-returns/inspection?branchId=` — admin, manager: the branch's INSPECTION phones with their latest return (`product_unit` `{ id, imei, product name }`, `return_id`, `return_number`, `sale_id`, `sale_number`, `returned_at`), oldest first.

`POST /product-units/:id/inspection-pass` — admin, manager: INSPECTION → IN_STOCK and stock +1; returns the unit. 409 `NOT_IN_INSPECTION` otherwise; 403 for a manager of another branch.

| # | Topic | Decision | Replaces |
|---|---|---|---|
| P7-1 | Return vs void | **A return is its own record, linked to the sale.** The sale stays COMPLETED; its money and lines never change, except the `returned_quantity` count (DB CHK backstop). Void stays for mistakes (P6 business answer 3). | — |
| P7-2 | Partial returns | Any quantity of any line, over any number of returns, up to the quantity sold; `CHK_sale_lines_returned_qty` enforces it under a race. | — |
| P7-3 | Refund amount | **The most that can be refunded is what the customer actually paid for those units** (business answer 1): with `L` = the line total in cents, `q` its quantity, `r` already returned and `k` now returned, `refund_share = round_half_up(L × (r + k) / q) − round_half_up(L × r / q)`, exact in integer arithmetic. All the returns on a line therefore add up to exactly `line_total`. `refund_due` is the sum of the lines' shares. **The refund may be lower, never higher** (business answer 2): the server accepts refunds totalling 0 … `refund_due` and refuses more with 400 `REFUND_TOO_HIGH` and its `refund_due`. A lower refund needs nothing extra from the server; the till asks for the reason to say why, and the same PIN approves it. Lowering a refund doesn't raise later ones (shares follow quantities, not what was refunded). `utils/returnMath.js` copies the formula, tested on the same cases as the server. | — |
| P7-4 | Refund methods | **CASH, or back to a non-cash payment used on this sale** (CARD, BANK_TRANSFER, KOKO, MINTPAY), same method, linked by `original_payment_id`, with the **reference of the reversal** done on the card machine or provider portal. Refunds to one payment never exceed its amount; refunds may be split across methods. **Never TRADE_IN. No store credit** (business answer 4). | P6-12 (refunds outside the system) |
| P7-5 | Trade-in sales | **The trade-in phone stays with the shop**; a return never gives it back. **The trade-in share can be refunded as cash**, PIN-approved (business answer 3). The dialog shows "includes LKR X from a trade-in", with X = refund total − the non-trade-in money still unrefunded on the sale, when positive. | — |
| P7-6 | Returned phones | SOLD → **INSPECTION**, unsellable, in `uq_product_units_imei_live`, `CHK_product_units_status` and `LIVE_UNIT_STATUSES` (step 0a). Stock doesn't move until it passes. The same unit row is reused (a return isn't a new acquisition); the return line records it. | P6-24 placeholder |
| P7-7 | Inspection | **Passed (no fault):** INSPECTION → IN_STOCK, stock +1, by a **manager or admin on their own session, no PIN**, from **Phones to check** (step F). **Faulty:** stays in INSPECTION until the supplier-receiving phase returns it to its supplier (FOLLOWUPS). | — |
| P7-8 | Non-phone items | **The cashier chooses per line: Back to stock** (stock +qty) **or Damaged** (no stock change; recorded on the return line) (business answer 9). Products without stock tracking and lines from another shop never move stock; another shop's line reads "Not added to our stock. Return it to that shop yourself." (business answer 7). | P6-24 "decided when P7 is planned" |
| P7-9 | Approval | **Every return is approved with a manager's or admin's PIN, on every session**, a manager's own included: `ApprovalsService.verify` with `action: 'SALE_RETURN'`, in its own committed transaction, after the lock-free checks (R1–R12). All three roles may start one, at the sale's branch only (admins: any; 403 `RETURN_WRONG_BRANCH`). Recorded as `approved_by` (approver) and `requested_by` (session user). | — |
| P7-10 | Numbering | `RET-YYYYMMDD-NNNN`, per branch and Colombo day, from `sale_number_counters` with a new `kind` column, issued inside the return's transaction (no gaps on rollback). | — |
| P7-11 | Void after a return | **Refused**: 409 `SALE_HAS_RETURNS`, before the PIN. Returns are final too; a mistaken return is put right with a new sale. | V4 set (P6) |
| P7-12 | Return on a draft or voided sale | 400 `SALE_NOT_COMPLETED`. | — |
| P7-13 | Taken-back phones | A phone traded back in or bought back after the sale can't be returned on it: 409 `PHONE_TAKEN_BACK` with P6-22's `reason` and `later_sale`. | — |
| P7-14 | Audit | A **`RETURN`** row inside the return's transaction: actor = the session user; the description names the approver, the requester, the lines, the refund total and, when present, "Outside warranty: <override reason>"; `changes` carry `approved_by`, `requested_by`, `refund_due`, `refund_total`, `out_of_warranty`. **`INSPECTION_PASSED`** (actor = the manager or admin, target = the unit). Never the PIN; the secret-exposure e2e covers every new response. | — |
| P7-15 | Lost responses | The till creates one `client_request_id` (uuid) when the return dialog opens and sends it with every attempt from that dialog. On a timeout, network error or 5xx it **re-reads the sale**: a return with that id → success (shows what was recorded); none → the error with **Try again**, which resends the same id. A wrong PIN or other refusal creates nothing, so the id stays usable. An accepted resend returns the recorded return with 200, without the PIN check, so no PIN attempt or audit row is spent twice; its body is ignored. | P6-11 "never resend" (voids only) |
| P7-16 | Where it lives | A **Return items** button and **R** on Sale detail for COMPLETED sales with something left to return. `ReturnDialog`: step 1 items, step 2 refund and approval. | — |
| P7-17 | Return slip | Printed automatically after a successful return, **two copies**: the customer's, and a **shop copy with a "Customer signature" line** when anything is refunded in cash (business answer 11). Reprint from the sale's Returns section, marked "REPRINT · <time>". Content: shop header; **RETURN / REFUND**; return number, date and time; original invoice number and date; cashier (requester); approved by; customer name and phone (no NIC); each item with IMEI, quantity × amount and "Back to stock" / "Damaged" / "For inspection" / "Not our stock"; refund total (and the amount due when lower); how it was refunded (Cash; Card reversal ref …); reason; for an outside-warranty return, **"Outside warranty — approved by <name>: <override reason>"**. | — |
| P7-18 | Recent sales and Sale detail | List: a **Part returned** or **Returned** badge (`return_state`); the total stays the original. Detail: "Returned N of M" per line, a **Returns** section (number, time, items, refund and how, approver, the outside-warranty line, Reprint slip), and **no Void** once the sale has a return. Search finds `RET-` numbers. | P6-5, P6-6 |
| P7-19 | `REFUND_SALE` | Granted to **all three roles**: the PIN is the authority, as for voids (P6-8). | Admins only |
| P7-20 | What the dialog shows _(rewritten after review)_ | Per line: **its warranty status** ("Within warranty until 21 Oct 2027", "Warranty expired on …", "Checking only — outside warranty", "No warranty — outside warranty"), worked out as the server does (P7-22); returnable quantity; "Goes to inspection" for phones; "Not our stock" for another shop's lines. For the whole return: "Sold N days ago" (information only, **no other time limit**, business answer 5), the refund due and the refund field (lowerable, P7-3), "includes LKR X from a trade-in" (P7-5). **The override reason field appears only when a selected line is outside warranty** (P7-23). | Plan's "warnings, not blocks" |
| P7-21 | Not in P7 | Exchanges as one step (a return, then a new sale; the receipt's "Exchanges & Warranty" wording stays), store credit, returning faulty phones to the supplier, warranty repairs, undoing or cancelling a return, a damaged-stock report or write-off, card or Koko integration, the Phase 6.7 settlement's handling of returns (FOLLOWUPS). | — |
| P7-22 | Within warranty _(added after review)_ | **A line is within warranty when today (Colombo, from the database clock) is on or before its `warranty_until`.** `NO_WARRANTY` and `CHECKING` lines have no `warranty_until` and are **outside warranty from the day of sale** (business answer 5). The server works it out per line when the return is made and stores it as `sale_return_lines.out_of_warranty`; `sale_returns.out_of_warranty` is true when any line's is. The till mirrors it for display only (`colomboDay.js`). | P7-20 warnings |
| P7-23 | Outside-warranty override _(added after review)_ | **A return with any line outside warranty needs an `override_reason` (3–500 characters) as well as the normal reason**: the manager's or admin's exception, approved by the same PIN. Without it: 400 `OVERRIDE_REASON_REQUIRED` with the `sale_line_ids` (before the PIN, and re-checked in the transaction in case the date moved on). Stored on `sale_returns.override_reason` (CHK: present exactly when `out_of_warranty`); recorded in the `RETURN` audit row; shown on the slip and in the Returns section as "Outside warranty — approved by <name>: <override reason>". | — |
| P7-24 | `client_request_id` belongs to one sale and one user _(added after review)_ | **An existing `client_request_id` is accepted only from the same sale and the same session user** (R3): then the recorded return comes back with 200. From another sale or another user: 409 `CLIENT_REQUEST_ID_CONFLICT`, and the other return is never returned or described. A unique-key clash between two simultaneous first sends is answered the same way. E2e: a resend from the same sale and user (200, no PIN attempt used, one audit row), from another sale (409), from another user on the same sale (409), and a simultaneous double send (one 201, one 200). | — |
| P7-25 | Lock order first _(added after review)_ | **Step 0c, its own backend PR before 0b:** the global lock-order fix from FOLLOWUPS (collect every Stock `(product_id, branch_id)` and every ProductUnit a transaction will touch, sort them, lock them all, then mutate), applied to `completeSale`, `voidSale` and `createForTradeIn`, with a shared helper that returns (0b) and the inspection pass (0a) use. | FOLLOWUPS "Stock-lock-ordering latent deadlock" (not fixed) |
| P7-26 | Code layout | `SaleReturnsService` and `SaleReturnsController` under `backend/src/sales/`, not in `SalesService` (already ~2,400 lines). `SalesService.findOne` / `findAll` gain the read-side fields; `voidSale` gains the `SALE_HAS_RETURNS` check. | — |
| P7-27 | Condition errors _(0b plan)_ | **A missing or not-allowed `condition` is a service 400 `RETURN_CONDITION_INVALID` with `sale_line_id`**, not DTO validation: only the server knows whether a line is a phone, another shop's, or untracked. Checked as soon as the line is known (after R6, before R7). | R1 "condition missing or not allowed" (validation) |
| P7-28 | R10 in the transaction _(0b plan)_ | **The transaction re-checks R10 too**: a parallel return on the same line changes what was already returned, so a share can move by a cent. | Transaction re-check list (R4, R7, R8, R9, R12) |
| P7-29 | Stock tracking changed _(0b plan)_ | **If a product's `manage_stock` changed between the lock-free checks and the transaction, the transaction answers with the same 400 `RETURN_CONDITION_INVALID`**; the disposition is decided from the Stock row read in the transaction. | — |
| P7-30 | `down()` _(0b plan)_ | **`CreateSaleReturns` `down()` refuses while any `sale_returns` row exists**, as well as while `RETURN` counter rows exist, and changes nothing. | `down()` "refuses while `RETURN` counter rows exist" |
| P7-31 | CASH reference _(0b plan)_ | **A CASH refund carrying a `reference_number` is a 400** (DTO), as is CASH with an `original_payment_id`. | R1 |
| P7-32 | Counter signature _(0b plan)_ | **`generateNext(branchId, manager?, kind = 'SALE')`** keeps the existing argument order; `peekNext(branchId, kind = 'SALE')` likewise. | `generateNext(manager, branchId, kind)` |
| P7-33 | Inspection list _(0b plan)_ | **`GET /sale-returns/inspection` is unpaginated**; `branchId` is a required UUID; each row's `product_unit` is `{ id, imei, product_name }`. A manager asking for another branch gets 403 `INSPECTION_WRONG_BRANCH` (the pass's code). | `product_unit` `{ id, imei, product name }` |
| P7-34 | Check order _(0b plan)_ | **The lock-free checks run in the R-number order of the R1–R12 table** (R9 override before the refund checks R10–R12), with P7-27's condition check between R6 and R7. | — |
| P7-35 | Trade-in note in the audit row _(0b plan)_ | **The `RETURN` audit description adds "includes LKR X from a trade-in" when X is positive**, X as in P7-5. | P7-14 description |
| P7-36 | Double send with a wrong PIN _(0b plan)_ | **Accepted:** two simultaneous first sends of the same `client_request_id` each run `verify`, so with a wrong PIN they count two attempts. With a correct PIN one gets 201 and the other 200 (P7-24). | — |

**P7 steps.** Backend first, each its own PR, in this order: this docs PR, **0c**, **0a**, **0b**; then frontend **A–G** on one feature branch. Each step ends at a checkpoint.

| Step | What | Checkpoint |
|---|---|---|
| **0c** (backend) | Global lock order (P7-25): sort and lock every Stock row and ProductUnit up front in `completeSale`, `voidSale` and `createForTradeIn`, through one helper. `docs/backend/sales.md` (lock order); FOLLOWUPS entry removed. | Existing suites green; a new e2e completes two sales with the same products in opposite line orders in parallel, and a trade-in void racing a sale of that phone, with no `40P01`. |
| **0a** (backend) | `INSPECTION` (P7-6): migration `AddProductUnitInspectionStatus`, enum, entity `@Check` and `@Index`, `LIVE_UNIT_STATUSES`, the migration comment; `assertExternalSerializedImeiNotInStock` on `LIVE_UNIT_STATUSES`; `POST /product-units/:id/inspection-pass` with `INSPECTION_PASSED`; `docs/backend/used-phones.md`. | E2e: an INSPECTION IMEI blocks a trade-in, a phone purchase and an external serialized line; the pass makes the phone IN_STOCK with stock +1 and is audited; 409 `NOT_IN_INSPECTION`; a cashier gets 403; `down()` refuses while an INSPECTION unit exists. |
| **0b** (backend) | Returns: migration `CreateSaleReturns`, entities, the counter's `kind`, `SaleReturnsService` / `SaleReturnsController`, `POST /sales/:id/returns` (R1–R12, `verify`, the transaction), `GET /sale-returns/inspection`, the `GET /sales` and `GET /sales/:id` additions, `SALE_HAS_RETURNS` on void, the `RETURN` audit row; new `docs/backend/returns.md`, `sales.md` and `approvals.md` updated. | E2e: partial returns then a second return up to the quantity; two parallel returns of the last unit (one 409); discounted line shares adding up exactly; a lowered refund and `REFUND_TOO_HIGH`; per-payment caps; a trade-in sale's cash refund; another shop's line; Back to stock vs Damaged stock; a phone to INSPECTION; a buy-back blocking a phone return; `OVERRIDE_REASON_REQUIRED` (expired, Checking only, No warranty) and an accepted override; a return that can't go through uses no PIN attempt; the `client_request_id` cases in P7-24; void after a return refused; RET numbering per branch and day; secret exposure on every new response; existing void and sales tests unchanged. _Added in 0b planning:_ a phone's second life (sold on A, returned, passed, sold on B, returned on B: the inspection list shows it once, linked to B's return; a further return on A is `RETURN_QTY_EXCEEDED`; stock right at each step). |
| **A** | `salesService.createReturn` (30 s timeout, `client_request_id`), `inspection` service calls; `utils/returnMath.js` (shares, the trade-in part, warranty status) tested on the server's cases; `utils/returnErrors.js` (R1–R12, PIN codes, re-read on a lost response); `schemas/returnSchema.js` (reason presets, override reason, refund rows); `REFUND_SALE` for all roles. _Added in step 0a:_ the till words the trade-in IMEI 409 by `existing_unit.status` (P4-7) and has no wording for **INSPECTION** yet: add one ("This phone (IMEI …) was returned and is waiting to be checked. It can't be taken in again."), and check the other places that word a unit status (the `addLine` 409 "not available (status: …)", the other-shop line 409) show INSPECTION sensibly. | Unit tests. |
| **B** | `ReturnDialog`, step 1: from Sale detail (button and R); lines with quantity steppers capped at what is returnable, Back to stock / Damaged, "Goes to inspection", "Not our stock", each line's warranty status (P7-20, P7-22). | Mocked-API harness screenshots at 1366×650 and 1526×640, light and dark, and 390px. |
| **C** | `ReturnDialog`, step 2: refund due and a lowerable refund amount, refund rows limited to cash and this sale's non-cash payments (with reversal references), the trade-in note, reason presets, the override reason when needed (P7-23), `ManagerApprovalFields`; submit once per press; every error inline by code; the lost-response re-read and Try again with the same id (P7-15). | A partial return and an outside-warranty return on the dev backend; harness screenshots. |
| **D** | `ReturnSlip` (P7-17) on the receipt's layout values, two copies, auto-print after success, Reprint from the Returns section. | Save as PDF, then one real XP-80 print of both copies. |
| **E** | Recent sales badges, "Returned N of M", the Returns section, no Void on a sale with returns, `RET-` search (P7-18). | Harness screenshots; checked on the dev backend. |
| **F** | **Phones to check** (`/pos/inspection`, managers and admins; a header link with a count): INSPECTION phones from `GET /sale-returns/inspection`, with sale, IMEI, days waiting and **Passed: back to stock** (P7-7). | Dev backend check; harness screenshots. |
| **G** | "P7 as built" here, `pos-till-setup.md` section 7 (both migrations before the new backend; returns, overrides and Phones to check at the till), FOLLOWUPS. | Docs reviewed. |

### P7 as built (2026-10-23)

**Done.** Backend #42 (0c), #43 (0a) and #44 (0b); frontend on `feature/pos-p7-frontend` (steps A–G). Frontend suite: 1174 tests in 68 files. Layouts judged with the mocked-API harness at 1366×650 and 1526×640 in light and dark, plus 390px; the real checks were done on the dev backend (returns in cash, to a card and to a card-only sale, a wrong PIN first, an outside-warranty override, a phone to inspection and passed, RET search, reprints) and on the shop's XP-80 in kiosk mode (both slip copies, REPRINT slips, and a sale receipt unchanged).

| Step | What shipped |
|---|---|
| 0c (#42) | One global lock order for stock rows and product units (`lockInventoryRows`), used by `completeSale`, `voidSale`, `createForTradeIn`, returns and the inspection pass; no schema change. |
| 0a (#43) | `INSPECTION` unit status (migration `AddProductUnitInspectionStatus`: the CHECK and the live-IMEI index), `LIVE_UNIT_STATUSES`, the other-shop IMEI check on live statuses, `POST /product-units/:id/inspection-pass` with `INSPECTION_PASSED`. |
| 0b (#44) | Migration `CreateSaleReturns` (`sale_returns`, `sale_return_lines`, `sale_refunds`, `sale_lines.returned_quantity`, the counter's `kind` for `RET-` numbers), `POST /sales/:id/returns` (R1–R12, the PIN, the warranty override, `client_request_id`), `GET /sale-returns/inspection`, `returns[]` / `return_state` / `refunded_total` on the sale reads, `SALE_HAS_RETURNS` on void, the `RETURN` audit row. |
| A | `createReturn` (30 s, resend with the same `client_request_id`), `passInspection`, `listInspection`; `utils/returnMath.js` (the server's refund-share and trade-in cases copied verbatim), `utils/returnErrors.js` (every code), `schemas/returnSchema.js`; `REFUND_SALE` for all roles; INSPECTION wording for trade-ins, adding a line and completing a sale. |
| B | `ReturnDialog` items step: steppers capped at what is left, Back to stock / Damaged, Goes to inspection, Not our stock, Not stock-tracked, warranty status per line, Sold N days ago, the refund due; Return items (R) on Sale detail. |
| C | Refund and approval: rows that start the way the sale was paid, reversal references, a lowered refund with its reason, the trade-in share, the override reason, `ManagerApprovalFields`; every error by code; the lost-response re-read and Try again; the Return recorded panel. |
| D | `ReturnSlip`, two copies (the shop's with a signature line for cash), printed as two jobs after a return; Print again; the receipt's header and styles shared (`receiptParts`, `receiptStyles`). |
| E | Recent sales: one status badge per row, "Refunded LKR X", RET search. Sale detail: Items \| Returns tabs, "Returned N of M", a Refunded row, Reprint slip (REPRINT), no Void once a sale has a return. |
| F | Phones to check (`/pos/inspection`, managers and admins): the list, Passed: back to stock with a confirm, every error by code; a header link with a count; Sale detail opens on Returns from there. |
| G | This section, `pos-till-setup.md` section 7, FOLLOWUPS. |

**Decisions that changed while building:**

- **The trade-in share is capped at the refund** (A, then a fix after #45). The server's formula had no upper bound, so after earlier refunds larger than the sale's non-trade-in money its `RETURN` audit text could say "includes LKR 36900.00 from a trade-in" on a 1,600.00 refund. The till capped its own figure from step A; the fix PR `fix(returns): cap the trade-in share at the refund in the RETURN audit text` moved the cap into `tradeInShareCents` on both sides (`backend/src/sales/return-math.ts` and the till's exact copy in `utils/returnMath.js`, with the new spec case copied verbatim), and an e2e checks the audit text of a later return.
- **Stock tracking is read once per opening**, branch-wide (`GET /stock?branchId=`), because sale lines don't say whether a product is stock-tracked, which decides whether a line takes a condition (A, B; FOLLOWUPS).
- **The return dialog is 896px wide** (a new `xl` size on the common Dialog): product names are never truncated, and a row's controls move under its details only when there is no room (B, from the dev-backend screenshots).
- **How the sale was paid, and any refusal, stay above the refund step's scrolling part**, so an error is never scrolled out of view (C, from the harness).
- **Refund rows start the way the sale was paid**: card, bank, Koko and Mintpay payments first, each up to what is left of it, the rest in cash. Adding a payment row takes its amount from cash; removing one gives it back; an empty cash amount is no cash (C, from a card-only sale on the dev backend, where removing the card row left the refund at 0).
- **Money in error messages has thousands separators** (C).
- **The two slip copies are two print jobs**, the second rendered, measured and printed only after the first `window.print()` returns, each with its own page height; the sale receipt's output is byte-identical after the shared-header refactor (D).
- **Items | Returns tabs instead of a Returns card under Items** (E): at ~640px the card left one line of Items and not one whole return in view. "Returned N of M" sits on the qty row, so a returned line keeps its height.
- **One status badge per Recent sales row** (Completed, Part returned, Returned, Voided), and "Refunded LKR X" at 12px: at 11px its thousands comma read like a dot (E).
- **Sale detail honours `from.path` and a Returns-tab request**, so Phones to check opens a sale on Returns and Esc comes back (F).
- **The terminal header's branch chip hides below 640px**, so the Phones to check link fits at phone width; the status strip still names the branch (F).
- **Focus goes back into the confirm dialog after an error** (Cancel after a refusal, Try again after a lost answer): both buttons are disabled while the POST is in flight, so it used to fall out (F).

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
| **P4 — Trade-in** _(revised P4)_ | TRADE_IN as method 6 in `PaymentDialog` (see §8 P4 decision log). Built in five steps, each a checkpoint: **A.** `methods.js` key 6; `paymentSchema` tradeIn branch (value ≤ balance, IMEI shape, resale > 0, no duplicate IMEI on the sale); `buildPaymentPayload` sends `amount = trade_in_buying_price`; the pending payment row carries the `trade_in_*` fields and the trade-in selectors count pending rows. **B.** `TradeInFields`: product combobox (P4-3), IMEI with Enter → next field and the Luhn hint (P4-7), trade-in value, resale price, notes; Amount swapped for Trade-in value; 3×2 picker; 409 messages by `existing_unit.status`. **C.** No-customer flow (P4-2: inline panel, attach then reopen, F6); Change / F3 guard (P4-11). **D.** PaymentsList TRADE_IN row (P4-8, P4-9); TRADE_IN-only remove confirm (P4-10). **E.** Planning-doc touch-ups and FOLLOWUPS entries. The P2 Detach guard stays as built (Q19); P4 adds Change / F3. Trade-in IMEI 409 at add only: complete-time 409s are P5. Buy-back needs no P4 work (#27). _Shipped (revised P4 build):_ C also added the customer-NIC rule (P4-13, backend #29) and the verified F6 (P4-14); D's row truncation at phone width is accepted (P4-15). The frontend suite went from 240 to 321 tests (23 files). | P1, P2, P3; backend #27, #29 | 8 unit, 12 component (as built: 81 new tests) |
| **P5 — Complete sale, confirmation, receipt** _(revised P5, see §8 P5 decision log)_ | Built in steps, each a checkpoint. **0.** Backend micro-PR, merged first: warranty snapshot on sale lines at complete (P5-1), complete-time 409 details (P5-2), and the two wrong statements on sale numbers and repeated completes. **A.** Slice: `completeSale` in `salesService`, the complete thunk through the mutation queue (`completing` → `completed`, `lastCompletedSale`), the 30 s timeout and re-fetch on a lost response (P5-7), `utils/completeErrors.js` (E1–E12, P5-8), `lastCompletedSaleId` in `terminalSessionStore`. **B.** Opens with the **printer spike** (P5-13: a minimal 80mm page with a dynamic `@page` height, printed on the real XP-80T) and the OS-level F9 check (P5-4). Then the Complete sale button in TotalsPanel (P5-3), F9, `CompleteSaleDialog` with the stock re-check (P5-5, P5-6). **C.** Complete errors (P5-8): line and trade-in-row highlights, the NIC field in the dialog. **D.** `SaleCompletePanel` (P5-9), the background next draft and scan-to-next (P5-10), Reprint last receipt on the Current sale card (P5-12); measured with the mocked-API harness at 1366×650 and 1526×640. **D2** _(added P5)_. The cart's warranty select per line (P5-18). **E.** `Receipt` and `utils/printReceipt.js` (P5-11, P5-13), auto-print and Reprint (P5-12), `constants/receipt.js` with the shop's text (P5-14); Save-as-PDF check, then a real print. **D3** _(added P5)_. Line discounts (P5-20) and the No warranty / Checking receipt wording (P5-19). **F.** `docs/frontend/pos-till-setup.md` (P5-16), planning-doc touch-ups, FOLLOWUPS. Existing TotalsPanel tests that assert the Ready box change in B (listed old/new/reason at that checkpoint). | P1–P4; backend step 0 | ~10 unit, ~25 component |
| **P6 — Recent sales, sale detail, reprint, void** _(added P5, see §8 P5-15; was P5; revised P6, see §8 P6 decision log)_ **Done**: see §8 "P6 as built". | Built in steps, each a checkpoint. **0a.** Backend PR, merged first: `GET /sales` gains `completedFrom` / `completedTo`, `sort=completed_at`, `customer` on each row and the `q` search (P6-2, P6-3, P6-5), with a `(branch_id, completed_at)` index; `findOne` loads `voider`; the void 409s gain `imei`, `reason` and `later_sale`, and the phone-purchase message (P6-22); `docs/backend/sales.md` and the void 409 Swagger text (it names only the resold case). **0b.** Backend PR, the approval PIN (P6-15 – P6-21): the `users` PIN columns and `sales.void_requested_by` with its backfill and CHK (one migration, up/down), `ApprovalsService` (weak-PIN rule, the stored lockout), `GET /approvers` (`{ id, full_name }` only), `PUT /auth/me/approval-pin`, `DELETE /users/:id/approval-pin`, `has_approval_pin` on `/auth/me`, **`approval` required on every void** (all three roles), the audit entries (PIN set, cleared, failed, locked; never the PIN), `void_requester` on `findOne`, and the secret-exposure e2e extended to every user, sale, void and approver-list response; a new `docs/backend/approvals.md`. Its own PR because it is security-sensitive and reviewed on its own; it follows 0a (both touch the void endpoint). Steps A–C don't wait for it; **D does** (no void without a PIN). **A.** `listSales`, `voidSale` in `salesService`, `approvalsService`, `utils/colomboDay.js`, `utils/voidErrors.js`, `schemas/voidSchema.js` (presets, P6-9). **B.** Opens with the OS-level Alt+R check (P6-1). Routes, the header Sales button, the list page with day stepper, search and Load more (P6-2 – P6-5); harness screenshots. **C.** The detail page (P6-6) and Reprint, with the Receipt's REPRINT and VOIDED variants (P6-7); Save as PDF, then a real print of each. _Revised in step C:_ the real check in C is the **REPRINT** receipt only (Save as PDF and one XP-80 print of a completed sale reprinted from the detail page); the voided detail page and the VOIDED receipt are covered by the mocked-API harness and receipt PDFs in C, and checked for real at the D2 checkpoint, once a sale can be voided through the dialog. "Last receipt" always re-fetches and prints nothing if that fails (never the in-memory copy). **D1** (needs 0b). `ApprovalPinDialog` in the user menu (P6-18), so a manager can set a PIN before anything asks for one. **D2** (needs 0b). `VoidSaleDialog` with `ManagerApprovalFields` on every session (approver defaulting to the session's manager or admin, P6-20): presets, effects, what to hand back, void and PIN errors, the re-fetch on a lost response, Last receipt after a void (P6-9 – P6-13, P6-17 – P6-20). _Built in D2:_ `VOID_SALE` opened to cashiers; Void and **V** on the detail page for COMPLETED sales only (none on a VOIDED one). The approver list is fetched fresh every time the dialog opens (never cached), defaulting to the session user when they are on it. One POST per press: Void disables itself and a ref ignores a second Enter or click while voiding. Lines from another shop read "N items from another shop: not added to our stock. Return them to that shop yourself." The PIN is cleared after every attempt (the shared `PinField`, extracted from D1). On success the page shows the returned voided sale and focus goes to Reprint. _Added in step C:_ the D2 checkpoint includes the real voided checks moved from C: the voided detail page (banner, Reversed tenders) against the dev backend, and the VOIDED receipt (from the detail page's Reprint and from Last receipt) as Save as PDF plus one real XP-80 print. _Note for D2 (added in 0b):_ the dialog shows **403 `WRONG_PIN` / `APPROVER_*`** and **423 `PIN_LOCKED`** inside the dialog, beside the PIN field (with `attempts_left` or the unlock time), and `VOID_WRONG_BRANCH` likewise; the axios layer must **not** treat these 403s as a permission failure (no redirect, no "not allowed" handling): they are answers about the PIN, read from `code`. **E.** Planning-doc touch-ups, `pos-till-setup.md` (reprints, refunds outside the system), FOLLOWUPS. | P5; backend 0a, 0b | ~12 unit, ~30 component |
| **P7 — Returns and refunds** _(added P6, see §8 P6-24; planned 2026-10-23, see section 8 "P7 decision log"; **done**, see section 8 "P7 as built")_ | Built in steps, each a checkpoint (the full table is under "P7 steps" in section 8). **0c.** Backend PR: the global lock order from FOLLOWUPS (P7-25). **0a.** Backend PR: the `INSPECTION` unit status in the CHECK, the live-IMEI index and `LIVE_UNIT_STATUSES`, the external-line IMEI check on live statuses, `POST /product-units/:id/inspection-pass` (P7-6, P7-7). **0b.** Backend PR: `sale_returns`, `sale_return_lines`, `sale_refunds`, `sale_lines.returned_quantity`, the counter's `kind` (`RET-` numbers), `POST /sales/:id/returns` with the approval PIN, the warranty override and `client_request_id`, `GET /sale-returns/inspection`, the sale read additions, `SALE_HAS_RETURNS` on void, the `RETURN` audit row (P7-1 – P7-15, P7-22 – P7-24, P7-26). **A.** Services, `returnMath`, `returnErrors`, `returnSchema`, `REFUND_SALE` for all roles. **B.** `ReturnDialog` items step. **C.** Refund and approval step. **D.** Two-copy return slip (real XP-80 print). **E.** Recent sales and Sale detail. **F.** Phones to check. **G.** Docs. | P6 (approval PIN); backend 0c, 0a, 0b | ~15 unit, ~35 component; backend e2e per step |
| **P8 — Keyboard, polish + E2E** _(was P6, revised P5; was P7, revised P6; line discounts moved to P5, P5-20)_ | Full §6 hotkey map with `Kbd` chips on pointer devices, `KeyboardHelpOverlay`, scan queue hardening, focus-return audit (keyboard) and no-auto-focus check (touch); stock warning (Q1); merge on rescan: a non-serialized product already in the cart increments the existing line's qty instead of adding a new line _(added P3)_; user-friendly error mapping for network/raw errors in cart and payment messages (e.g. "Network Error") _(added P3)_; Playwright smoke flows: cash sale, split tender, serialized + trade-in sale, void (a manager's own PIN, and a manager's PIN on a cashier's session), and a return once P7 ships _(revised P6)_ — each at a desktop viewport, with the cash sale and trade-in also at a 390 px mobile viewport. | P0–P7 | 10 unit, 10 component, 6 e2e |
| **Total** | | | **~89 unit, ~108 component, ~6 e2e** (without P7; P7 adds ~15 unit, ~35 component) |

**Backend prerequisites (small, separate PRs):** Q13 (customer relation on `findOne`) lands before P0. P5 step 0 (P5-1, P5-2) lands before P5. P6 step 0a (sales list and detail, the void 409 details) and step 0b (the approval PIN) land before the P6 steps that need them (§9 P6 row) _(revised P6)_. P7's backend lands as three PRs in the order 0c, 0a, 0b, before the frontend steps (section 8 "P7 steps") _(revised P7)_. Optional later: Q9(b) cashier IMEI lookup.

---

## 10. Deferred scope

Not in Phase 6.4:

- **Parked / held sales** (multiple open carts per cashier) — **Phase 6.5**.
- **Receipts beyond the printed 80mm receipt:** PDF, SMS/WhatsApp receipt, ESC/POS or WebUSB printing — **Phase 6.6**. _(Revised P5:)_ the printed thermal receipt through the browser and the Windows driver is in P5 (§1 #12a, §8 P5-11 – P5-13), because customers expect one at every sale.
- **External-sourcing settlement** (friendly-shop payables, `Supplier.getSalesCount` UI) — **Phase 6.7**. Selling external-supplier lines is R1.1 per Q12.
- **User management frontend** (create/edit users, roles, branch assignment, password change) — **Phase 6.8**.
- **AWS deployment** — **Phase 6.9**.
- **Phone purchase intake screen** (`POST /phone-purchases`, buying a phone outright, not as a trade-in) — backend exists; frontend deliberately not in 6.4 (confirmed).
- **Customer management pages** (full CRUD list, soft delete/restore) — only inline search/create inside the terminal ships.
- **Product-unit admin browser** (`/product-units` list/detail).
- ~~**Refunds / partial returns**~~ _(revised P6:)_ **moved into 6.4 as P7 — Returns and refunds** (§8 P6-24), because returns, including partial ones, happen regularly. Void stays all-or-nothing, for mistakes. _(Done: section 8 "P7 as built".)_
- **Returning faulty phones to their supplier** — with the supplier-receiving phase (FOLLOWUPS), since it needs to know which supplier a phone came from (§8 P6-24). Until then a faulty returned phone stays in `INSPECTION` on Phones to check and is set aside physically (FOLLOWUPS "Faulty returned phones").
- **Payment edit** (`PATCH` payments, including inline CASH edit; reaffirmed in P3-1), sale-level notes, recent-sales filters beyond today — R1.1.
- **Camera barcode/IMEI scanning** — not planned; the shop uses a hardware scanner (Q22).
- **Offline mode**, multi-language UI, cash drawer integration (the shop has no drawer), card-terminal integration, customer-facing display.
- **Multi-branch scoping** of reads (R9).
