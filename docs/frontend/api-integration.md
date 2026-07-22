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

## Environment variables

- **`VITE_API_BASE_URL`** — backend base URL (dev: `http://localhost:3000/api/v1`; prod: your deployed backend URL)
- Vite requires the `VITE_` prefix for client-exposed env vars. Vars without it are compiler-only.
- `.env` is gitignored. `.env.example` documents required vars for teammates/new setups.

## Deployment notes

- **Cookies + cross-origin.** In production (frontend on CloudFront, backend on ALB), cookies must have the correct `Domain`, `Secure=true`, and `SameSite` values. Backend already reads these from env (`COOKIE_DOMAIN`, `COOKIE_SECURE`), so no code change needed — just correct env values at deploy time.
- **CORS.** Backend CORS currently allows only `http://localhost:5173`. Production origin must be added.
- **Refresh path scoping.** The refresh cookie's `Path=/api/v1/auth/refresh` scoping is enforced at the backend. As long as the API stays at `/api/v1`, this works unchanged.