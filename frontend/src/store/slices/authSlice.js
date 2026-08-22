import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import {
  loginAPI,
  logoutAPI,
  getCurrentUser,
} from "../../services/authService";
import { clearBranches } from "./branchesSlice";
import { clearBrands } from "./brandsSlice";
import { clearCategories } from "./categoriesSlice";
import useActiveBranchStore from "../zustand/activeBranchStore";
/**
 * Authentication Slice
 *
 * Manages auth state. Cookies live in the browser (httpOnly); the frontend
 * only tracks `user` + `isAuthenticated`. Session restoration happens via
 * GET /auth/me on app load — no localStorage involved.
 */

// ============================================
// ASYNC THUNKS
// ============================================

export const loginUser = createAsyncThunk(
  "auth/loginUser",
  async (credentials, { rejectWithValue }) => {
    try {
      const response = await loginAPI(credentials);
      return response; // { user }
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

export const logoutUser = createAsyncThunk(
  "auth/logoutUser",
  async (_, { dispatch, rejectWithValue }) => {
    // Clear all per-session data — reference caches (Redux) and the
    // picked-branch UI preference (Zustand). Prevents leaking one user's
    // state into the next login session on shared POS terminals.
    const clearSessionData = () => {
      dispatch(clearBranches());
      dispatch(clearBrands());
      dispatch(clearCategories());
      useActiveBranchStore.getState().clear();
    };

    try {
      await logoutAPI();
      clearSessionData();
      return true;
    } catch (error) {
      // Clear locally even if the API call fails — the user's intent was
      // "log out," and the backend will 401 the cookie on next request.
      clearSessionData();
      return rejectWithValue(error.message);
    }
  },
);

/**
 * Restore Session
 * Called on app load. Asks the backend "am I logged in?" via /auth/me.
 * If cookies are valid → returns user. If not → 401, treated as logged out.
 */
export const restoreSession = createAsyncThunk(
  "auth/restoreSession",
  async (_, { rejectWithValue }) => {
    try {
      const response = await getCurrentUser();
      return response; // { user }
    } catch {
      // 401 is expected when not logged in — silent failure
      return rejectWithValue("No active session");
    }
  },
);

// ============================================
// INITIAL STATE
// ============================================

const initialState = {
  user: null,
  isAuthenticated: false,
  loading: false,
  error: null,
  initialized: false,
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
        state.user = action.payload.user;
        state.isAuthenticated = true;
        state.loading = false;
        state.error = null;
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.user = null;
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
        state.isAuthenticated = false;
        state.loading = false;
        state.error = null;
      })
      .addCase(logoutUser.rejected, (state) => {
        state.user = null;
        state.isAuthenticated = false;
        state.loading = false;
      })

      // RESTORE SESSION
      .addCase(restoreSession.pending, (state) => {
        state.loading = true;
      })
      .addCase(restoreSession.fulfilled, (state, action) => {
        state.user = action.payload.user;
        state.isAuthenticated = true;
        state.loading = false;
        state.initialized = true;
      })
      .addCase(restoreSession.rejected, (state) => {
        state.user = null;
        state.isAuthenticated = false;
        state.loading = false;
        state.initialized = true;
      });
  },
});

export const { clearError } = authSlice.actions;
export default authSlice.reducer;
