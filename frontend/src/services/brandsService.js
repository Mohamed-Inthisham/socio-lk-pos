import api from "./api";

/**
 * Brands Service
 *
 * Wraps the /brands endpoints. Brand names are case-insensitively unique
 * — creating "apple" when "Apple" exists returns 409 Conflict.
 *
 * Mutation endpoints (create, update, deactivate, reactivate) will 403 for
 * non-admin roles. The frontend disables buttons via usePermissions, but the
 * backend is the source of truth.
 *
 * Pattern matches productsService.js and branchesService.js: return
 * response.data, let axios errors bubble. No error normalization.
 */

/**
 * List brands.
 *
 * @param {Object} [options]
 * @param {boolean} [options.includeInactive=false] - Include deactivated brands
 * @returns {Promise<Array>} Brands
 */
export const listBrands = async ({ includeInactive = false } = {}) => {
  const response = await api.get("/brands", {
    params: includeInactive ? { includeInactive: true } : undefined,
  });
  return response.data;
};

/**
 * Get a single brand by ID.
 *
 * @param {string} id - Brand UUID
 * @returns {Promise<Object>} Brand
 */
export const getBrand = async (id) => {
  const response = await api.get(`/brands/${id}`);
  return response.data;
};

/**
 * Create a new brand (admin only).
 *
 * Brand names are case-insensitively unique — creating "apple" when
 * "Apple" exists returns 409 Conflict. Surface the 409 as an inline
 * error on the name field, not a generic banner.
 *
 * @param {Object} payload - { name, is_active? }
 * @returns {Promise<Object>} Newly created brand
 */
export const createBrand = async (payload) => {
  const response = await api.post("/brands", payload);
  return response.data;
};

/**
 * Update an existing brand (admin only).
 *
 * PATCH — any subset of fields. Renaming to an existing name
 * (case-insensitive) returns 409 Conflict.
 *
 * @param {string} id - Brand UUID
 * @param {Object} payload - Partial { name, is_active }
 * @returns {Promise<Object>} Updated brand
 */
export const updateBrand = async (id, payload) => {
  const response = await api.patch(`/brands/${id}`, payload);
  return response.data;
};

/**
 * Deactivate a brand (soft delete, admin only).
 *
 * Sets is_active=false. Brand is preserved so historical products stay
 * attributed. Products don't cascade — deactivating a brand doesn't
 * hide products that use it (locked decision from Phase 6.1).
 *
 * @param {string} id - Brand UUID
 * @returns {Promise<Object>} Deactivated brand
 */
export const deactivateBrand = async (id) => {
  const response = await api.delete(`/brands/${id}`);
  return response.data;
};

/**
 * Reactivate a previously deactivated brand (admin only).
 *
 * @param {string} id - Brand UUID
 * @returns {Promise<Object>} Reactivated brand
 */
export const reactivateBrand = async (id) => {
  const response = await api.post(`/brands/${id}/reactivate`);
  return response.data;
};
