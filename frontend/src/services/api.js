import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// ============================================
// 401 REFRESH INTERCEPTOR
// ============================================

// Tracks an in-flight refresh so parallel 401s all await the same call
let refreshPromise = null;

// ============================================
// AUTH LOCK (refresh + logout, across tabs)
// ============================================

// Every tab shares one refresh cookie, and the server treats a second use
// of a rotated token as theft (all sessions revoked). So refresh and logout
// run one at a time across tabs: a tab only sends once the previous
// holder's response has updated the cookie jar, so it never sends a stale
// token, and logout can't be overtaken by a refresh that restores cookies.
const AUTH_LOCK = "socio-lk-pos-auth";

// A stalled refresh must not hold the lock (and so block logout) forever.
const REFRESH_TIMEOUT_MS = 30_000;

// Fallback without Web Locks (insecure origins, old browsers): one queue
// per tab. Tabs aren't coordinated then; the server's strict reuse
// detection is the backstop.
let localQueue = Promise.resolve();

export const withAuthLock = (task) => {
  if (globalThis.navigator?.locks?.request) {
    return navigator.locks.request(AUTH_LOCK, task);
  }
  const run = localQueue.then(task);
  localQueue = run.catch(() => {});
  return run;
};

// Callback wired up from outside (see main.jsx) — called when refresh fails.
// Kept as a variable to avoid api.js importing the Redux store (circular dep).
let onAuthFailure = () => {};

export const setAuthFailureHandler = (handler) => {
  onAuthFailure = handler;
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;
    const url = originalRequest?.url ?? "";

    const isAuthEndpoint =
      url.includes("/auth/login") ||
      url.includes("/auth/refresh") ||
      url.includes("/auth/logout");

    // Only try to refresh on 401s from non-auth endpoints, once per request
    if (status !== 401 || isAuthEndpoint || originalRequest._retry) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      // Coalesce concurrent 401s onto a single refresh
      if (!refreshPromise) {
        refreshPromise = withAuthLock(() =>
          api.post("/auth/refresh", null, { timeout: REFRESH_TIMEOUT_MS }),
        ).finally(() => {
          refreshPromise = null;
        });
      }
      await refreshPromise;

      // Refresh succeeded — retry the original request
      return api(originalRequest);
    } catch (refreshError) {
      // Refresh failed — session unrecoverable
      onAuthFailure();
      return Promise.reject(refreshError);
    }
  },
);

export default api;
