import api from "./api";

export const listProductUnits = async (params = {}) => {
  const response = await api.get("/product-units", { params });
  return response.data;
};

export const listAllProductUnits = async (filters = {}) => {
  const firstPage = await listProductUnits({ ...filters, page: 1, limit: 200 });
  if (firstPage.meta.totalPages <= 1) return firstPage.data;
  const pages = await Promise.all(
    Array.from({ length: firstPage.meta.totalPages - 1 }, (_, index) =>
      listProductUnits({ ...filters, page: index + 2, limit: 200 }),
    ),
  );
  return [firstPage, ...pages].flatMap((page) => page.data);
};

/**
 * Product Units Service
 *
 * Individual phones (IMEI-tracked units). Contract:
 * docs/backend/used-phones.md, docs/backend/returns.md.
 */

/**
 * One unit for its details page: the unit, product, branch, how it was
 * acquired, its sales and returns. Admins, and managers at their own branch;
 * another branch's unit is the same 404 as a missing one.
 *
 * @param {string} unitId - ProductUnit UUID
 * @returns {Promise<Object>} { unit, product, branch, acquisition, sales, returns }
 */
export const getProductUnitDetails = async (unitId) => {
  const response = await api.get(`/product-units/${unitId}/details`);
  return response.data;
};

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
