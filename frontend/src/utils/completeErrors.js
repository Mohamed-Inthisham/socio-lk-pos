import { DAY_REFUSAL, dayRefusalOf } from "./dayRefusal";

/**
 * Complete-sale errors (planning doc P5-8)
 *
 * Turns a failed POST /sales/:id/complete into one structured error the
 * terminal can act on. The backend's errors are E1–E12 in the P5 decision
 * log (docs/backend/sales.md "Error bodies"); #32 added the ids:
 * insufficient stock carries product_id + sale_line_id, a trade-in IMEI
 * collision carries imei + payment_id.
 *
 * Result: { kind, message, status, reconcile, ...fields }
 * - kind: one of COMPLETE_ERROR
 * - message: the server's message as sent (copy for the cashier is the
 *   dialog's job, step C)
 * - status: HTTP status, or null when no response arrived
 * - reconcile: true when the request may have succeeded anyway (no
 *   response, timeout, 5xx) or already had (E2: not a DRAFT) — the caller
 *   must re-fetch the sale before saying anything (P5-7)
 * - fields, only where the error has them: product_id, product_name,
 *   sale_line_id, requested, available (out_of_stock); imei,
 *   existing_unit (unit_sold); imei, payment_id, existing_unit
 *   (trade_in_imei_in_stock; existing_unit is null when the live-IMEI
 *   index caught it); product_name (trade_in_product_inactive, when
 *   named); sale_status (not_draft); amount_paid, total (unpaid);
 *   business_date (day_not_open, day_closed: P9-9, read by `code`,
 *   utils/dayRefusal.js)
 */

export const COMPLETE_ERROR = {
  NOT_FOUND: "not_found", // E1
  NOT_DRAFT: "not_draft", // E2
  NO_LINES: "no_lines", // E3
  UNPAID: "unpaid", // E4
  OUT_OF_STOCK: "out_of_stock", // E5
  UNIT_SOLD: "unit_sold", // E6
  TRADE_IN_NO_CUSTOMER: "trade_in_no_customer", // E7
  NIC_REQUIRED: "nic_required", // E8
  TRADE_IN_PRODUCT_INACTIVE: "trade_in_product_inactive", // E9
  TRADE_IN_IMEI_IN_STOCK: "trade_in_imei_in_stock", // E10, E11
  DAY_NOT_OPEN: "day_not_open", // 409 DAY_NOT_OPEN (C10)
  DAY_CLOSED: "day_closed", // 409 DAY_CLOSED (C11)
  SERVER: "server", // E12 (5xx)
  NETWORK: "network", // no response
  TIMEOUT: "timeout", // COMPLETE_TIMEOUT_MS passed
  REJECTED: "rejected", // any other 4xx
};

const OUT_OF_STOCK_RE = /^Insufficient stock for "(.*)": requested (\d+), available (-?\d+)$/;
const UNIT_SOLD_RE = /^Cannot sell IMEI '([^']+)'/;
const NOT_DRAFT_RE = /^Cannot complete a (\w+) sale/;
const NO_LINES_RE = /^Cannot complete a sale with no lines/;
const UNPAID_RE = /amount_paid (\S+) does not equal total (\S+)$/;
const NO_CUSTOMER_RE = /TRADE_IN payments require a customer/;
const NIC_RE = /^A trade-in needs the customer's NIC/;
const PRODUCT_INACTIVE_RE = /^Product "(.*)" is inactive$/;
// Before #32 (or a product that no longer exists): the id, no name.
const PRODUCT_MISSING_RE = /^Product \S+ not found or inactive$/;
const IMEI_IN_STOCK_RE = /^IMEI already exists in inventory/;

const TIMEOUT_CODES = ["ECONNABORTED", "ETIMEDOUT"];

const messageOf = (data, fallback) => {
  const raw = data?.message;
  return (Array.isArray(raw) ? raw[0] : raw) || fallback;
};

/**
 * @param {unknown} error - the axios error from completeSale
 * @returns {{ kind: string, message: string, status: number|null,
 *   reconcile: boolean } & Record<string, unknown>}
 */
export const classifyCompleteError = (error) => {
  const response = error?.response;

  if (!response) {
    const timedOut = TIMEOUT_CODES.includes(error?.code);
    return {
      kind: timedOut ? COMPLETE_ERROR.TIMEOUT : COMPLETE_ERROR.NETWORK,
      message: error?.message || "Couldn't reach the server",
      status: null,
      reconcile: true,
    };
  }

  const { status, data } = response;
  const message = messageOf(data, error?.message || "Couldn't complete the sale");
  const base = { message, status, reconcile: false };

  if (status >= 500) {
    return { ...base, kind: COMPLETE_ERROR.SERVER, reconcile: true };
  }
  if (status === 404) {
    return { ...base, kind: COMPLETE_ERROR.NOT_FOUND };
  }

  if (status === 409) {
    // By code, before any message match: nothing was written (P9-9).
    const day = dayRefusalOf(response);
    if (day) {
      return {
        ...base,
        kind: day.code === DAY_REFUSAL.CLOSED ? COMPLETE_ERROR.DAY_CLOSED : COMPLETE_ERROR.DAY_NOT_OPEN,
        business_date: day.business_date,
      };
    }
    let match = OUT_OF_STOCK_RE.exec(message);
    if (match || data?.product_id) {
      return {
        ...base,
        kind: COMPLETE_ERROR.OUT_OF_STOCK,
        product_id: data?.product_id ?? null,
        sale_line_id: data?.sale_line_id ?? null,
        product_name: match?.[1] ?? null,
        requested: match ? Number(match[2]) : null,
        available: match ? Number(match[3]) : null,
      };
    }
    match = UNIT_SOLD_RE.exec(message);
    if (match) {
      return {
        ...base,
        kind: COMPLETE_ERROR.UNIT_SOLD,
        imei: match[1],
        existing_unit: data?.existing_unit ?? null,
      };
    }
    if (IMEI_IN_STOCK_RE.test(message)) {
      return {
        ...base,
        kind: COMPLETE_ERROR.TRADE_IN_IMEI_IN_STOCK,
        imei: data?.imei ?? null,
        payment_id: data?.payment_id ?? null,
        existing_unit: data?.existing_unit ?? null,
      };
    }
  }

  if (status === 400) {
    let match = NOT_DRAFT_RE.exec(message);
    if (match) {
      return {
        ...base,
        kind: COMPLETE_ERROR.NOT_DRAFT,
        sale_status: match[1],
        reconcile: true,
      };
    }
    if (NO_LINES_RE.test(message)) return { ...base, kind: COMPLETE_ERROR.NO_LINES };
    match = UNPAID_RE.exec(message);
    if (match) {
      return { ...base, kind: COMPLETE_ERROR.UNPAID, amount_paid: match[1], total: match[2] };
    }
    if (NO_CUSTOMER_RE.test(message)) {
      return { ...base, kind: COMPLETE_ERROR.TRADE_IN_NO_CUSTOMER };
    }
    if (NIC_RE.test(message)) return { ...base, kind: COMPLETE_ERROR.NIC_REQUIRED };
    match = PRODUCT_INACTIVE_RE.exec(message);
    if (match || PRODUCT_MISSING_RE.test(message)) {
      return {
        ...base,
        kind: COMPLETE_ERROR.TRADE_IN_PRODUCT_INACTIVE,
        product_name: match?.[1] ?? null,
      };
    }
  }

  return { ...base, kind: COMPLETE_ERROR.REJECTED };
};
