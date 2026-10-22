import api from "./api";

/**
 * Approvals Service
 *
 * The manager approval PIN (planning doc P6-15 – P6-21). Contract:
 * docs/backend/approvals.md.
 *
 * Refusals are answers about the PIN, not permission failures: 403
 * WRONG_PIN / APPROVER_* / WRONG_PASSWORD and 423 PIN_LOCKED carry a
 * `code` and a ready-to-show `message`. Never 401, so the axios
 * interceptor never tries a refresh. PINs and passwords are never
 * stored or logged.
 */

/**
 * Who can approve at a branch: active admins, and that branch's active
 * managers, with a PIN set, by name. Non-admins may ask only for their
 * own branch (403 otherwise).
 *
 * @param {string} branchId - Branch UUID
 * @returns {Promise<Array<{ id: string, full_name: string }>>}
 */
export const listApprovers = async (branchId) => {
  const response = await api.get("/approvers", { params: { branchId } });
  return response.data;
};

/**
 * Set the session user's own approval PIN (admins and managers, P6-18).
 * Resets the wrong-PIN count and any lock.
 *
 * 400: malformed or weak PIN; 403 WRONG_PASSWORD: the current password
 * is wrong; 403 without a code: a cashier.
 *
 * @param {Object} payload
 * @param {string} payload.current_password
 * @param {string} payload.pin - exactly 6 digits
 * @returns {Promise<{ has_approval_pin: true, approval_pin_set_at: string }>}
 */
export const setApprovalPin = async (payload) => {
  const response = await api.put("/auth/me/approval-pin", payload);
  return response.data;
};
