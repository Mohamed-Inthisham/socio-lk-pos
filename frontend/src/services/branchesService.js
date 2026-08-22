import api from "./api";

/**
 * Branches Service
 *
 * Wraps the /branches endpoints. Follows the same pattern as authService:
 * returns response.data on success, lets axios errors bubble to the caller.
 */

/**
 * List all branches.
 *
 * @param {Object} [options]
 * @param {boolean} [options.includeInactive=false] - Admin UI toggle to also
 *   surface deactivated branches. Staff should never need this.
 * @returns {Promise<Array>} Branch objects
 */
export const listBranches = async ({ includeInactive = false } = {}) => {
  const response = await api.get("/branches", {
    params: includeInactive ? { includeInactive: true } : undefined,
  });
  return response.data;
};

/**
 * Get a single branch by ID.
 *
 * NOTE: Backend scopes this endpoint — staff can only read their own branch,
 * admin can read any. A 403 here means the current user tried to access a
 * branch outside their scope; the caller should treat it like a 404 UX-wise.
 *
 * @param {string} id - Branch UUID
 * @returns {Promise<Object>} Branch object
 */
export const getBranch = async (id) => {
  const response = await api.get(`/branches/${id}`);
  return response.data;
};
