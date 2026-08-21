import api from "./api";

/**
 * Categories Service
 *
 * Wraps the /categories endpoints. Categories are two-level: top-level
 * (parent_id = null) and sub-categories (parent_id = <top-level UUID>).
 * The backend enforces the two-level rule and returns 400 if a request
 * tries to nest deeper.
 *
 * Category names are case-insensitively unique WITHIN THE SAME PARENT —
 * "Cases" can exist under both "Phone Accessories" and "Watch Accessories".
 * Duplicate at the same level returns 409 Conflict.
 *
 * Mutation endpoints (create, update, deactivate, reactivate) will 403 for
 * non-admin roles. The frontend disables buttons via usePermissions, but
 * the backend is the source of truth.
 *
 * Pattern matches brandsService.js: return response.data, let axios errors
 * bubble. No error normalization.
 */

/**
 * List all categories (flat — top-level + sub-categories mixed).
 *
 * Consumers that need only top-level categories can filter client-side
 * (`c.parent_id === null`) or use listTopLevelCategories.
 *
 * @param {Object} [options]
 * @param {boolean} [options.includeInactive=false] - Include deactivated categories
 * @returns {Promise<Array>} Categories
 */
export const listCategories = async ({ includeInactive = false } = {}) => {
  const response = await api.get("/categories", {
    params: includeInactive ? { includeInactive: true } : undefined,
  });
  return response.data;
};

/**
 * List only top-level categories (parent_id = null).
 *
 * Convenience endpoint. In R1 we filter client-side from the flat list
 * to avoid a second fetch, but this stays available for future callers
 * that need a fresh top-level-only list (e.g. an admin picker used from
 * multiple places).
 *
 * @param {Object} [options]
 * @param {boolean} [options.includeInactive=false] - Include deactivated categories
 * @returns {Promise<Array>} Top-level categories
 */
export const listTopLevelCategories = async ({
  includeInactive = false,
} = {}) => {
  const response = await api.get("/categories/top-level", {
    params: includeInactive ? { includeInactive: true } : undefined,
  });
  return response.data;
};

/**
 * Get a single category by ID.
 *
 * @param {string} id - Category UUID
 * @returns {Promise<Object>} Category
 */
export const getCategory = async (id) => {
  const response = await api.get(`/categories/${id}`);
  return response.data;
};

/**
 * Create a new category (admin only).
 *
 * Backend rules enforced:
 * - Name is case-insensitively unique within the same parent → 409 Conflict.
 * - parent_id, if set, must reference a TOP-LEVEL category → 400 Bad Request.
 *   Nesting a category under an already-nested category is not allowed.
 * - parent_id null or omitted → creates a top-level category.
 *
 * @param {Object} payload - { name, parent_id?, sort_order?, is_active? }
 * @returns {Promise<Object>} Newly created category
 */
export const createCategory = async (payload) => {
  const response = await api.post("/categories", payload);
  return response.data;
};

/**
 * Update an existing category (admin only).
 *
 * PATCH — any subset of fields. Same uniqueness + two-level rules as create.
 * Reparenting a category (changing parent_id) is allowed, subject to those
 * rules.
 *
 * @param {string} id - Category UUID
 * @param {Object} payload - Partial { name, parent_id, sort_order, is_active }
 * @returns {Promise<Object>} Updated category
 */
export const updateCategory = async (id, payload) => {
  const response = await api.patch(`/categories/${id}`, payload);
  return response.data;
};

/**
 * Deactivate a category (soft delete, admin only).
 *
 * Sets is_active=false. Category is preserved so historical products stay
 * attributed. Sub-categories keep this as their parent — deactivation does
 * NOT cascade (locked decision from Phase 6.1).
 *
 * @param {string} id - Category UUID
 * @returns {Promise<Object>} Deactivated category
 */
export const deactivateCategory = async (id) => {
  const response = await api.delete(`/categories/${id}`);
  return response.data;
};

/**
 * Reactivate a previously deactivated category (admin only).
 *
 * @param {string} id - Category UUID
 * @returns {Promise<Object>} Reactivated category
 */
export const reactivateCategory = async (id) => {
  const response = await api.post(`/categories/${id}/reactivate`);
  return response.data;
};
