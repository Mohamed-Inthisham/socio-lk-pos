import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { loginAPI, logoutAPI, isTokenValid } from "../../services/authService";
import { storage } from "../../utils/storage";

/**
 * Authentication Slice
 *
 * Manages all authentication-related state for the application:
 * - Current user information
 * - JWT token
 * - Authentication status
 * - Loading and error states
 *
 * Features:
 * - localStorage persistence for session restoration
 * - Async login/logout with API simulation
 * - Token validation
 */

// ============================================
// ASYNC THUNKS
// ============================================

/**
 * Login Async Thunk
 * Authenticates user and persists session to localStorage
 */
export const loginUser = createAsyncThunk(
  "auth/loginUser",
  async (credentials, { rejectWithValue }) => {
    try {
      const response = await loginAPI(credentials);

      // Persist to localStorage on success
      storage.setAuth(response);

      return response; // { user, token }
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

/**
 * Logout Async Thunk
 * Clears Redux state and localStorage
 */
export const logoutUser = createAsyncThunk(
  "auth/logoutUser",
  async (_, { rejectWithValue }) => {
    try {
      await logoutAPI();

      // Clear localStorage
      storage.clearAuth();

      return true;
    } catch (error) {
      // Even if API fails, clear local data
      storage.clearAuth();
      return rejectWithValue(error.message);
    }
  },
);

/**
 * Restore Session Thunk
 * Checks localStorage on app load and restores auth state if valid token exists
 */
export const restoreSession = createAsyncThunk(
  "auth/restoreSession",
  async (_, { rejectWithValue }) => {
    try {
      const authData = storage.getAuth();

      // No saved session
      if (!authData) {
        return rejectWithValue("No saved session");
      }

      // Validate token (check expiration)
      if (!isTokenValid(authData.token)) {
        storage.clearAuth(); // Clear expired token
        return rejectWithValue("Session expired");
      }

      return authData; // { user, token }
    } catch (error) {
      console.error("Session restoration failed:", error);
      storage.clearAuth();
      return rejectWithValue("Failed to restore session");
    }
  },
);

// ============================================
// INITIAL STATE
// ============================================

const initialState = {
  user: null,
  token: null,
  isAuthenticated: false,
  loading: false,
  error: null,
  initialized: false, // Has app checked localStorage yet?
};

// ============================================
// SLICE DEFINITION
// ============================================

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },

  extraReducers: (builder) => {
    builder
      // LOGIN
      .addCase(loginUser.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        const { user, token } = action.payload;
        state.user = user;
        state.token = token;
        state.isAuthenticated = true;
        state.loading = false;
        state.error = null;
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.user = null;
        state.token = null;
        state.isAuthenticated = false;
        state.loading = false;
        state.error = action.payload || "Login failed";
      })

      // LOGOUT
      .addCase(logoutUser.pending, (state) => {
        state.loading = true;
      })
      .addCase(logoutUser.fulfilled, (state) => {
        state.user = null;
        state.token = null;
        state.isAuthenticated = false;
        state.loading = false;
        state.error = null;
      })
      .addCase(logoutUser.rejected, (state) => {
        state.user = null;
        state.token = null;
        state.isAuthenticated = false;
        state.loading = false;
      })

      // RESTORE SESSION
      .addCase(restoreSession.pending, (state) => {
        state.loading = true;
      })
      .addCase(restoreSession.fulfilled, (state, action) => {
        const { user, token } = action.payload;
        state.user = user;
        state.token = token;
        state.isAuthenticated = true;
        state.loading = false;
        state.initialized = true;
      })
      .addCase(restoreSession.rejected, (state) => {
        state.user = null;
        state.token = null;
        state.isAuthenticated = false;
        state.loading = false;
        state.initialized = true; // Initialized, just no session
      });
  },
});

export const { clearError } = authSlice.actions;
export default authSlice.reducer;
