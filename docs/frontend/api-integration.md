# Frontend API Integration

## Overview

The frontend talks to the SOCIO.LK POS NestJS backend via a single preconfigured axios instance. Authentication uses httpOnly cookies — the frontend never sees, reads, or stores tokens directly. Session persistence works via `GET /auth/me` on app load, not localStorage.

## Base configuration

- **Location:** `frontend/src/services/api.js`
- **Base URL:** `import.meta.env.VITE_API_BASE_URL` (set in `frontend/.env`, defaults to `http://localhost:3000/api/v1` in dev)
- **`withCredentials: true`** — required for the browser to send/receive httpOnly cookies. Pairs with the backend's CORS `credentials: true`.

## Adding a new API call

Import the shared `api` instance and use standard axios methods:

```javascript
import api from "./api";

export const listProducts = async () => {
  const response = await api.get("/products");
  return response.data;
};
```

No cookie handling, no auth header, no boilerplate — the axios instance handles everything.

## Response shape mapping

The backend uses `snake_case` for some fields (e.g. `full_name`, `is_active`, `created_at`) while the frontend expects `camelCase` or shorter names in some places (e.g. `name` for `full_name`). Mapping is done at the **service boundary**, not in components:

```javascript
const mapBackendUser = (backendUser) => ({
  id: backendUser.id,
  email: backendUser.email,
  name: backendUser.full_name,
  role: backendUser.role,
  avatar: null,
});
```

The rest of the app is unaware of the mismatch. If the backend ever changes shape, only the service boundary needs updating.

## Error handling

Backend errors are surfaced consistently via `extractErrorMessage`:

- NestJS `ValidationPipe` returns `message` as a **string array** (`["email must be a valid email", ...]`)
- Other errors (e.g. 401 Unauthorized) return `message` as a **string**

`extractErrorMessage` handles both. Thrown errors always include `{ cause: originalError }` per the modern error-handling convention.

## 401 refresh interceptor

The critical piece that keeps sessions alive without user intervention:

1. Any authenticated API call that returns 401 is caught by the interceptor.
2. The interceptor calls `POST /auth/refresh`. The still-valid refresh cookie authorizes this.
3. On success, the original request is retried with the new access cookie. **The user never notices.**
4. On failure (refresh token expired/revoked/reused), the interceptor calls `onAuthFailure()` → dispatches `logoutUser` → user redirected to login.

### Concurrency: `refreshPromise` coalescing

If multiple API calls fire at once and all get 401 (e.g., dashboard loading 5 endpoints in parallel), only the **first** 401 triggers a refresh. Subsequent 401s share (`await`) the same in-flight promise. This is essential because the backend has **refresh-token reuse detection** — parallel refresh calls would cause the second one to hit a revoked token and revoke all sessions.

### Auth-endpoint exclusion

`/auth/login`, `/auth/refresh`, and `/auth/logout` are excluded from the refresh loop:
- Refresh loop on failed login → wrong password looks like session expiry (bad UX)
- Refresh loop on failed refresh → infinite loop
- Refresh loop on failed logout → pointless

### Circular-dependency avoidance

`api.js` intentionally does not import the Redux store. Instead, `main.jsx` wires up a callback via `setAuthFailureHandler`. This keeps `api.js` framework-agnostic and avoids the `api → authService → authSlice → store → api` import cycle.

## Session restoration on app load

On mount, `App.jsx` dispatches `restoreSession`, which calls `GET /auth/me`. Because auth cookies are httpOnly, this is the **only** way for the frontend to know whether the user is logged in — there is no local storage to consult.

Possible outcomes:
- **200** → user is populated in Redux, app renders authenticated routes
- **401** → cookies missing or expired. The interceptor may attempt a refresh; on refresh failure, the user lands on the login page

This is why users appear to stay logged in for days — the refresh token (7 days) silently reissues access tokens (15 min) in the background.

## Inventory Overview page

`/inventory` (`frontend/src/pages/InventoryOverview`) shows one row per product from `getStockOverview` in `stockService.js`, which calls `GET /stock/overview`. The endpoint's rules are in [products.md](../backend/products.md#inventory-overview).

**Navigation.** Admins and managers reach it from the sidebar's Inventory group, as "Inventory overview", above "Product units" (`/inventory/units`, and `/inventory/units/:id` for one unit). A cashier sees no Inventory group, and `RoleProtectedRoute` sends them to the dashboard if they open the URL. A product's name opens its details page, `/products/:id`. The page is read-only and shows the selling price only, never a buying or cost price.

**The URL holds the state:** `search`, `stockStatus`, `branchId`, `includeInactive` and `page`.

- Reloading or sharing a URL restores the view. A value that isn't valid reads as the default.
- Defaults stay out of the URL, and Clear filters removes all of them. A filter change goes back to the first page.
- A page past the end moves to the last page.
- `getStockOverview` leaves out empty values, since the backend refuses an empty `branchId` or `stockStatus`. It keeps `false`, so `includeInactive=false` is sent even though the URL doesn't hold it.

**Filters.** The search runs 300 ms after typing stops, or at once on Enter, and needs 2 characters. Include inactive products adds deactivated products, tagged Inactive.

**Branches.** An admin sees All branches, or picks one from a list that includes inactive branches, marked "(inactive)". That list comes from `listBranches({ includeInactive: true })`, because the app's shared list holds active branches only. A `branchId` in the URL waits for this list before the overview is requested: if it isn't on the list it leaves the URL and is never sent, and All branches loads. If the list fails the branch can't be checked, so it is sent and the backend judges it. A manager has no picker, sends no `branchId`, and any `branchId` in the URL is ignored.

**Figures.** The heading's count is `meta.total`, and the cards are the backend's `summary`, so they cover every page and the cards don't change with the status filter. Nothing is counted from the rows on screen. Before the first answer the heading has no count and the cards show a dash; after a failed load they go blank again, since the last figures would describe other filters.

**Rows.** A `NOT_TRACKED` product shows a dash for its quantity, and a `QUANTITY` product a dash for its identified units: neither is a zero. For admins, the Branches button opens each branch's stock, and `N low or out` beside it flags a shortage the combined status can hide.

## Barcode Labels page

`/barcode-labels` (`frontend/src/pages/BarcodeLabels`) uses `barcodeLabelsService.js`: `searchProductLabels` (`GET /barcode-labels/products`), `searchUnitLabels` (`GET /barcode-labels/units`) and `resolveLabelQueue` (`POST /barcode-labels/resolve`). The endpoints' rules are in [barcode-labels.md](../backend/barcode-labels.md).

**Access.** Admins and managers only: the sidebar entry and `RoleProtectedRoute` hide it from cashiers, and the server refuses them anyway. An admin picks any branch, or All branches, for individual items. A manager sees their own branch as a fixed field, and the server holds them to it whatever is sent.

**Layout.** Four numbered steps: **1 Add labels** and **2 Print queue** side by side (stacked on narrow screens), then **3 Design labels** and **4 Preview and print** across the full width. No panel scrolls on its own; the page scrolls.

**Searching.** Two tabs, Products (quantity-tracked products) and Individual items (in-stock IMEI and serial-number units), each a server-side search. Each tab shows how many of its entries are queued. The search runs 300 ms after typing stops and needs 2 characters, and the box has a clear button. Results come 10 to a page, with a result count and Previous and Next. A queued row's Add button turns into a disabled "Added".

**The queue** keeps entries in the order they were added, each tagged Product or Unit. A product is queued once, and its copies (1–500) are set with − and + or typed. Each unit is one entry and one label, and different units of the same product are separate entries. The total is shown against the 500-label limit, and Preview is disabled above it. Under the queue, a notice says whether the preview is up to date or must be redone.

**Preview, then print.** Preview labels sends the whole queue to `resolveLabelQueue` and scrolls to the preview. Only the rows it returns are drawn, and Print Labels prints only a preview that matches the current queue: any change to the queue asks for a new preview. If the server refuses the queue, its message is shown and each refused item's reason appears on that item. Nothing is drawn or printed until every item is valid.

**The screen preview** lists the labels one below another at 100%, 150% or 200% (default), each beside its label number, kind, barcode value, IMEI or serial number and selling price. A product with several copies is shown once, as "Labels 3–5 of 9 · × 3 copies". The zoom is a CSS transform of a copy of the label: it never changes the printed size. A label whose lines are cut off at the chosen size is marked "Doesn't fit", with a notice above the list.

**Printing.** The printed sheet is separate from the screen preview: every copy, at its exact size (50 × 25, 40 × 20 or 30 × 20 mm), rendered through a portal into `#barcode-label-print-root`, a `<body>` child that exists only while the page is open. `index.css` hides every other `<body>` child when printing (so a receipt prints alone), and exempts this one.

**Labels.** Every label shows SOCIO.LK, and optionally the name, the code text and the selling price. A product label encodes the product's `barcode`, as before. A unit label encodes its `unit_code` and prints the IMEI or serial number as text only. There is no cost-price option, and the label is drawn from the server's label fields only, which carry no cost.

**Design labels** (`LabelDesigner.jsx`; layouts in `labelDesign.js`). A visual editor showing one label at 10 px per mm, with sample text:

- **Templates.** There are two: Product label and Unit label. A product label has no IMEI line. Each label size has its own layouts, because a 50 × 25 layout doesn't fit 30 × 20.
- **Selecting.** Click an item on the label (SOCIO.LK brand, name, barcode, code text, IMEI or serial, selling price), or pick it from the Item chips. The chips also reach an item covered by another. The selected item is drawn in front.
- **Moving.** Drag an item, use the arrow keys (0.5 mm, or 2 mm with Shift), or type its X and Y in mm. A move snaps to 0.5 mm and keeps the item's unrotated box on the label.
- **Toolbar.** Every item has width and rotation (a quarter turn at a time, about its centre). Text items also have font size (4–16 pt), bold, italic and alignment; the barcode has a height (5–20 mm). Name, code text and price can be shown or hidden. The brand, barcode and IMEI or serial line always print.
- **Saving.** Layouts are saved in `localStorage` per size and kind. Positions are kept as saved, and unreadable values fall back to the default. Reset layout restores the default for the current size and template. The default layout stacks the items as the labels always looked.
- **Same drawing everywhere.** The designer, the preview and the printed sheet draw items with the same placement (`itemPlacement`, in mm from the label's top-left), so the layout prints as designed.
- **Barcode.** It stretches to its box (`preserveAspectRatio="none"`). Every bar scales by the same factor, so the code reads the same.

**Fit warning** (`labelProblems` in `labelRender.js`). An item is flagged when it goes past the label's edge, overlaps another item (both are flagged), or is shortened with "…" (an IMEI, code or price losing characters). A long name is shortened by design and isn't counted. Boxes are measured as drawn, so turns count. The designer outlines such items in red and lists them; the preview marks the label "Doesn't fit".

**Page layout.** The page's root is `position: relative`. Tailwind's `sr-only` is `position: absolute`, and the app layout has no positioned ancestor, so without it a hidden caption is placed against the document. One such caption in the preview made the whole window scroll after Preview, showing a black band under the app.

## Environment variables

- **`VITE_API_BASE_URL`** — backend base URL (dev: `http://localhost:3000/api/v1`; prod: your deployed backend URL)
- Vite requires the `VITE_` prefix for client-exposed env vars. Vars without it are compiler-only.
- `.env` is gitignored. `.env.example` documents required vars for teammates/new setups.

## Deployment notes

- **Cookies + cross-origin.** In production (frontend on CloudFront, backend on ALB), cookies must have the correct `Domain`, `Secure=true`, and `SameSite` values. Backend already reads these from env (`COOKIE_DOMAIN`, `COOKIE_SECURE`), so no code change needed — just correct env values at deploy time.
- **CORS.** Backend CORS currently allows only `http://localhost:5173`. Production origin must be added.
- **Refresh path scoping.** The refresh cookie's `Path=/api/v1/auth/refresh` scoping is enforced at the backend. As long as the API stays at `/api/v1`, this works unchanged.