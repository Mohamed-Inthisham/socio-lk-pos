/**
 * Return and inspection fixtures, copied from the backend (P7 step A).
 *
 * - GET /sales/:id `returns[]`: backend/src/sales/sales.service.ts
 *   SaleReturnView / loadReturns. approver and requester are
 *   { id, full_name } only; product_unit is { id, imei } or null; money
 *   is numeric strings; return lines in the sale's line order, refunds in
 *   the order recorded. Checked against test/returns.e2e-spec.ts (the
 *   201 body).
 * - POST /sales/:id/returns: { return_id, sale } (sale-returns.controller.ts),
 *   201 when made, 200 on an accepted resend.
 * - GET /sale-returns/inspection: InspectionRow (sale-returns.service.ts).
 * - POST /product-units/:id/inspection-pass: ProductUnitsService.findOne,
 *   the unit with product, branch, phone_purchase and
 *   phone_purchase.customer (null when it came in on a sale).
 * - Errors exactly as Nest sends them: Exception(string) bodies are
 *   { statusCode, message, error }, Exception(object) bodies the object
 *   as given (sale-returns.service.ts, product-units.service.ts
 *   takenBackConflict, approvals.service.ts verify).
 *
 * Every error carries the request body on `config`, as axios does: it
 * holds the PIN, which is why nothing may log or keep the error.
 */

import { branchEntity, productEntity, saleEntity } from "./saleEntities";

const RETURNED_AT = "2026-10-23T05:10:00.000Z"; // 23 Oct 2026, 10:40 Colombo
export const CLIENT_REQUEST_ID = "7d0c8a52-4b1e-4f0a-9c3e-2a6f1b9d4e10";

export const managerRef = { id: "user-manager", full_name: "Asha Perera" };
export const cashierRef = { id: "user-cashier", full_name: "Nimal Silva" };

/** One SaleReturnView line. */
export const returnLineView = (overrides = {}) => ({
  sale_line_id: "line-case",
  quantity: 1,
  refund_share: "1600.00",
  out_of_warranty: true,
  disposition: "RESTOCKED",
  product_unit: null,
  ...overrides,
});

/** One SaleReturnView refund. */
export const refundView = (overrides = {}) => ({
  method: "CASH",
  amount: "1600.00",
  reference_number: null,
  original_payment_id: null,
  ...overrides,
});

/**
 * SaleReturnView: the first return on saleEntity, made 23 Oct 2026 by
 * the cashier with the manager's PIN. The phone (63,990.00, within its
 * 12 months) goes to inspection and 1 of the 2 cases (Checking, so
 * outside warranty: 3,200.00 / 2 = 1,600.00) back to stock. Refund due
 * 65,590.00: 10,000.00 back to the card, 55,590.00 in cash. The sale's
 * non-trade-in money is 30,290.00, so 35,300.00 of it is the trade-in's
 * share (P7-5).
 */
export const saleReturnView = (overrides = {}) => ({
  id: "ret-1",
  return_number: "RET-20261023-0001",
  created_at: RETURNED_AT,
  reason: "Faulty item — screen flickers",
  override_reason: "Case split at the seam on day two",
  out_of_warranty: true,
  refund_due: "65590.00",
  refund_total: "65590.00",
  client_request_id: CLIENT_REQUEST_ID,
  approver: managerRef,
  requester: cashierRef,
  lines: [
    returnLineView({
      sale_line_id: "line-phone",
      quantity: 1,
      refund_share: "63990.00",
      out_of_warranty: false,
      disposition: "INSPECTION",
      product_unit: { id: "unit-a15", imei: "356789012345671" },
    }),
    returnLineView(),
  ],
  refunds: [
    refundView({
      method: "CARD",
      amount: "10000.00",
      reference_number: "REV-482913",
      original_payment_id: "pay-card",
    }),
    refundView({ amount: "55590.00" }),
  ],
  ...overrides,
});

/**
 * saleEntity with the given returns applied: each line's
 * returned_quantity is the sum of its return lines, as the server keeps it.
 */
export const saleWithReturnsEntity = (returns = [saleReturnView()], overrides = {}) => {
  const base = saleEntity();
  const returned = (lineId) =>
    returns.flatMap((r) => r.lines).filter((l) => l.sale_line_id === lineId).reduce((sum, l) => sum + l.quantity, 0);
  return saleEntity({
    lines: base.lines.map((line) => ({ ...line, returned_quantity: returned(line.id) })),
    returns,
    ...overrides,
  });
};

/** POST /sales/:id/returns body (201, or 200 on an accepted resend). */
export const createReturnResponse = (ret = saleReturnView()) => ({
  return_id: ret.id,
  sale: saleWithReturnsEntity([ret]),
});

/** GET /sale-returns/inspection row (InspectionRow). */
export const inspectionRow = (overrides = {}) => ({
  product_unit: { id: "unit-a15", imei: "356789012345671", product_name: "Samsung Galaxy A15 128GB" },
  return_id: "ret-1",
  return_number: "RET-20261023-0001",
  sale_id: "sale-7",
  sale_number: "INV-20261021-0007",
  returned_at: RETURNED_AT,
  ...overrides,
});

/** backend/src/product-units/entities/product-unit.entity.ts, as findOne loads it. */
export const productUnitEntity = (overrides = {}) => ({
  id: "unit-a15",
  product_id: "p-a15",
  product: productEntity({
    id: "p-a15",
    name: "Samsung Galaxy A15 128GB",
    sku: "PHN-0007",
    barcode: "SLP-000007",
    buying_price: "52000.00",
    selling_price: "64990.00",
    default_warranty: "MONTH_12",
    phone_condition: "NEW",
    phone_model: "Galaxy A15",
    brand_id: "brand-samsung",
  }),
  branch_id: "branch-main",
  branch: branchEntity(),
  imei: "356789012345671",
  status: "IN_STOCK",
  buying_price: "52000.00",
  selling_price: "64990.00",
  phone_purchase_id: null,
  phone_purchase: null,
  created_at: "2026-09-01T04:00:00.000Z",
  updated_at: "2026-10-23T06:00:00.000Z",
  ...overrides,
});

/**
 * backend/src/stock/entities/stock.entity.ts as GET /stock?branchId=
 * returns it (StockService.findAll): with product and branch, plus the
 * computed low_stock_alert.
 */
export const stockEntity = ({ productId, name, manageStock = true, quantity = 5, ...overrides } = {}) => ({
  id: `stock-${productId}`,
  product_id: productId,
  product: productEntity({ id: productId, name, is_serialized: false, product_type: "ACCESSORY" }),
  branch_id: "branch-main",
  branch: branchEntity(),
  quantity,
  min_quantity: 2,
  manage_stock: manageStock,
  created_at: "2026-09-01T04:00:00.000Z",
  updated_at: "2026-10-21T09:02:00.000Z",
  low_stock_alert: manageStock && quantity <= 2,
  ...overrides,
});

/** GET /stock?branchId= for saleEntity's products; the cable isn't stock-tracked. */
export const branchStockResponse = () => [
  stockEntity({ productId: "p-case", name: "Silicone Case A15", quantity: 8 }),
  stockEntity({ productId: "p-charger", name: "25W Charger", quantity: 4 }),
  stockEntity({ productId: "p-cable", name: "USB-C Cable 1m", manageStock: false, quantity: 0 }),
  stockEntity({
    productId: "p-a15",
    name: "Samsung Galaxy A15 128GB",
    quantity: 3,
    product: productEntity({ id: "p-a15", name: "Samsung Galaxy A15 128GB", phone_condition: "NEW" }),
  }),
];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const RETURN_BODY = JSON.stringify({
  client_request_id: CLIENT_REQUEST_ID,
  lines: [{ sale_line_id: "line-case", quantity: 1, condition: "RESALEABLE" }],
  refunds: [{ method: "CASH", amount: 1600 }],
  reason: "Faulty item",
  override_reason: "Case split at the seam on day two",
  approval: { approver_id: "user-manager", pin: "482915" },
});

const axiosError = (status, data) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
    config: { data: RETURN_BODY },
  });

/** R1: ValidationPipe */
export const returnValidationError = () =>
  axiosError(400, {
    statusCode: 400,
    message: ["reason must be at least 3 characters after trimming"],
    error: "Bad Request",
  });

/** R2 */
export const returnSaleNotFoundError = () =>
  axiosError(404, { statusCode: 404, message: "Sale not found", error: "Not Found" });

/** R3 */
export const requestIdConflictError = () =>
  axiosError(409, {
    message: "This return request id was already used for another return. Start the return again.",
    code: "CLIENT_REQUEST_ID_CONFLICT",
  });

/** R4 */
export const saleNotCompletedError = (status = "VOIDED") =>
  axiosError(400, {
    message: `Cannot return items on a ${status} sale. Only completed sales take returns.`,
    code: "SALE_NOT_COMPLETED",
  });

/** R5 */
export const returnWrongBranchError = () =>
  axiosError(403, {
    message: "You can only make returns on sales at your own branch.",
    code: "RETURN_WRONG_BRANCH",
  });

/** R6 */
export const lineNotOnSaleError = (saleLineId = "line-other") =>
  axiosError(400, {
    message: "A line in this return isn't on this sale.",
    code: "LINE_NOT_ON_SALE",
    sale_line_id: saleLineId,
  });

/** P7-27, P7-29: a missing condition, or one sent for a line that takes none */
export const conditionInvalidError = ({ missing = true } = {}) =>
  axiosError(400, {
    message: missing
      ? '"Silicone Case A15" needs a condition: RESALEABLE (back to stock) or DAMAGED.'
      : '"Silicone Case A15" takes no condition (UNTRACKED).',
    code: "RETURN_CONDITION_INVALID",
    sale_line_id: "line-case",
  });

/** R7 */
export const qtyExceededError = (returnable = 1) =>
  axiosError(409, {
    message: `Only ${returnable} of "Silicone Case A15" can still be returned.`,
    code: "RETURN_QTY_EXCEEDED",
    sale_line_id: "line-case",
    returnable,
  });

/** R8, by reason: TAKEN_BACK_ON_SALE, BOUGHT_BACK_ON_PURCHASE, or null (the live-IMEI race) */
export const phoneTakenBackError = (reason = "TAKEN_BACK_ON_SALE") => {
  const laterSale = reason === "TAKEN_BACK_ON_SALE" ? { id: "sale-15", sale_number: "INV-20261022-0015" } : null;
  const how =
    reason === "BOUGHT_BACK_ON_PURCHASE"
      ? "it was bought back on a later purchase"
      : reason === "TAKEN_BACK_ON_SALE"
        ? `it was traded back in on ${laterSale.sale_number}`
        : "it was taken back into stock on a later sale or purchase";
  return axiosError(409, {
    message: `This phone (IMEI 356789012345671) can't be returned on this sale: ${how}.`,
    code: "PHONE_TAKEN_BACK",
    imei: "356789012345671",
    reason,
    later_sale: laterSale,
  });
};

/** R9 */
export const overrideRequiredError = (saleLineIds = ["line-case"]) =>
  axiosError(400, {
    message: "An item is outside warranty: a manager or admin must give an override reason.",
    code: "OVERRIDE_REASON_REQUIRED",
    sale_line_ids: saleLineIds,
  });

/** R10 */
export const refundTooHighError = (refundDue = "1600.00") =>
  axiosError(400, {
    message: `The refunds add up to more than the LKR ${refundDue} due.`,
    code: "REFUND_TOO_HIGH",
    refund_due: refundDue,
  });

/** R11 */
export const refundMethodError = ({ method = "TRADE_IN", originalPaymentId = "pay-ti" } = {}) =>
  axiosError(400, {
    message:
      "A refund goes back as cash, or to a card, bank transfer, Koko or Mintpay payment of this sale with the same method.",
    code: "REFUND_METHOD_NOT_ALLOWED",
    method,
    original_payment_id: originalPaymentId,
  });

/** R12 */
export const refundExceedsPaymentError = (refundable = "2500.00") =>
  axiosError(409, {
    message: `Only LKR ${refundable} can still go back to that payment.`,
    code: "REFUND_EXCEEDS_PAYMENT",
    payment_id: "pay-card",
    refundable,
  });

export const returnServerError = () =>
  axiosError(500, { statusCode: 500, message: "Internal server error" });

export const returnTimeoutError = () =>
  Object.assign(new Error("timeout of 30000ms exceeded"), { code: "ECONNABORTED", config: { data: RETURN_BODY } });

export const returnNetworkError = () =>
  Object.assign(new Error("Network Error"), { code: "ERR_NETWORK", config: { data: RETURN_BODY } });

/** POST /product-units/:id/inspection-pass by a manager of another branch */
export const inspectionWrongBranchError = () =>
  axiosError(403, {
    message: "You can only pass inspection for phones at your own branch.",
    code: "INSPECTION_WRONG_BRANCH",
  });

/** POST /product-units/:id/inspection-pass for a unit that doesn't exist */
export const unitNotFoundError = () =>
  axiosError(404, { statusCode: 404, message: "Product unit not found", error: "Not Found" });

/** POST /product-units/:id/inspection-pass on a unit that isn't in INSPECTION */
export const notInInspectionError = (status = "IN_STOCK") =>
  axiosError(409, {
    message: `This phone (IMEI 356789012345671) is not waiting for inspection (status: ${status}).`,
    code: "NOT_IN_INSPECTION",
    status,
  });
