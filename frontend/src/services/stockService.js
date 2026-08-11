import api from "./api";

/**
 * Stock Service
 *
 * Wraps the /stock endpoints. Stock rows are auto-created at quantity=0 when
 * a product is created, so `createStock` is only used for the rare case of
 * manually seeding a product+branch row that somehow doesn't exist.
 *
 * Adjustment note: PATCH /stock/:id sets an ABSOLUTE quantity, not a delta.
 * If a receiving flow needs "+5 units", the caller must fetch current quantity,
 * add 5, and PATCH the total.
 */

/**
 * List stock rows with optional filters.
 *
 * @param {Object} [filters]
 * @param {string}  [filters.productId]    - Filter to one product's stock across branches
 * @param {string}  [filters.branchId]     - Filter to one branch's stock across products
 * @param {boolean} [filters.lowStockOnly] - Only rows where low_stock_alert=true
 *                                            AND stock tracking is enabled
 * @returns {Promise<Array>} Stock rows with nested product/branch
 */
export const listStock = async (filters = {}) => {
  const params = Object.fromEntries(
    Object.entries(filters).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    ),
  );

  const response = await api.get("/stock", {
    params: Object.keys(params).length ? params : undefined,
  });
  return response.data;
};

/**
 * Get a single stock row by ID.
 *
 * @param {string} id - Stock UUID
 * @returns {Promise<Object>} Stock row with nested product/branch
 */
export const getStock = async (id) => {
  const response = await api.get(`/stock/${id}`);
  return response.data;
};

/**
 * Get all stock rows for one product (one row per branch).
 *
 * Used by the product detail view to show stock levels across every branch.
 *
 * @param {string} productId - Product UUID
 * @returns {Promise<Array>} Stock rows for the product
 */
export const getStockByProduct = async (productId) => {
  const response = await api.get(`/stock/by-product/${productId}`);
  return response.data;
};

/**
 * Manually create a stock row (admin only).
 *
 * Rare — stock rows are auto-created with the product. Use only if a row is
 * genuinely missing (data-migration cleanup, etc). Returns 409 if a row for
 * this product+branch already exists.
 *
 * @param {Object} payload - CreateStockDto shape
 * @returns {Promise<Object>} Newly created stock row
 */
export const createStock = async (payload) => {
  const response = await api.post("/stock", payload);
  return response.data;
};

/**
 * Adjust a stock row (admin only).
 *
 * IMPORTANT: `quantity` is absolute, not a delta. To add stock, the caller
 * must fetch current quantity, add the delta, and PATCH the total.
 *
 * @param {string} id      - Stock UUID
 * @param {Object} payload - UpdateStockDto (quantity, min_quantity, manage_stock)
 * @returns {Promise<Object>} Updated stock row
 */
export const updateStock = async (id, payload) => {
  const response = await api.patch(`/stock/${id}`, payload);
  return response.data;
};
