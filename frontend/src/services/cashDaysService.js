import api from "./api";

/**
 * Cash Days Service
 *
 * The daily opening and closing balance (planning doc section 8 "P9
 * decision log"). Contract: docs/backend/cash-days.md, which wins where
 * the planning doc differs.
 *
 * A cash day in responses is { id, branch_id, business_date,
 * opening_balance, opened_by: { id, full_name }, opened_at, cash_sales,
 * cash_refunds, cash_voids_earlier, expected_balance, counted_balance,
 * difference, difference_reason, summary, closed_by: { id, full_name } |
 * null, closed_at, created_at, updated_at }; the closing fields are null
 * while the day is open.
 *
 * Money fields come back as 2-decimal strings ("15500.00"); request
 * bodies take numbers with at most 2 decimals. Every call is for the
 * terminal's branch (hooks/useTerminalBranch.js): managers and cashiers
 * only at their own, admins at any (403 CASH_DAY_WRONG_BRANCH).
 *
 * Nothing here resends: open and close carry a client_request_id the
 * dialog makes once (utils/requestId.js, P9-18) and cashDaySlice resends
 * it after a lost answer. Errors are classified by utils/cashDayErrors.js.
 */

/** POST /cash-days/open and /cash-days/:id/close give up after this long (P9-18). */
export const CASH_DAY_TIMEOUT_MS = 30000;

/**
 * GET /cash-days/current gives up after this long. The day gate blocks
 * the whole till while it reads, so a hung read must end in an error the
 * gate can offer Try again on.
 */
export const CASH_DAY_READ_TIMEOUT_MS = 15000;

/**
 * Today's cash day at a branch, for the day gate (P9-7, P9-8).
 *
 * @param {string} branchId - Branch UUID
 * @returns {Promise<{
 *   business_date: string,
 *   today: Object|null,
 *   earlier_open: { id: string, business_date: string }|null,
 *   last_closed: { business_date: string, counted_balance: string }|null }>}
 *   business_date: today in Colombo by the database clock; today: today's
 *   cash day or null; earlier_open: the oldest earlier day still open;
 *   last_closed: the most recent closed day
 */
export const getCurrentCashDay = async (branchId) => {
  const response = await api.get("/cash-days/current", {
    params: { branchId },
    timeout: CASH_DAY_READ_TIMEOUT_MS,
  });
  return response.data;
};

/**
 * Open today's cash day (P9-7). A resend with the same client_request_id
 * by the same user gets the recorded day back with 200 and its body
 * ignored; the caller re-reads getCurrentCashDay either way.
 *
 * @param {Object} payload
 * @param {string} payload.branch_id - Branch UUID
 * @param {number} payload.opening_balance - At least 0, at most 2 decimals
 * @param {string} payload.client_request_id - UUID, one per dialog
 * @returns {Promise<Object>} The cash day (201 made, 200 a resend)
 */
export const openCashDay = async (payload) => {
  const response = await api.post("/cash-days/open", payload, {
    timeout: CASH_DAY_TIMEOUT_MS,
  });
  return response.data;
};

/**
 * A cash day's figures (P9-5, P9-6, P9-15): live for an open day (the
 * close dialog), the snapshot for a closed one.
 *
 * @param {string} id - Cash day UUID
 * @returns {Promise<{
 *   cash_day_id: string, business_date: string, closed: boolean,
 *   opening_balance: string, cash_sales: string, cash_refunds: string,
 *   cash_voids_earlier: string, expected_balance: string,
 *   summary: Object }>}
 *   expected_balance may be negative; summary is { non_cash_sales,
 *   non_cash_refunds, earlier_voids_non_cash (each { CARD,
 *   BANK_TRANSFER, KOKO, MINTPAY }), trade_in_value, counts: {
 *   sales_completed, returns, voids } }
 */
export const getCashDaySummary = async (id) => {
  const response = await api.get(`/cash-days/${id}/summary`);
  return response.data;
};

/**
 * Close a cash day with the counted cash (P9-11). A resend with the same
 * client_request_id by the same user gets the closed day back with 200
 * and its body ignored, so the caller shows the returned figures, never
 * the form's.
 *
 * @param {string} id - Cash day UUID
 * @param {Object} payload
 * @param {number} payload.counted_balance - At least 0, at most 2 decimals
 * @param {number} payload.expected_seen - The expected balance the dialog
 *   showed; may be negative
 * @param {string} [payload.difference_reason] - Sent only when the
 *   difference is LKR 1.00 or more either way (the rounding rule)
 * @param {string} payload.client_request_id - UUID, one per dialog
 * @returns {Promise<Object>} The closed cash day
 */
export const closeCashDay = async (id, payload) => {
  const response = await api.post(`/cash-days/${id}/close`, payload, {
    timeout: CASH_DAY_TIMEOUT_MS,
  });
  return response.data;
};

/**
 * A branch's cash days, newest business_date first, open ones included
 * (P9-16).
 *
 * @param {Object} params
 * @param {string} params.branchId - Branch UUID
 * @param {number} [params.page]
 * @param {number} [params.limit]
 * @returns {Promise<{ data: Object[], meta: { total: number, page: number,
 *   limit: number, totalPages: number, hasNext: boolean, hasPrev: boolean } }>}
 */
export const listCashDays = async ({ branchId, page, limit }) => {
  const response = await api.get("/cash-days", { params: { branchId, page, limit } });
  return response.data;
};

/**
 * One cash day with who opened and closed it (the reprint, P9-16; the
 * close's lost-answer check).
 *
 * @param {string} id - Cash day UUID
 * @returns {Promise<Object>} The cash day
 */
export const getCashDay = async (id) => {
  const response = await api.get(`/cash-days/${id}`);
  return response.data;
};
