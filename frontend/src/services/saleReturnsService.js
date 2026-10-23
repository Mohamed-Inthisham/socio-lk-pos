import api from "./api";

/**
 * Sale Returns Service
 *
 * The /sale-returns reads (planning doc P7-7, P7-33). Contract:
 * docs/backend/returns.md. Making a return is salesService.createReturn
 * (POST /sales/:id/returns).
 */

/**
 * Phones to check: a branch's returned phones in INSPECTION, each with
 * the latest return that brought it back, oldest first, unpaginated.
 * Admins and managers; a manager asking for another branch gets 403
 * INSPECTION_WRONG_BRANCH.
 *
 * @param {string} branchId - Branch UUID
 * @returns {Promise<Array<{
 *   product_unit: { id: string, imei: string, product_name: string },
 *   return_id: string, return_number: string,
 *   sale_id: string, sale_number: string, returned_at: string }>>}
 */
export const listInspection = async (branchId) => {
  const response = await api.get("/sale-returns/inspection", { params: { branchId } });
  return response.data;
};
