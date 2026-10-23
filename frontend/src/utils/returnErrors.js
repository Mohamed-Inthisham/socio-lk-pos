import { toCents } from "./money";
import { SET_YOUR_PIN_MESSAGE } from "./voidErrors";

/**
 * Return errors (planning doc P7-15, P7-24, returns.md R1–R12)
 *
 * Turns a failed POST /sales/:id/returns into one structured error the
 * ReturnDialog can act on. Read by status and the body's `code`, never by
 * matching the message.
 *
 * Result: { kind, message, status, reconcile, refresh, blocks, field, ...fields }
 * - kind: one of RETURN_ERROR
 * - message: the server's message as sent (the dialog's wording is
 *   returnErrorView, below)
 * - status: HTTP status, or null when no response arrived
 * - reconcile: the return may have gone through anyway (no response, a
 *   timeout, a 5xx). The caller re-reads the sale (GET /sales/:id) and
 *   looks for a return with its client_request_id (findReturnByRequestId):
 *   found → success; none → the error with Try again, which resends the
 *   same body and id (P7-15)
 * - refresh: the dialog's copy of the sale is out of date (another
 *   return, a void, a stock-tracking change): re-read it before going on
 * - blocks: nothing in this dialog can fix it; it stays refused until
 *   closed
 * - field: where the dialog shows it — "pin", "approver",
 *   "override_reason", "refund", "refunds", or null (an alert)
 * - fields, only where the error has them: attempts_left (wrong_pin);
 *   locked_until (pin_locked); code (approver_refused); sale_line_id
 *   (line_not_on_sale, condition_invalid, qty_exceeded); returnable
 *   (qty_exceeded); imei, reason, later_sale, permanent
 *   (phone_taken_back); sale_line_ids (override_required); refund_due,
 *   refund_due_cents (refund_too_high); method, original_payment_id
 *   (refund_method); payment_id, refundable, refundable_cents
 *   (refund_exceeds_payment)
 */

export const RETURN_ERROR = {
  INVALID: "invalid", // R1 (DTO validation)
  NOT_FOUND: "not_found", // R2
  REQUEST_ID_CONFLICT: "request_id_conflict", // R3, another sale or user
  NOT_COMPLETED: "not_completed", // R4 (voided meanwhile)
  WRONG_BRANCH: "wrong_branch", // R5
  LINE_NOT_ON_SALE: "line_not_on_sale", // R6
  CONDITION_INVALID: "condition_invalid", // P7-27, P7-29
  QTY_EXCEEDED: "qty_exceeded", // R7
  PHONE_TAKEN_BACK: "phone_taken_back", // R8
  OVERRIDE_REQUIRED: "override_required", // R9
  REFUND_TOO_HIGH: "refund_too_high", // R10
  REFUND_METHOD: "refund_method", // R11
  REFUND_EXCEEDS_PAYMENT: "refund_exceeds_payment", // R12
  WRONG_PIN: "wrong_pin", // 403 WRONG_PIN
  PIN_LOCKED: "pin_locked", // 423 PIN_LOCKED
  APPROVER_REFUSED: "approver_refused", // 403 APPROVER_*
  SERVER: "server", // 5xx: outcome unknown until re-read
  NETWORK: "network", // no response
  TIMEOUT: "timeout", // RETURN_TIMEOUT_MS passed
  FORBIDDEN: "forbidden", // a 403 without a known code
  REJECTED: "rejected", // any other 4xx
};

const TIMEOUT_CODES = ["ECONNABORTED", "ETIMEDOUT"];

const messageOf = (data, fallback) => {
  const raw = data?.message;
  return (Array.isArray(raw) ? raw[0] : raw) || fallback;
};

/** By `code`: kind, field, the flags and the extra fields each one carries. */
const BY_CODE = {
  CLIENT_REQUEST_ID_CONFLICT: () => ({ kind: RETURN_ERROR.REQUEST_ID_CONFLICT, blocks: true }),
  SALE_NOT_COMPLETED: () => ({ kind: RETURN_ERROR.NOT_COMPLETED, blocks: true, refresh: true }),
  RETURN_WRONG_BRANCH: () => ({ kind: RETURN_ERROR.WRONG_BRANCH, blocks: true }),
  LINE_NOT_ON_SALE: (data) => ({
    kind: RETURN_ERROR.LINE_NOT_ON_SALE,
    refresh: true,
    sale_line_id: data.sale_line_id ?? null,
  }),
  RETURN_CONDITION_INVALID: (data) => ({
    kind: RETURN_ERROR.CONDITION_INVALID,
    refresh: true,
    sale_line_id: data.sale_line_id ?? null,
  }),
  RETURN_QTY_EXCEEDED: (data) => ({
    kind: RETURN_ERROR.QTY_EXCEEDED,
    refresh: true,
    sale_line_id: data.sale_line_id ?? null,
    returnable: data.returnable ?? null,
  }),
  PHONE_TAKEN_BACK: (data) => ({
    kind: RETURN_ERROR.PHONE_TAKEN_BACK,
    imei: data.imei ?? null,
    reason: data.reason ?? null,
    later_sale: data.later_sale ?? null,
    ...(data.reason === "BOUGHT_BACK_ON_PURCHASE" ? { permanent: true } : {}),
  }),
  OVERRIDE_REASON_REQUIRED: (data) => ({
    kind: RETURN_ERROR.OVERRIDE_REQUIRED,
    field: "override_reason",
    sale_line_ids: data.sale_line_ids ?? [],
  }),
  REFUND_TOO_HIGH: (data) => ({
    kind: RETURN_ERROR.REFUND_TOO_HIGH,
    field: "refund",
    refund_due: data.refund_due ?? null,
    refund_due_cents: data.refund_due != null ? toCents(data.refund_due) : null,
  }),
  REFUND_METHOD_NOT_ALLOWED: (data) => ({
    kind: RETURN_ERROR.REFUND_METHOD,
    field: "refunds",
    method: data.method ?? null,
    original_payment_id: data.original_payment_id ?? null,
  }),
  REFUND_EXCEEDS_PAYMENT: (data) => ({
    kind: RETURN_ERROR.REFUND_EXCEEDS_PAYMENT,
    field: "refunds",
    payment_id: data.payment_id ?? null,
    refundable: data.refundable ?? null,
    refundable_cents: data.refundable != null ? toCents(data.refundable) : null,
  }),
  WRONG_PIN: (data) => ({ kind: RETURN_ERROR.WRONG_PIN, field: "pin", attempts_left: data.attempts_left ?? null }),
  PIN_LOCKED: (data) => ({ kind: RETURN_ERROR.PIN_LOCKED, field: "pin", locked_until: data.locked_until ?? null }),
};

/**
 * @param {unknown} error - the axios error from createReturn
 * @returns {{ kind: string, message: string, status: number|null,
 *   reconcile: boolean, refresh: boolean, blocks: boolean,
 *   field: string|null } & Record<string, unknown>}
 */
export const classifyReturnError = (error) => {
  const base = { reconcile: false, refresh: false, blocks: false, field: null };
  const response = error?.response;

  if (!response) {
    const timedOut = TIMEOUT_CODES.includes(error?.code);
    return {
      ...base,
      kind: timedOut ? RETURN_ERROR.TIMEOUT : RETURN_ERROR.NETWORK,
      message: error?.message || "Couldn't reach the server",
      status: null,
      reconcile: true,
    };
  }

  const { status, data } = response;
  const code = data?.code;
  const known = { ...base, message: messageOf(data, error?.message || "Couldn't make the return"), status };

  if (status >= 500) return { ...known, kind: RETURN_ERROR.SERVER, reconcile: true };
  if (status === 404) return { ...known, kind: RETURN_ERROR.NOT_FOUND, blocks: true };

  if (typeof code === "string" && BY_CODE[code]) {
    return { ...known, ...BY_CODE[code](data) };
  }
  if (status === 403 && typeof code === "string" && code.startsWith("APPROVER_")) {
    return { ...known, kind: RETURN_ERROR.APPROVER_REFUSED, field: "approver", code };
  }
  if (status === 403) return { ...known, kind: RETURN_ERROR.FORBIDDEN, blocks: true };
  if (status === 400 && code === undefined) return { ...known, kind: RETURN_ERROR.INVALID };
  return { ...known, kind: RETURN_ERROR.REJECTED };
};

/**
 * The return a re-read sale holds for this dialog's client_request_id, or
 * null (P7-15). Found → the lost request went through.
 *
 * @param {Object} sale - GET /sales/:id, with returns[]
 * @param {string} clientRequestId
 */
export const findReturnByRequestId = (sale, clientRequestId) =>
  (sale?.returns ?? []).find((r) => r.client_request_id === clientRequestId) ?? null;

const LOCKED_SUFFIX = " Another manager can approve, or an admin can clear the PIN.";

/**
 * What ReturnDialog shows for a classified return error.
 *
 * @param {object} error - classifyReturnError's result
 * @param {{ approverIsSelf?: boolean, lineName?: (saleLineId: string) => string|null }} [context]
 *   approverIsSelf: the approver picked is the session user (APPROVER_NO_PIN
 *   then says "set your PIN first"); lineName: a sale line's product name
 * @returns {{
 *   field: string|null,          // where it shows; null = an alert
 *   message: string,
 *   laterSale: { id: string, sale_number: string }|null,  // link target
 *   lead: string|null, tail: string|null,  // the text around the link
 *   blocks: boolean,             // Return stays disabled until closed
 *   refresh: boolean,            // re-read the sale
 *   reconcile: boolean,          // re-read and look for this request's return
 * }}
 */
export const returnErrorView = (error, { approverIsSelf = false, lineName = () => null } = {}) => {
  const view = {
    field: error.field ?? null,
    laterSale: null,
    lead: null,
    tail: null,
    blocks: !!error.blocks,
    refresh: !!error.refresh,
    reconcile: !!error.reconcile,
  };
  const imei = error.imei ? ` (IMEI ${error.imei})` : "";
  const name = (error.sale_line_id && lineName(error.sale_line_id)) || "an item";

  switch (error.kind) {
    case RETURN_ERROR.WRONG_PIN:
      return { ...view, message: error.message };
    case RETURN_ERROR.PIN_LOCKED:
      return { ...view, message: `${error.message}${LOCKED_SUFFIX}` };
    case RETURN_ERROR.APPROVER_REFUSED:
      return {
        ...view,
        message: error.code === "APPROVER_NO_PIN" && approverIsSelf ? SET_YOUR_PIN_MESSAGE : error.message,
      };
    case RETURN_ERROR.PHONE_TAKEN_BACK:
      if (error.reason === "TAKEN_BACK_ON_SALE" && error.later_sale) {
        const lead = `The phone${imei} was traded back in on `;
        const tail = ". It can't be returned on this sale.";
        return {
          ...view,
          message: `${lead}${error.later_sale.sale_number}${tail}`,
          laterSale: error.later_sale,
          lead,
          tail,
        };
      }
      if (error.reason === "BOUGHT_BACK_ON_PURCHASE") {
        return {
          ...view,
          message: `The phone${imei} was bought back on a later purchase. It can't be returned on this sale.`,
          blocks: true,
        };
      }
      return { ...view, message: `The phone${imei} was taken back on a later sale or purchase. It can't be returned on this sale.` };
    case RETURN_ERROR.OVERRIDE_REQUIRED:
      return { ...view, message: "Outside warranty: a manager or admin must give an override reason." };
    case RETURN_ERROR.REFUND_TOO_HIGH:
      return { ...view, message: `The refund can be at most LKR ${error.refund_due}.` };
    case RETURN_ERROR.REFUND_EXCEEDS_PAYMENT:
      return { ...view, message: `Only LKR ${error.refundable} can still go back to that payment.` };
    case RETURN_ERROR.REFUND_METHOD:
      return { ...view, message: "Refund in cash, or back to a card, bank, Koko or Mintpay payment of this sale." };
    case RETURN_ERROR.QTY_EXCEEDED:
      return {
        ...view,
        message:
          error.returnable === 0
            ? `${name} has already been returned. The sale was updated.`
            : `Only ${error.returnable} of ${name} can still be returned. The sale was updated.`,
      };
    case RETURN_ERROR.CONDITION_INVALID:
      return { ...view, message: `How ${name} goes back has changed. The sale was updated: check it and try again.` };
    case RETURN_ERROR.LINE_NOT_ON_SALE:
      return { ...view, message: "An item isn't on this sale any more. The sale was updated." };
    case RETURN_ERROR.NOT_COMPLETED:
      return { ...view, message: "This sale was voided: it can't take returns." };
    case RETURN_ERROR.WRONG_BRANCH:
      return { ...view, message: error.message };
    case RETURN_ERROR.NOT_FOUND:
      return { ...view, message: "This sale no longer exists." };
    case RETURN_ERROR.REQUEST_ID_CONFLICT:
      return { ...view, message: "This return can't be sent. Close it and start the return again." };
    case RETURN_ERROR.FORBIDDEN:
      return { ...view, message: "You can't make returns on this sale." };
    case RETURN_ERROR.NETWORK:
    case RETURN_ERROR.TIMEOUT:
    case RETURN_ERROR.SERVER:
      return {
        ...view,
        message: "Couldn't confirm the return. Checking whether it went through…",
      };
    default:
      return { ...view, message: error.message || "Couldn't make the return." };
  }
};
