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

## Environment variables

- **`VITE_API_BASE_URL`** — backend base URL (dev: `http://localhost:3000/api/v1`; prod: your deployed backend URL)
- Vite requires the `VITE_` prefix for client-exposed env vars. Vars without it are compiler-only.
- `.env` is gitignored. `.env.example` documents required vars for teammates/new setups.

## Deployment notes

- **Cookies + cross-origin.** In production (frontend on CloudFront, backend on ALB), cookies must have the correct `Domain`, `Secure=true`, and `SameSite` values. Backend already reads these from env (`COOKIE_DOMAIN`, `COOKIE_SECURE`), so no code change needed — just correct env values at deploy time.
- **CORS.** Backend CORS currently allows only `http://localhost:5173`. Production origin must be added.
- **Refresh path scoping.** The refresh cookie's `Path=/api/v1/auth/refresh` scoping is enforced at the backend. As long as the API stays at `/api/v1`, this works unchanged.