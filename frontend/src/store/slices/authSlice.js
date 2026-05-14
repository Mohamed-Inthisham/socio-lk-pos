import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { loginAPI, logoutAPI } from "../../services/authService";

/**
 * Authentication Slice
 *
 * Manages all authentication-related state for the application:
 * - Current user information
 * - JWT token
 * - Authentication status
 * - Loading and error states
 *
 * Used by: LoginForm, ProtectedRoute, Navbar, Dashboard
 */

// ============================================
// ASYNC THUNKS
// ============================================

/**
 * Login Async Thunk
 *
 * Handles the asynchronous login process:
 * 1. Calls the authentication API
 * 2. Auto-dispatches: pending → fulfilled (success) | rejected (failure)
 * 3. Returns user and token data on success
 *
 * @param {Object} credentials - { email, password }
 */
export const loginUser = createAsyncThunk(
  "auth/loginUser",
  async (credentials, { rejectWithValue }) => {
    try {
      const response = await loginAPI(credentials);
      return response; // { user, token }
    } catch (error) {
      // Pass error message to rejected case
      return rejectWithValue(error.message);
    }
  },
);

/**
 * Logout Async Thunk
 *
 * Handles the asynchronous logout process:
 * 1. Calls the logout API (invalidates token on backend)
 * 2. Clears localStorage
 * 3. Resets Redux state
 */
export const logoutUser = createAsyncThunk(
  "auth/logoutUser",
  async (_, { rejectWithValue }) => {
    try {
      await logoutAPI();
      return true;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

// ============================================
// INITIAL STATE
// ============================================

const initialState = {
  user: null, // User object: { id, name, email, role }
  token: null, // JWT token string
  isAuthenticated: false, // Login status flag
  loading: false, // True during login/logout API calls
  error: null, // Error message if login fails
};

// ============================================
// SLICE DEFINITION
// ============================================

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    /**
     * Clears error messages
     * Useful when user dismisses an error or starts a new action
     */
    clearError: (state) => {
      state.error = null;
    },

    /**
     * Manually set credentials (used for localStorage restoration)
     */
    setCredentials: (state, action) => {
      const { user, token } = action.payload;
      state.user = user;
      state.token = token;
      state.isAuthenticated = true;
    },
  },

  // ============================================
  // EXTRA REDUCERS (handle async thunk states)
  // ============================================
  extraReducers: (builder) => {
    builder
      // LOGIN: Pending
      .addCase(loginUser.pending, (state) => {
        state.loading = true;
        state.error = null;
      })

      // LOGIN: Success
      .addCase(loginUser.fulfilled, (state, action) => {
        const { user, token } = action.payload;
        state.user = user;
        state.token = token;
        state.isAuthenticated = true;
        state.loading = false;
        state.error = null;
      })

      // LOGIN: Failure
      .addCase(loginUser.rejected, (state, action) => {
        state.user = null;
        state.token = null;
        state.isAuthenticated = false;
        state.loading = false;
        state.error = action.payload || "Login failed";
      })

      // LOGOUT: Pending
      .addCase(logoutUser.pending, (state) => {
        state.loading = true;
      })

      // LOGOUT: Success
      .addCase(logoutUser.fulfilled, (state) => {
        state.user = null;
        state.token = null;
        state.isAuthenticated = false;
        state.loading = false;
        state.error = null;
      })

      // LOGOUT: Failure (still log out locally even if API fails)
      .addCase(logoutUser.rejected, (state) => {
        state.user = null;
        state.token = null;
        state.isAuthenticated = false;
        state.loading = false;
      });
  },
});

// ============================================
// EXPORTS
// ============================================

// Export sync action creators
export const { clearError, setCredentials } = authSlice.actions;

// Export the reducer
export default authSlice.reducer;
