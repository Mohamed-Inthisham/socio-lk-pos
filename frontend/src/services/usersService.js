import api from "./api";

/**
 * Users Service
 *
 * Wraps the admin-only /users endpoints (Tasks 2.1 – 2.3). Every route is
 * refused for managers and cashiers (403): the backend is the boundary,
 * the Users page only adds an admin-only route and menu item.
 *
 * Responses are safe users: never a password or PIN hash, the PIN's
 * wrong-attempt count or its lock. Errors carry `{ message, code? }`
 * (see utils/userErrors.js) and are left to the caller.
 *
 * BRANCH CHANGES go through changeUserRole only: it revokes the user's
 * refresh tokens and writes the ROLE_CHANGED audit row in one transaction.
 * updateUser never sends a branch (or a role).
 */

/** Drop undefined / null / "" so they never reach the query string. */
const definedOnly = (values) =>
  Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );

/**
 * List users, by name (paginated).
 *
 * @param {Object} [filters]
 * @param {string} [filters.search] - name or email, case-insensitive
 * @param {string} [filters.role] - admin | manager | cashier
 * @param {string} [filters.branchId]
 * @param {boolean} [filters.isActive] - omit for all
 * @param {number} [filters.page]
 * @param {number} [filters.limit] - default 50, max 200
 * @returns {Promise<{data: Array, meta: Object}>} users plus
 *   { total, page, limit, totalPages, hasNext, hasPrev }
 */
export const listUsers = async (filters = {}) => {
  const params = definedOnly(filters);
  const response = await api.get("/users", {
    params: Object.keys(params).length ? params : undefined,
  });
  return response.data;
};

/**
 * Create a user. An admin has no branch, so `branch_id` is sent only for
 * staff. 409 when the email is taken, or 409 NIC_ALREADY_REGISTERED when
 * the NIC is.
 *
 * Only the fields below are copied into the body: a field added to the
 * form has to be added here too, or it is silently dropped.
 *
 * @param {Object} payload
 * @param {string} payload.full_name
 * @param {string} payload.email
 * @param {string} payload.password - 8 characters to 72 UTF-8 bytes
 * @param {string} payload.role
 * @param {string} [payload.branch_id] - required for manager and cashier
 * @param {string} payload.phone - 0XXXXXXXXX
 * @param {string} payload.nic
 * @param {string} payload.address
 */
export const createUser = async ({ full_name, email, password, role, branch_id, phone, nic, address }) => {
  const body = { full_name, email, password, role, phone, nic, address };
  if (role !== "admin" && branch_id) body.branch_id = branch_id;
  const response = await api.post("/users", body);
  return response.data;
};

/**
 * Update a user's name, email and contact details. Only those fields are
 * ever sent, and never a null: role and branch change through
 * changeUserRole, and the server never clears contact details.
 *
 * @param {string} id
 * @param {{ full_name?: string, email?: string, phone?: string, nic?: string, address?: string }} payload
 */
export const updateUser = async (id, { full_name, email, phone, nic, address } = {}) => {
  const response = await api.patch(`/users/${id}`, definedOnly({ full_name, email, phone, nic, address }));
  return response.data;
};

/**
 * Set a user's role and branch in one request (also moves staff between
 * branches). An admin gets no branch; staff need an active one.
 *
 * 400 CANNOT_CHANGE_OWN_ROLE / LAST_ACTIVE_ADMIN, or a branch message.
 *
 * @param {string} id
 * @param {{ role: string, branch_id?: string }} payload
 */
export const changeUserRole = async (id, { role, branch_id }) => {
  const body = role === "admin" ? { role } : { role, branch_id };
  const response = await api.patch(`/users/${id}/role`, body);
  return response.data;
};

/** 400 CANNOT_DEACTIVATE_SELF / LAST_ACTIVE_ADMIN. */
export const deactivateUser = async (id) => {
  const response = await api.post(`/users/${id}/deactivate`);
  return response.data;
};

/** 400 when the user's branch is inactive. */
export const reactivateUser = async (id) => {
  const response = await api.post(`/users/${id}/reactivate`);
  return response.data;
};

/**
 * Set another user's password (204, no body). 400
 * CANNOT_RESET_OWN_PASSWORD for the caller's own account.
 *
 * @param {string} id
 * @param {{ new_password: string }} payload
 */
export const resetUserPassword = async (id, { new_password }) => {
  await api.post(`/users/${id}/password`, { new_password });
};
