import api from "./api";

/**
 * Sales Service
 *
 * Wraps the /sales endpoints used by the POS terminal. Contract:
 * docs/backend/sales.md.
 *
 * RESPONSE SHAPES:
 * - Line POST/PATCH return the full hydrated sale (branch, cashier,
 *   customer, lines, payments, totals).
 * - POST /sales returns the bare new row (no lines/payments yet).
 * - Line DELETE and DELETE /sales/:id return 204 — callers re-fetch with
 *   getSale when they need the updated sale.
 *
 * Money fields come back as numeric strings ("60000.00"); request bodies
 * take numbers.
 */

/**
 * Create a DRAFT sale on a branch.
 *
 * @param {Object} payload
 * @param {string} payload.branch_id - Branch UUID
 * @returns {Promise<Object>} The bare new sale row
 */
export const createSale = async (payload) => {
  const response = await api.post("/sales", payload);
  return response.data;
};

/**
 * Get one sale, hydrated with lines, payments and customer.
 *
 * @param {string} id - Sale UUID
 * @returns {Promise<Object>} Hydrated sale
 */
export const getSale = async (id) => {
  const response = await api.get(`/sales/${id}`);
  return response.data;
};

/**
 * Update a DRAFT sale's customer and/or notes.
 *
 * `customer_id: null` detaches the customer (walk-in sale).
 *
 * @param {string} id - Sale UUID
 * @param {Object} payload - { customer_id?, notes? }
 * @returns {Promise<Object>} Hydrated sale (with the new customer)
 */
export const updateSale = async (id, payload) => {
  const response = await api.patch(`/sales/${id}`, payload);
  return response.data;
};

/**
 * Discard a DRAFT sale (hard delete of the sale, its lines and payments).
 *
 * @param {string} id - Sale UUID
 * @returns {Promise<void>} 204
 */
export const discardSale = async (id) => {
  await api.delete(`/sales/${id}`);
};

/**
 * Add a line to a DRAFT sale. Snapshot fields (name, SKU, prices) are
 * resolved server-side from the product.
 *
 * Serialized products require `imei_snapshot` and `quantity: 1`
 * (400 otherwise; 409 if the unit isn't IN_STOCK).
 *
 * @param {string} saleId
 * @param {Object} payload - { product_id, quantity, imei_snapshot? }
 * @returns {Promise<Object>} Hydrated sale
 */
export const addSaleLine = async (saleId, payload) => {
  const response = await api.post(`/sales/${saleId}/lines`, payload);
  return response.data;
};

/**
 * Update a line on a DRAFT sale (quantity, discount, IMEI).
 *
 * @param {string} saleId
 * @param {string} lineId
 * @param {Object} payload - UpdateSaleLineDto shape (partial)
 * @returns {Promise<Object>} Hydrated sale
 */
export const updateSaleLine = async (saleId, lineId, payload) => {
  const response = await api.patch(`/sales/${saleId}/lines/${lineId}`, payload);
  return response.data;
};

/**
 * Remove a line from a DRAFT sale.
 *
 * @param {string} saleId
 * @param {string} lineId
 * @returns {Promise<void>} 204 — re-fetch with getSale
 */
export const removeSaleLine = async (saleId, lineId) => {
  await api.delete(`/sales/${saleId}/lines/${lineId}`);
};
