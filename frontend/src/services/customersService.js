import api from "./api";

/**
 * Customers Service
 *
 * Wraps the /customers endpoints the POS terminal needs: search and inline
 * create. All roles (cashier included) may list and create customers;
 * delete/restore are admin + manager only and not wrapped here.
 *
 * Phone numbers accept 0771234567, +94771234567 or 94771234567 and come
 * back normalized to 0XXXXXXXXX. NIC is optional, stored upper-case, and
 * unique — a duplicate returns 409 with `existing_customer_id`.
 */

/**
 * List customers with optional filters (paginated).
 *
 * @param {Object} [filters]
 * @param {string} [filters.search] - Case-insensitive substring match
 *   across name, phone and NIC (max 100 chars)
 * @param {number} [filters.page]   - 1-based page (default 1)
 * @param {number} [filters.limit]  - Page size (default 50, max 200)
 * @returns {Promise<{data: Array, meta: Object}>} Customers plus
 *   { total, page, limit, totalPages, hasNext, hasPrev }
 */
export const listCustomers = async (filters = {}) => {
  const params = Object.fromEntries(
    Object.entries(filters).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    ),
  );

  const response = await api.get("/customers", {
    params: Object.keys(params).length ? params : undefined,
  });
  return response.data;
};

/**
 * Get one customer by ID (soft-deleted rows included — check deleted_at).
 *
 * @param {string} id - Customer UUID
 * @returns {Promise<Object>} Customer
 */
export const getCustomer = async (id) => {
  const response = await api.get(`/customers/${id}`);
  return response.data;
};

/**
 * Create a customer.
 *
 * @param {Object} payload
 * @param {string} payload.name         - 1–200 chars
 * @param {string} payload.phone        - Sri Lankan number (see above)
 * @param {string|null} [payload.nic]   - 5–20 chars, optional
 * @returns {Promise<Object>} The new customer
 * @throws 409 with `existing_customer_id` when the NIC is already on file
 */
export const createCustomer = async (payload) => {
  const response = await api.post("/customers", payload);
  return response.data;
};

/**
 * Update a customer (PATCH: only the fields sent change).
 *
 * @param {string} id - Customer UUID
 * @param {Object} payload - e.g. { nic } (5–20 chars, or null to clear)
 * @returns {Promise<Object>} The updated customer
 * @throws 409 with `existing_customer_id` when the NIC is already on file
 */
export const updateCustomer = async (id, payload) => {
  const response = await api.patch(`/customers/${id}`, payload);
  return response.data;
};
