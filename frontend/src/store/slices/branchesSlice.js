import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { listBranches } from "../../services/branchesService";

/**
 * Branches Slice
 *
 * Owns the list of branches — read-mostly reference data used by the nav
 * branch selector, product list filter, product forms, and stock UI.
 *
 * WHY REDUX (not Zustand):
 * - Domain data, not UI ephemera. Same category as authSlice.
 * - Refresh actions (after admin creates/updates a branch) are worth having
 *   in Redux DevTools when debugging cache-staleness bugs.
 * - Matches the existing slice pattern — consistency > invention.
 *
 * NOTE ON CACHING:
 * We fetch once and reuse. Components read `branches` directly from state.
 * When admin mutates a branch, they dispatch `fetchBranches()` again to
 * refresh. There is no automatic invalidation — that would be RTK Query
 * territory, not needed for R1.
 */

// ============================================
// ASYNC THUNKS
// ============================================

/**
 * Fetch the branches list from the backend.
 *
 * @param {Object} [options]
 * @param {boolean} [options.includeInactive=false]
 */
export const fetchBranches = createAsyncThunk(
  "branches/fetchBranches",
  async ({ includeInactive = false } = {}, { rejectWithValue }) => {
    try {
      const branches = await listBranches({ includeInactive });
      return branches;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message ||
          error.message ||
          "Failed to load branches",
      );
    }
  },
);

// ============================================
// INITIAL STATE
// ============================================

const initialState = {
  branches: [],
  loading: false,
  error: null,
  initialized: false, // True once the first fetch (success or fail) completes
};

// ============================================
// SLICE
// ============================================

const branchesSlice = createSlice({
  name: "branches",
  initialState,
  reducers: {
    /**
     * Reset the slice — used on logout to avoid leaking one user's branch
     * list to the next login session.
     */
    clearBranches: () => initialState,
  },

  extraReducers: (builder) => {
    builder
      .addCase(fetchBranches.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBranches.fulfilled, (state, action) => {
        state.branches = action.payload;
        state.loading = false;
        state.initialized = true;
      })
      .addCase(fetchBranches.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Failed to load branches";
        state.initialized = true;
      });
  },
});

export const { clearBranches } = branchesSlice.actions;

// ============================================
// SELECTORS
// ============================================

export const selectAllBranches = (state) => state.branches.branches;
export const selectBranchesLoading = (state) => state.branches.loading;
export const selectBranchesError = (state) => state.branches.error;
export const selectBranchesInitialized = (state) => state.branches.initialized;

/**
 * Only active branches — the common case for dropdown filters and selectors.
 */
export const selectActiveBranches = (state) =>
  state.branches.branches.filter((b) => b.is_active);

/**
 * Look up one branch by ID.
 */
export const selectBranchById = (id) => (state) =>
  state.branches.branches.find((b) => b.id === id) || null;

export default branchesSlice.reducer;
