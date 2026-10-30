import api, { withAuthLock } from "./api";

/**
 * Authentication Service
 *
 * Real API calls to the SOCIO.LK POS NestJS backend.
 * Uses httpOnly cookies for auth — no token stored in JS.
 */

// ============================================
// SHAPE MAPPING
// ============================================

/**
 * Backend returns user with `full_name`.
 * Frontend components use `name`.
 * We map at the boundary so the rest of the app is untouched.
 *
 * branch_id / branch: UUID + nested branch for staff, null for admins.
 * Normalised to null (never undefined) so callers can rely on the shape.
 *
 * has_approval_pin / approval_pin_set_at: the manager approval PIN
 * (P6-18), read from the database on every /auth/me and login. false /
 * null when missing (cashiers, or an older server).
 */
const mapBackendUser = (backendUser) => ({
  id: backendUser.id,
  email: backendUser.email,
  name: backendUser.full_name,
  role: backendUser.role,
  branch_id: backendUser.branch_id ?? null,
  branch: backendUser.branch ?? null,
  has_approval_pin: backendUser.has_approval_pin ?? false,
  approval_pin_set_at: backendUser.approval_pin_set_at ?? null,
  avatar: null,
});

/**
 * Turns axios errors into simple message strings.
 * Prefers backend-provided messages over generic ones.
 */
const extractErrorMessage = (error, fallback) => {
  const backendMessage = error?.response?.data?.message;
  if (Array.isArray(backendMessage)) return backendMessage[0];
  if (typeof backendMessage === "string") return backendMessage;
  return fallback;
};

// ============================================
// AUTH API METHODS
// ============================================

export const LOGIN_RATE_LIMITED_MESSAGE =
  "Too many login attempts. Please wait a few minutes and try again.";

/**
 * Login with email and password.
 * Backend sets access_token + refresh_token httpOnly cookies.
 * Returns { user } — no token in response body.
 */
export const loginAPI = async ({ email, password }) => {
  try {
    const response = await api.post("/auth/login", { email, password });
    return {
      user: mapBackendUser(response.data.user),
    };
  } catch (error) {
    // 429: the backend's login limit per IP (LOGIN_THROTTLE_*). Fixed
    // wording here so the form never shows a raw throttler message.
    const message =
      error?.response?.status === 429
        ? LOGIN_RATE_LIMITED_MESSAGE
        : extractErrorMessage(error, "Invalid email or password");
    throw new Error(message, { cause: error });
  }
};

/**
 * Logout — revokes the refresh token server-side and clears cookies.
 * Takes the auth lock, so it waits for any refresh in flight (any tab)
 * and sends the newest refresh cookie; no refresh can land after it.
 */
export const logoutAPI = async () => {
  try {
    await withAuthLock(() => api.post("/auth/refresh/logout"));
    return { success: true };
  } catch (error) {
    // Even if server call fails, treat logout as successful locally
    console.error("Logout API error:", error);
    return { success: true };
  }
};

/**
 * Get the currently authenticated user.
 * Used on app load to restore session — replaces the old localStorage check.
 * 401 here means no valid session; caller should treat as logged out.
 */
export const getCurrentUser = async () => {
  const response = await api.get("/auth/me");
  return {
    user: mapBackendUser(response.data.user),
  };
};

/**
 * Change the session user's own password (any role). 204: the server
 * revoked every refresh token of the user and set new session cookies
 * for this device, so the user stays signed in.
 *
 * Errors are left to the caller, which reads only status, code and
 * message (the axios error also carries the request body, the passwords):
 * - 403 WRONG_PASSWORD: the current password is wrong
 * - 400 SAME_PASSWORD, or a validation message
 * - 503 PASSWORD_CHANGED_SIGN_IN_AGAIN: the password WAS changed, but no
 *   new session could be started; the user must sign in again. Never
 *   retried: the old password no longer works.
 *
 * @param {{ current_password: string, new_password: string }} payload
 */
export const changeOwnPassword = async ({ current_password, new_password }) => {
  await api.put("/auth/me/password", { current_password, new_password });
};
