import api from "./api";

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
 */
const mapBackendUser = (backendUser) => ({
  id: backendUser.id,
  email: backendUser.email,
  name: backendUser.full_name,
  role: backendUser.role,
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
    throw new Error(extractErrorMessage(error, "Invalid email or password"), {
      cause: error,
    });
  }
};

/**
 * Logout — revokes the refresh token server-side and clears cookies.
 */
export const logoutAPI = async () => {
  try {
    await api.post("/auth/logout");
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
