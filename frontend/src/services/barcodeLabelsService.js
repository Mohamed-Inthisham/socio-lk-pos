import api from "./api";

/**
 * Barcode Labels Service (Stage 3)
 *
 * The Barcode Labels page's three endpoints. Admins and managers only;
 * cashiers get 403. Contract: docs/backend/barcode-labels.md.
 *
 * Rows carry only what a label prints: never a buying or cost price.
 */

/** Drop empty filters so they aren't sent as `?search=`. */
const cleanParams = (params) =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );

/**
 * Active QUANTITY-tracked products, for product-level labels.
 *
 * @param {Object} params - { search? (2–100 characters), page?, limit? (≤ 200) }
 * @returns {Promise<{data: Array, meta: Object}>} rows of { kind: "PRODUCT",
 *   product_id, name, model, sku, barcode, barcode_type, selling_price }
 */
export const searchProductLabels = async (params = {}) => {
  const response = await api.get("/barcode-labels/products", { params: cleanParams(params) });
  return response.data;
};

/**
 * IN_STOCK units of active IMEI- or serial-tracked products, for unit labels.
 * Managers are held to their own branch by the server (another branchId is
 * 403 WRONG_BRANCH); admins may pass any branchId or none.
 *
 * @param {Object} params - { search?, branchId?, productId?, page?, limit? }
 * @returns {Promise<{data: Array, meta: Object}>} rows of { kind: "UNIT",
 *   unit_id, unit_code, product_id, name, tracking_method, identifier_type,
 *   identifier, selling_price, branch: { id, name } }
 */
export const searchUnitLabels = async (params = {}) => {
  const response = await api.get("/barcode-labels/units", { params: cleanParams(params) });
  return response.data;
};

/**
 * Check a whole label queue and get its rows back in order. All or nothing:
 * a 400 INVALID_LABEL_ITEMS lists every item that can't be printed, by its
 * index in `items`; over 500 labels is 400 LABEL_LIMIT_EXCEEDED.
 *
 * Each item is sent with exactly its type's fields: { type: "PRODUCT",
 * productId, quantity } or { type: "UNIT", unitId }. The server refuses any
 * other field.
 *
 * @param {Object} queue - { branchId?, items }
 * @returns {Promise<{data: Array, total_labels: number}>}
 */
export const resolveLabelQueue = async ({ branchId, items }) => {
  const body = {
    ...(branchId ? { branchId } : {}),
    items: items.map((item) =>
      item.type === "PRODUCT"
        ? { type: "PRODUCT", productId: item.productId, quantity: item.quantity }
        : { type: "UNIT", unitId: item.unitId },
    ),
  };
  const response = await api.post("/barcode-labels/resolve", body);
  return response.data;
};
