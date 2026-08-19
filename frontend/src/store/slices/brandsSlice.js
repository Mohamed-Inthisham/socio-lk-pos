import {
  createSlice,
  createAsyncThunk,
  createSelector,
} from "@reduxjs/toolkit";
import api from "../../services/api";

/**
 * Brands Slice
 *
 * Owns the list of brands — read-mostly reference data used by the product
 * list filter, product forms, and (later) the barcode-print flow.
 *
 * Matches branchesSlice: Redux for domain data, one fetch action, selectors
 * for the common lookups.
 */

export const fetchBrands = createAsyncThunk(
  "brands/fetchBrands",
  async ({ includeInactive = false } = {}, { rejectWithValue }) => {
    try {
      const response = await api.get("/brands", {
        params: includeInactive ? { includeInactive: true } : undefined,
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message ||
          error.message ||
          "Failed to load brands",
      );
    }
  },
);

const initialState = {
  brands: [],
  loading: false,
  error: null,
  initialized: false,
};

const brandsSlice = createSlice({
  name: "brands",
  initialState,
  reducers: {
    clearBrands: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchBrands.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBrands.fulfilled, (state, action) => {
        state.brands = action.payload;
        state.loading = false;
        state.initialized = true;
      })
      .addCase(fetchBrands.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Failed to load brands";
        state.initialized = true;
      });
  },
});

export const { clearBrands } = brandsSlice.actions;

// Selectors
export const selectAllBrands = (state) => state.brands.brands;
export const selectBrandsLoading = (state) => state.brands.loading;
export const selectBrandsInitialized = (state) => state.brands.initialized;
export const selectActiveBrands = createSelector([selectAllBrands], (brands) =>
  brands.filter((b) => b.is_active),
);

export default brandsSlice.reducer;
