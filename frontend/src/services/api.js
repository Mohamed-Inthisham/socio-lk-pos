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
        refreshPromise = api.post("/auth/refresh").finally(() => {
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
