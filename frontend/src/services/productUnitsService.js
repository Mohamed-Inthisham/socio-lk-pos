import api from "./api";

/**
 * Product Units Service
 *
 * Individual phones (IMEI-tracked units). Contract:
 * docs/backend/used-phones.md, docs/backend/returns.md.
 */

/**
 * Pass a returned phone after inspection (planning doc P7-7): INSPECTION
 * → IN_STOCK, stock +1, audited. Admins and managers, on their own
 * session, no PIN.
 *
 * 409 NOT_IN_INSPECTION (with `status`) when the phone isn't waiting for
 * a check (another manager passed it meanwhile); 403
 * INSPECTION_WRONG_BRANCH for a manager of another branch; 404 for an
 * unknown unit.
 *
 * @param {string} unitId - ProductUnit UUID
 * @returns {Promise<Object>} The unit, now IN_STOCK, with product, branch,
 *   phone_purchase and phone_purchase.customer
 */
export const passInspection = async (unitId) => {
  const response = await api.post(`/product-units/${unitId}/inspection-pass`);
  return response.data;
};
