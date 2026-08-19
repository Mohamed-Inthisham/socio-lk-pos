import {
  createSlice,
  createAsyncThunk,
  createSelector,
} from "@reduxjs/toolkit";
import api from "../../services/api";

/**
 * Categories Slice
 *
 * Owns the list of categories — flat list with parent_id for the two-level
 * hierarchy. Used by product list filter and product forms.
 *
 * The list endpoint returns categories flat (parent + children mixed).
 * Consumers that need only top-level categories use selectTopLevelCategories.
 */

export const fetchCategories = createAsyncThunk(
  "categories/fetchCategories",
  async ({ includeInactive = false } = {}, { rejectWithValue }) => {
    try {
      const response = await api.get("/categories", {
        params: includeInactive ? { includeInactive: true } : undefined,
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message ||
          error.message ||
          "Failed to load categories",
      );
    }
  },
);

const initialState = {
  categories: [],
  loading: false,
  error: null,
  initialized: false,
};

const categoriesSlice = createSlice({
  name: "categories",
  initialState,
  reducers: {
    clearCategories: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCategories.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCategories.fulfilled, (state, action) => {
        state.categories = action.payload;
        state.loading = false;
        state.initialized = true;
      })
      .addCase(fetchCategories.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Failed to load categories";
        state.initialized = true;
      });
  },
});

export const { clearCategories } = categoriesSlice.actions;

// Selectors
export const selectAllCategories = (state) => state.categories.categories;
export const selectCategoriesLoading = (state) => state.categories.loading;
export const selectCategoriesInitialized = (state) =>
  state.categories.initialized;
export const selectActiveCategories = createSelector(
  [selectAllCategories],
  (categories) => categories.filter((c) => c.is_active),
);
export const selectTopLevelCategories = createSelector(
  [selectAllCategories],
  (categories) => categories.filter((c) => c.is_active && !c.parent_id),
);

export default categoriesSlice.reducer;
