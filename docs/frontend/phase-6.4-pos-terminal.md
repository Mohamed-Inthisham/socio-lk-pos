# Phase 6.4 — POS Terminal (Frontend) — Planning

**Status:** planning. No code yet. Section 8 lists the open decisions; build starts after they are answered.

**Backend contract:** [docs/backend/sales.md](../backend/sales.md), [docs/backend/used-phones.md](../backend/used-phones.md), Swagger at `/api/docs` (dev). All endpoints below are under `/api/v1` and use the httpOnly-cookie session.

**Grounding notes (facts found while researching, not decisions):**

- Line and payment `POST`/`PATCH`, `complete`, and `void` **return the full hydrated sale** (branch, cashier, lines, payments, totals). Line/payment `DELETE` and `DELETE /sales/:id` return **204**. `POST /sales` and `PATCH /sales/:id` return the **bare sale row** (no lines/payments). After a 204 or a bare-row response, re-fetch with `GET /sales/:id` if the cart needs refreshing.
- `GET /sales/:id` loads `branch`, `cashier`, `lines`, `payments` — **not `customer`**. Only `customer_id` comes back.
- Money fields are numeric **strings** (`"60000.00"`); request bodies take **numbers**.
- `GET /products` returns a **plain array** (unpaginated, no text-search param). `GET /products/by-barcode/:barcode` is the scan lookup. `GET /sales` is **paginated** (`{ data, meta }`, filters `branchId`, `cashierId`, `status`, `from`, `to`, `page`, `limit≤200`).
- `GET /product-units?imei=` is **admin/manager only** — a cashier cannot resolve an IMEI to a product today.
- `addLine` does **not** check stock. Insufficient stock surfaces only at `POST /sales/:id/complete` (409).
- `POST /sales` requires `branch_id`. Staff users have one; **admins have `branch_id = null`**.
- The frontend's `mapBackendUser` (`frontend/src/services/authService.js`) currently **drops `branch_id` and `branch`** from `/auth/me` and `/auth/login`. Must be fixed before the terminal can create sales.
- The frontend has **no test runner** (no Vitest/Jest/RTL in `package.json`, no test files). `docs/architecture.md` names Vitest + React Testing Library + Playwright as the intended stack.
- There is **no toast component**. Errors render as inline red boxes. "Real Toast primitive" is listed under Deferred infrastructure in `FOLLOWUPS.md`.

---

## 1. Scope

Minimum-viable R1 cashier flow. "R1" = ships in Phase 6.4. "R1.1" = flagged for deferral; see §8 for the ones that need your call.

| # | Screen / interaction | Purpose | Description | Release |
|---|---------------------|---------|-------------|:-------:|
| 1 | **Login** | Authenticate | Reuse `LoginPage` as-is. After login, cashiers land on `/pos` instead of `/dashboard` (role-based redirect). | R1 |
| 2 | **Terminal shell** | Frame for the whole flow | Full-height layout: scan bar on top, cart on the left, totals + payments panel on the right, status strip (branch, cashier, network) at the bottom. Hosts the global hotkey handler and the draft-sale lifecycle (create on first item, resume on reload). | R1 |
| 3 | **Product search / scan input** | Get items into the cart | A single always-focused input. Enter on a value runs an exact barcode lookup first, then falls back to a name/SKU search over the branch catalog with a keyboard-navigable result list. | R1 |
| 4 | **Serialized item IMEI prompt** | Sell a specific phone | When the chosen product has `is_serialized = true`, a small dialog asks for the IMEI (scan or type) before calling `addLine` with `quantity: 1`. Handles 400 (IMEI not found / wrong product) and 409 (unit not IN_STOCK, with `existing_unit`). | R1 |
| 5 | **Cart view** | Show and edit lines | Rows show name, IMEI (if any), qty, unit price, discount, line total. Qty edit (non-serialized only) and line remove; every edit replaces the cart from the server response. | R1 |
| 6 | **Line discount** | Price adjustment | Per-line `{ type: AMOUNT|PERCENT, value }` via `PATCH .../lines/:lineId`. Permission question in §8 (Q11). | R1 (pending Q11) |
| 7 | **Customer attach** | Link the sale to a customer | Search `GET /customers?search=` by name/phone/NIC; pick one, or create inline (`POST /customers` with name, phone, optional NIC), then `PATCH /sales/:id { customer_id }`. Detach sets `null` — blocked while a TRADE_IN payment exists. | R1 |
| 8 | **Payment entry — CASH** | Take cash | Amount defaults to remaining balance; cashier types cash received; change is shown live. Sends `{ payment_method: CASH, amount, cash_received }`. | R1 |
| 9 | **Payment entry — CARD / BANK_TRANSFER / KOKO / MINTPAY** | Take reference-based tenders | Same dialog, method switch hides cash-received and shows a required reference number (auth code / slip ref / provider txn id). | R1 |
| 10 | **Payment entry — TRADE_IN** | Accept a used phone as payment | Requires a customer on the sale. Collects trade-in product (serialized products at the branch), IMEI, buying price (= amount, locked together), optional selling price and notes. 409 on IMEI already in inventory. | R1 |
| 11 | **Payment list + remove** | Correct mistakes | Payments panel lists tenders with remaining balance. Remove = `DELETE .../payments/:id`. Edit is not exposed (remove + re-add); TRADE_IN is frozen server-side anyway. | R1 (edit: R1.1) |
| 12 | **Complete sale confirmation** | Commit the sale | Enabled only when `amount_paid === total`. Confirm dialog shows totals, tenders, change due; `POST /sales/:id/complete`. Success shows a "Sale complete" panel with sale number and change, then a fresh terminal. 409s (stock, IMEI race, trade-in IMEI) show inline with the offending line/payment highlighted. | R1 |
| 13 | **Discard draft** | Abandon a cart | `DELETE /sales/:id` behind a confirm. Also offered when starting a new sale with a non-empty draft. | R1 |
| 14 | **Recent sales list** | Look up today's sales | Paginated `GET /sales` scoped to this branch (and today by default); shows sale number, time, cashier, total, status. Row opens a read-only detail. | R1 |
| 15 | **Sale detail (read-only)** | Inspect a completed/voided sale | Lines, payments (with reversal stamps), totals, trade-in info. Host for the Void action. | R1 |
| 16 | **Void sale flow** | Reverse a completed sale | Admin/manager only (`VOID_SALE`). Reason required (≥ 3 chars). Cashiers see the button disabled with a tooltip ("visible but disabled" pattern). 409 when a trade-in was resold — message tells the operator to void the later sale first. | R1 |
| 17 | **Keyboard help overlay** | Discoverability | `?` / F1 opens a cheat sheet of the shortcuts in §6. | R1 |
| 18 | **External-supplier (friendly-shop) lines** | Sell stock sourced from another shop | `addLine` with `external_supplier_id` (+ free-text IMEI for serialized). | **R1.1 candidate** — Q12 |
| 19 | **Sale-level notes** | Free-text on the sale | `PATCH /sales/:id { notes }`. | **R1.1 candidate** |
| 20 | **Payment edit** | Fix an amount without remove + re-add | `PATCH .../payments/:id`. | **R1.1** |
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
| Current draft sale (lines, payments, totals, status) | Redux `terminalSlice` | Domain state; matches the existing ADR. DevTools action log is useful when a cashier reports "the total was wrong". |
| Draft sale id across reloads | Zustand `terminalSessionStore` (persisted) | It is a pointer, same category as `activeBranchStore`. Cleared on logout. |
| Product catalog for the branch | Redux `posCatalogSlice` (or reuse a new `productsSlice`) | Read-mostly reference data shared by scan, trade-in picker, search. |
| Dialog open/close, search results, form fields | Component state | View-local, as in Path B. |
| Recent sales list | Component state on the page | View-specific list, as with `ProductsList`. |

Zustand is **already used** (theme, layout, active branch). It is not proposed for cart state because the cart is server state, not a UI preference.

**`terminalSlice` shape (proposed):**

```js
{
  sale: null,            // full hydrated sale from the last server response, or null
  customer: null,        // fetched separately (GET /customers/:id) — sale response has no customer relation
  status: "idle",        // idle | creating | ready | mutating | completing | completed | error
  pendingOp: null,       // e.g. "addLine" — drives per-control spinners
  error: null,           // { message, existing_unit?, target?: { lineId | paymentId } }
  lastCompleted: null,   // { sale_number, change_due, total } for the "Sale complete" panel
}
```

**Optimistic updates: none.** Line/payment mutations return the authoritative sale; the reducer replaces `state.sale` wholesale. Reasons: totals, discounts, rounding and line numbers are computed server-side; a wrong optimistic total at a till is worse than a ~100 ms wait; it removes reconciliation code. UI stays responsive with per-control spinners and the scan input never blocks (queued scans — see §6).

**Server ↔ client sync:**

- No DRAFT exists until the first item is added (or a customer is attached). First mutation → `POST /sales { branch_id }` then the actual mutation. Avoids empty drafts on every page load.
- After each mutation the client holds exactly what the server returned. Line/payment `DELETE` (204) is followed by `GET /sales/:id`. `PATCH /sales/:id` (customer attach) returns the bare row — merge its `customer_id`/`notes` into the held sale rather than replacing it.
- If any call returns 400 "Only DRAFT sales are mutable" or 404, the client drops the draft and shows "This sale is no longer open" (another tab or user completed/discarded it).

**Page reload mid-sale:**

1. On terminal mount, read `draftSaleId` from `terminalSessionStore`.
2. `GET /sales/:id`. If DRAFT and same branch → restore (and fetch customer if `customer_id`). If COMPLETED/VOIDED/404 → clear the pointer, start fresh.
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

**New service:** `services/salesService.js` (`createSale`, `getSale`, `listSales`, `updateSale`, `discardSale`, `addLine`, `updateLine`, `removeLine`, `addPayment`, `removePayment`, `completeSale`, `voidSale`), plus `customersService.js` (`searchCustomers`, `getCustomer`, `createCustomer`).

**Thunks** in `terminalSlice` wrap service calls and normalize errors to `{ message, status, existing_unit? }`.

**Retries:**

- **GETs:** one automatic retry after 1 s on network error / 5xx (catalog, `GET /sales/:id`, customer search).
- **Mutations: never auto-retried.** `POST .../payments` and `POST .../complete` are not idempotent; a retried payment after a lost response could double-record a tender. On a network error during a mutation, the client re-fetches `GET /sales/:id` and shows the real state ("Connection lost — here is what the server has").

**Offline:** none in R1 (see Q4). A network-status indicator in the status strip (`navigator.onLine` + last request outcome); mutations disabled while offline.

**Catalog loading:** `GET /products?branchId=<terminal branch>` once on terminal mount, filtered client-side for search (same strategy as `ProductsList`). Barcode scans always go to `GET /products/by-barcode/:barcode` (authoritative, handles manufacturer barcodes) and fall back to the in-memory catalog only for name search.

---

## 6. Keyboard-heavy UX

**Approach: vanilla — one `useHotkeys`-style hook (~40 lines) registered at `TerminalLayout`, plus native focus management. No library.** Headless UI already traps focus inside dialogs and restores it on close; the remaining need is a global keydown map and "return focus to the scan input". Alternative in Q17.

**Global rules:**

- The scan input is the **home position**. Any closed dialog, completed action, or `Esc` on the terminal returns focus to it.
- Function-key shortcuts call `preventDefault()`. **Never bound:** F5 (reload), F11 (fullscreen), F12 (devtools), Ctrl+W/T/N/R (browser-reserved).
- Shortcuts are suppressed while a dialog is open except that dialog's own keys.
- Destructive actions (discard, remove payment, void) always go through a confirm dialog; Enter confirms, Esc cancels.

**Barcode scanners:** USB/Bluetooth scanners in HID mode type characters quickly and send Enter. The scan input treats Enter as "submit this value": try exact barcode (`by-barcode`), then catalog name/SKU search. No keystroke-timing heuristics in R1 (a typed SKU + Enter behaves the same as a scan, which is fine). While an `addLine` is in flight, further Enter submissions are **queued in order** and processed sequentially so fast consecutive scans aren't lost or reordered.

| Screen | Key | Action |
|--------|-----|--------|
| Terminal (global) | F2 | Focus scan input |
| | F3 | Customer attach dialog |
| | F4 | Payment dialog (method defaults to CASH) |
| | F6 | Trade-in dialog |
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
| Payment dialog | 1–6 | Pick method (CASH, CARD, BANK_TRANSFER, KOKO, MINTPAY, TRADE_IN) |
| | Tab | Amount → cash received / reference → submit |
| | Enter | Record payment |
| Payments panel | Alt+P then ↑/↓, Delete | Select and remove a payment |
| Complete confirm | Enter / Esc | Complete / back |
| Sale complete panel | Enter or any scan | Start next sale |
| Customer dialog | type → ↓/↑ → Enter | Search and pick; Ctrl+N new customer |
| Recent sales | ↑/↓, Enter | Open sale; Esc back to terminal |
| Sale detail | V | Void (admin/manager) |

Final bindings get a usability pass with an actual cashier — see Q17.

---

## 7. Component architecture

**Shared primitives stay in `components/common/`** (Button, InputField, Select, Table, Dialog, ConfirmDialog, Tooltip, Drawer). New primitives added there only if generic: `MoneyText` (LKR formatting + `tabular-nums`), `Kbd` (shortcut badge), `Toast` (if Q5 = yes), `StatusBanner`.

**Feature components in `components/pos/`**, pages in `pages/Pos*`, shell in `components/layout/TerminalLayout`.

```
components/layout/TerminalLayout/        # full-screen frame, status strip, hotkey provider, <Outlet/>
components/pos/
  BranchContextGuard/
  ScanBar/                               # scan input + search results popover + scan queue
  ImeiPromptDialog/
  Cart/
    CartTable/                           # rows, selection, keyboard nav
    CartLineRow/
    LineDiscountDialog/
  CustomerPanel/
    CustomerAttachDialog/                # search + pick
    CustomerCreateForm/                  # inline create (react-hook-form + zod)
  Payments/
    PaymentsPanel/                       # tenders list, remaining balance, remove
    PaymentDialog/                       # method switch; renders one of:
      CashFields/
      ReferenceFields/                   # CARD, BANK_TRANSFER, KOKO, MINTPAY
      TradeInFields/                     # or TradeInDialog — see Q2
  TotalsPanel/
  CompleteSaleDialog/
  SaleCompletePanel/
  DiscardDraftDialog/
  RecentSalesTable/
  SaleDetailView/
  VoidSaleDialog/
  KeyboardHelpOverlay/
pages/PosTerminal/  pages/PosRecentSales/  pages/PosSaleDetail/
services/salesService.js  services/customersService.js
store/slices/terminalSlice.js  store/slices/posCatalogSlice.js
store/zustand/terminalSessionStore.js
hooks/useHotkeys.js  hooks/useTerminalBranch.js
schemas/paymentSchema.js  schemas/customerSchema.js  schemas/voidSchema.js
utils/money.js                           # formatLKR, toCents, fromCents
```

**Payment modal composition:** one `PaymentDialog` owns method selection, amount, and submit; the method-specific fields are child components selected by method. Each child exports its zod schema fragment, and the dialog builds a discriminated union (`z.discriminatedUnion("payment_method", [...])`) mirroring the backend rules (CASH needs `cash_received >= amount`; reference methods need `reference_number`; TRADE_IN needs product, IMEI, buying price = amount, and a customer on the sale). Client validation is a convenience; the server stays authoritative.

**Data flow:** pages and feature components dispatch `terminalSlice` thunks and read selectors (`selectSale`, `selectRemaining`, `selectCanComplete`, `selectHasTradeIn`); they never call services directly, except dialog-local lookups (customer search, catalog search).

---

## 8. Open design questions

Each needs a human decision. The recommended default is what gets built if you say "go with defaults".

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
- **Default: (a)**, with a screenshot review at the end of slice 1. **Needs your input:** is there a mockup, a reference POS you like, or a target screen size (e.g. 1366×768 laptop, 15" touch monitor)?

**Q7. Terminal layout — full-screen or inside the app shell?**
- (a) Own `TerminalLayout` without sidebar/header. (b) Inside `AppLayout` (sidebar visible). (c) Inside `AppLayout` with the sidebar auto-collapsed.
- **Default: (a)** — screen space goes to the cart; exit link returns to the app.

**Q8. Draft persistence across reload.**
- (a) Persist `draftSaleId` locally (Zustand persist), re-fetch on mount. (b) No local state; on mount query `GET /sales?status=DRAFT&cashierId=<me>&branchId=<b>` and resume the newest. (c) Don't resume; reload loses the cart (draft stays orphaned server-side).
- **Default: (a)**, with (b) as fallback when the pointer is missing. Note: (b) can find several drafts — parked sales (6.5) is what properly handles that.

**Q9. Scanning an IMEI directly.** Cashiers can't resolve IMEI → product (`/product-units` is admin/manager only).
- (a) Product-first only: scan/search product, then IMEI prompt (works today). (b) Add a cashier-accessible backend lookup (e.g. `GET /product-units/by-imei/:imei` returning product + status) so scanning a phone's IMEI sticker adds it directly. (c) Open `/product-units` read to cashiers.
- **Default: (a) for R1**, (b) as a small backend follow-up if cashiers find the two-step flow slow. **Needs your input:** do the used phones carry a product barcode label, or only the IMEI?

**Q10. Admin at the terminal.** Admins have no `branch_id`.
- (a) Use the header `activeBranchStore` selection; block with a picker if unset. (b) Admins cannot use the terminal. (c) Ask on every terminal open.
- **Default: (a).**

**Q11. Discount permission.** Frontend `APPLY_DISCOUNT` is admin + manager only; the **backend lets any role set line discounts**.
- (a) Follow the frontend permission — cashiers see the discount control disabled (backend gap logged in FOLLOWUPS). (b) Let cashiers discount (change `rolePermissions`). (c) Cashier discount up to a cap, above that needs a manager.
- **Default: (a)**, plus a backend follow-up to enforce it. **Needs your input:** what's the real shop policy?

**Q12. External-supplier (friendly-shop) lines in R1?** Backend supports them; settlement is 6.7.
- (a) R1: supplier picker on add. (b) R1.1. (c) With 6.7.
- **Default: (b) R1.1.** **Needs your input:** how often do sales today involve friendly-shop stock? If daily, move to R1.

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
- **Default: (a).** **Needs your input:** confirm the §6 F-key map, or tell me the keys the shop's current POS uses so muscle memory carries over.

**Q18. Abandoned drafts.** Starting a new sale or logging out with a non-empty draft.
- (a) Prompt: "Discard current sale?" → `DELETE`. (b) Leave it as an orphan DRAFT. (c) Block until completed or discarded.
- **Default: (a)** on new sale; on logout, warn and discard. Orphan cleanup job is out of scope.

**Q19. Removing the customer while a TRADE_IN payment exists.** The backend allows it (FOLLOWUPS entry) and fails later at complete.
- (a) Frontend blocks the detach with a message. (b) Also fix the backend now. (c) Leave it.
- **Default: (a)** in 6.4; backend fix stays in FOLLOWUPS.

**Q20. Language.**
- (a) English only. (b) English + Sinhala. (c) English + Sinhala + Tamil.
- **Default: (a)** for 6.4; strings kept in components (no i18n library yet). **Needs your input** if cashiers need Sinhala/Tamil labels.

**Q21. Cashier landing page.**
- (a) Cashiers land on `/pos` after login. (b) Everyone lands on `/dashboard`.
- **Default: (a).**

---

## 9. Build order (slices)

Each slice is a vertical, demoable increment. Test counts assume Q14 = (a) (Vitest + RTL); "unit" = reducers/selectors/utils, "component" = RTL.

| Slice | Ships | Depends on | Tests (rough) |
|-------|-------|-----------|:-------------:|
| **P0 — Foundations + first runnable cart** | `mapBackendUser` keeps `branch_id`/`branch`; Vitest + RTL setup; `salesService`, `terminalSlice`, `posCatalogSlice`, `utils/money`; `TerminalLayout`, `BranchContextGuard`, `/pos` route + Sidebar link; `ScanBar` (barcode + name search) adding **non-serialized** lines; `CartTable` with qty edit + remove; `TotalsPanel`; discard draft. **Runnable:** log in as cashier, scan items, see totals, discard. | Q6, Q7, Q10 answered | 25 unit, 15 component |
| **P1 — Payments + complete** | `PaymentDialog` with CASH + reference methods; `PaymentsPanel` with remove; `CompleteSaleDialog`; `SaleCompletePanel`; 409 banner on complete (insufficient stock); reload recovery (Q8); network banner; Toast (if Q5 = b). **First real end-to-end sale.** | P0 | 20 unit, 15 component |
| **P2 — Customers** | `CustomerAttachDialog` (search, pick, detach), `CustomerCreateForm` (inline create, NIC 409 → offer existing); customer shown in terminal; `customersService`. | P0 (Q13 backend tweak optional) | 8 unit, 12 component |
| **P3 — Serialized lines** | Serialized products route through `ImeiPromptDialog`; IMEI shown on cart rows; serialized rows lock qty; 400/409 handling with `existing_unit` message; complete-time 409 for cross-DRAFT race highlights the line. | P0, P1 | 6 unit, 10 component |
| **P4 — Trade-in** | TRADE_IN in `PaymentDialog` (product picker over serialized catalog, IMEI, buying = amount, optional selling/notes); requires customer (links to P2 dialog); detach-customer block (Q19); TRADE_IN rows show "frozen" (remove only); trade-in IMEI 409 at add and complete. | P1, P2, P3 | 8 unit, 12 component |
| **P5 — Recent sales + void** | `/pos/sales` list (paginated, today/branch), `/pos/sales/:id` detail; `VoidSaleDialog` (Q15) gated by `VOID_SALE`; resold-trade-in 409 message. | P1 | 6 unit, 12 component |
| **P6 — Keyboard + polish + E2E** | Full §6 hotkey map, `KeyboardHelpOverlay`, scan queue hardening, focus-return audit, stock warning (Q1), discounts (per Q11); Playwright smoke flows: cash sale, split tender, serialized + trade-in sale, void (if Q14 = b). | P0–P5 | 10 unit, 10 component, 4 e2e |
| **Total** | | | **~83 unit, ~86 component, ~4 e2e** |

**Backend prerequisites (small, separate PRs if accepted):** Q13 (customer relation on `findOne`), optionally Q9(b) (cashier IMEI lookup), Q11 backend discount enforcement.

---

## 10. Deferred scope

Not in Phase 6.4:

- **Parked / held sales** (multiple open carts per cashier) — **Phase 6.5**.
- **Receipts:** thermal printing, PDF, SMS/WhatsApp receipt — **Phase 6.6**. 6.4 shows an on-screen summary only.
- **External-sourcing settlement** (friendly-shop payables, `Supplier.getSalesCount` UI) — **Phase 6.7**. Selling external-supplier lines is R1.1 per Q12.
- **User management frontend** (create/edit users, roles, branch assignment, password change) — **Phase 6.8**.
- **AWS deployment** — **Phase 6.9**.
- **Phone purchase intake screen** (`POST /phone-purchases`, buying a phone outright, not as a trade-in) — backend exists; frontend not in 6.4 scope. **Flag:** confirm this is intended to wait.
- **Customer management pages** (full CRUD list, soft delete/restore) — only inline search/create inside the terminal ships.
- **Product-unit admin browser** (`/product-units` list/detail).
- **Refunds / partial returns** (void is all-or-nothing; customer-return flow is a backend followup).
- **Payment edit** (`PATCH` payments), sale-level notes, recent-sales filters beyond today — R1.1.
- **Offline mode**, multi-language UI, cash drawer integration, card-terminal integration, customer-facing display.
- **Multi-branch scoping** of reads (R9).
