import api from "./api";

/**
 * Sales Service
 *
 * Wraps the /sales endpoints used by the POS terminal. Contract:
 * docs/backend/sales.md.
 *
 * RESPONSE SHAPES:
 * - Line and payment POST/PATCH return the full hydrated sale (branch,
 *   cashier, customer, lines, payments, totals).
 * - POST /sales returns the bare new row (no lines/payments yet).
 * - Line DELETE, payment DELETE and DELETE /sales/:id return 204 —
 *   callers re-fetch with getSale when they need the updated sale.
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
 * List sales (recent sales, P6-2 – P6-5). Params go through axios
 * `params`, which URL-encodes them: the `+05:30` in completedFrom /
 * completedTo must reach the server as `%2B05:30` (a raw `+` arrives as a
 * space and the backend answers 400). Build the bounds with
 * utils/colomboDay.js.
 *
 * Empty values (undefined, null, "") are left out, so callers can pass
 * a filter object as is. A search ignores the day (P6-3): send `q`
 * without completedFrom / completedTo.
 *
 * @param {Object} params
 * @param {string} [params.branchId]
 * @param {string} [params.cashierId]
 * @param {string} [params.status] - DRAFT | COMPLETED | VOIDED
 * @param {string} [params.completedFrom] - "2026-10-21T00:00:00+05:30" (inclusive)
 * @param {string} [params.completedTo] - "2026-10-22T00:00:00+05:30" (exclusive)
 * @param {string} [params.sort] - "completed_at" (default: created_at)
 * @param {string} [params.q] - 2–100 characters
 * @param {number} [params.page]
 * @param {number} [params.limit] - ≤ 200 (server default 50)
 * @returns {Promise<{ data: Object[], meta: Object }>} Rows with branch,
 *   cashier and customer (null for a walk-in); meta { total, page, limit,
 *   totalPages, hasNext, hasPrev }
 */
export const listSales = async (params = {}) => {
  const query = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
  const response = await api.get("/sales", { params: query });
  return response.data;
};

export const getDailySalesSummary = async ({ branchId, date }) => {
  const response = await api.get("/sales/daily-summary", { params: { branchId, date } });
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

/**
 * Record a payment on a DRAFT sale.
 *
 * - CASH: `{ payment_method, amount, cash_received }` — cash_received ≥ amount
 *   (the excess is change).
 * - CARD / BANK_TRANSFER / KOKO / MINTPAY: `{ payment_method, amount,
 *   reference_number }` — reference required, cash_received forbidden.
 *
 * `amount` may not exceed the remaining balance (400), for every method.
 *
 * @param {string} saleId
 * @param {Object} payload - AddPaymentDto shape
 * @returns {Promise<Object>} Hydrated sale
 */
export const addSalePayment = async (saleId, payload) => {
  const response = await api.post(`/sales/${saleId}/payments`, payload);
  return response.data;
};

/** POST /sales/:id/complete gives up after this long (P5-7). */
export const COMPLETE_TIMEOUT_MS = 30000;

/**
 * Complete a fully paid DRAFT sale: stock, trade-ins and the sale number
 * in one server transaction (docs/backend/sales.md).
 *
 * At most once: a repeated call gets 400 "Cannot complete a COMPLETED
 * sale…". Never retry it blindly after a lost response — re-fetch the
 * sale and check its status (the posTerminal completeSale thunk does).
 * The only request with its own timeout (COMPLETE_TIMEOUT_MS); there is
 * no global one.
 *
 * @param {string} saleId
 * @returns {Promise<Object>} The hydrated COMPLETED sale (sale_number,
 *   completed_at, lines with warranty snapshots, payments)
 */
export const completeSale = async (saleId) => {
  const response = await api.post(`/sales/${saleId}/complete`, undefined, {
    timeout: COMPLETE_TIMEOUT_MS,
  });
  return response.data;
};

/** POST /sales/:id/void gives up after this long (P6-11). */
export const VOID_TIMEOUT_MS = 30000;

/**
 * Void a COMPLETED sale with a manager's or admin's approval PIN (P6-17).
 * `approval` is required on every void, a manager's own session included.
 *
 * Never resent: not here, not by the caller. A wrong PIN counts as an
 * attempt, and each request may write an audit row, so after a lost
 * response or a timeout the caller re-fetches the sale (getSale) and
 * reads its status (P6-11; utils/voidErrors.js `reconcile`). The body
 * carries the PIN: never log it or the request config.
 *
 * @param {string} saleId
 * @param {Object} payload
 * @param {string} payload.void_reason - 3–500 characters after trimming
 * @param {{ approver_id: string, pin: string }} payload.approval
 * @returns {Promise<Object>} The hydrated VOIDED sale
 */
export const voidSale = async (saleId, payload) => {
  const response = await api.post(`/sales/${saleId}/void`, payload, {
    timeout: VOID_TIMEOUT_MS,
  });
  return response.data;
};

/** POST /sales/:id/returns gives up after this long (P7-15). */
export const RETURN_TIMEOUT_MS = 30000;

/**
 * Return items from a COMPLETED sale, with a manager's or admin's
 * approval PIN (P7-9). Contract: docs/backend/returns.md.
 *
 * Unlike a void, a return may be resent (P7-15, P7-24): the body carries
 * a `client_request_id` the ReturnDialog makes once, when it opens
 * (utils/requestId.js), and every attempt from that dialog sends the same
 * id. Never resent here. After a timeout, a network error or a 5xx the
 * caller re-reads the sale (getSale) and looks for a return with that id
 * (utils/returnErrors.js `findReturnByRequestId`): found → it went
 * through; none → Try again, which resends the same body and id with the
 * PIN typed again. A resend the server has already recorded comes back
 * 200 with the recorded return (no PIN check, its body ignored), so the
 * caller shows what was recorded, by `return_id`, never the form.
 *
 * The body carries the PIN: never log it or the request config.
 *
 * @param {string} saleId
 * @param {Object} payload - schemas/returnSchema.js buildReturnPayload
 * @returns {Promise<{ return_id: string, sale: Object, resent: boolean }>}
 *   sale hydrated as GET /sales/:id (with returns[]); resent: the server
 *   answered 200, an id it had already recorded
 */
export const createReturn = async (saleId, payload) => {
  const response = await api.post(`/sales/${saleId}/returns`, payload, {
    timeout: RETURN_TIMEOUT_MS,
  });
  return {
    return_id: response.data.return_id,
    sale: response.data.sale,
    resent: response.status === 200,
  };
};

/**
 * Remove a payment from a DRAFT sale.
 *
 * @param {string} saleId
 * @param {string} paymentId
 * @returns {Promise<void>} 204 — re-fetch with getSale
 */
export const removeSalePayment = async (saleId, paymentId) => {
  await api.delete(`/sales/${saleId}/payments/${paymentId}`);
};
