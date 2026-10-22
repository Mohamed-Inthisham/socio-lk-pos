/**
 * Void errors (planning doc P6-11, P6-19, P6-22)
 *
 * Turns a failed POST /sales/:id/void into one structured error the
 * VoidSaleDialog can act on (docs/backend/sales.md, approvals.md). The
 * PIN refusals and the later-transaction 409s are read from the body's
 * `code` / `reason`; only V4 (not COMPLETED) is matched on its message.
 *
 * Result: { kind, message, status, reconcile, field, ...fields }
 * - kind: one of VOID_ERROR
 * - message: the server's message as sent (the dialog's wording is
 *   voidErrorView, below)
 * - status: HTTP status, or null when no response arrived
 * - reconcile: true when the void may have gone through anyway (no
 *   response, timeout, 5xx) or already had (V4: not COMPLETED). The
 *   caller re-fetches the sale (GET /sales/:id) and reads its status;
 *   it never resends the POST, which would spend another PIN attempt
 *   and could write a second audit row
 * - field: where the dialog shows it — "pin", "approver", or null
 * - fields, only where the error has them: attempts_left (wrong_pin);
 *   locked_until (pin_locked); code (approver_refused); imei, later_sale
 *   ({ id, sale_number } or null), existing_unit (resold,
 *   taken_back_on_sale, bought_back_on_purchase, taken_back); permanent
 *   (bought_back_on_purchase: never voidable); sale_status
 *   (not_completed)
 */

export const VOID_ERROR = {
  NOT_FOUND: "not_found", // V3
  NOT_COMPLETED: "not_completed", // V4
  INVALID: "invalid", // V1, a malformed approval
  WRONG_BRANCH: "wrong_branch", // 403 VOID_WRONG_BRANCH
  WRONG_PIN: "wrong_pin", // 403 WRONG_PIN
  PIN_LOCKED: "pin_locked", // 423 PIN_LOCKED
  APPROVER_REFUSED: "approver_refused", // 403 APPROVER_*
  RESOLD: "resold", // V5
  TAKEN_BACK_ON_SALE: "taken_back_on_sale", // V6, a buy-back trade-in
  BOUGHT_BACK_ON_PURCHASE: "bought_back_on_purchase", // V6, a phone purchase
  TAKEN_BACK: "taken_back", // V6, a race caught only by the live-IMEI index
  INTEGRITY: "integrity", // V7: rolled back, nothing changed
  SERVER: "server", // 5xx, V8: outcome unknown until re-fetched
  NETWORK: "network", // no response
  TIMEOUT: "timeout", // VOID_TIMEOUT_MS passed
  FORBIDDEN: "forbidden", // a 403 without a known code
  REJECTED: "rejected", // any other 4xx
};

const LATER_TRANSACTION = {
  RESOLD: VOID_ERROR.RESOLD,
  TAKEN_BACK_ON_SALE: VOID_ERROR.TAKEN_BACK_ON_SALE,
  BOUGHT_BACK_ON_PURCHASE: VOID_ERROR.BOUGHT_BACK_ON_PURCHASE,
};

const NOT_COMPLETED_RE = /^Cannot void a (\w+) sale/;

const TIMEOUT_CODES = ["ECONNABORTED", "ETIMEDOUT"];

const messageOf = (data, fallback) => {
  const raw = data?.message;
  return (Array.isArray(raw) ? raw[0] : raw) || fallback;
};

/**
 * @param {unknown} error - the axios error from voidSale
 * @returns {{ kind: string, message: string, status: number|null,
 *   reconcile: boolean, field: string|null } & Record<string, unknown>}
 */
export const classifyVoidError = (error) => {
  const response = error?.response;

  if (!response) {
    const timedOut = TIMEOUT_CODES.includes(error?.code);
    return {
      kind: timedOut ? VOID_ERROR.TIMEOUT : VOID_ERROR.NETWORK,
      message: error?.message || "Couldn't reach the server",
      status: null,
      reconcile: true,
      field: null,
    };
  }

  const { status, data } = response;
  const code = data?.code;
  const message = messageOf(data, error?.message || "Couldn't void the sale");
  const base = { message, status, reconcile: false, field: null };

  if (status >= 500) {
    return { ...base, kind: VOID_ERROR.SERVER, reconcile: true };
  }
  if (status === 404) {
    return { ...base, kind: VOID_ERROR.NOT_FOUND };
  }

  if (status === 423) {
    return {
      ...base,
      kind: VOID_ERROR.PIN_LOCKED,
      field: "pin",
      locked_until: data?.locked_until ?? null,
    };
  }

  if (status === 403) {
    if (code === "WRONG_PIN") {
      return {
        ...base,
        kind: VOID_ERROR.WRONG_PIN,
        field: "pin",
        attempts_left: data?.attempts_left ?? null,
      };
    }
    if (typeof code === "string" && code.startsWith("APPROVER_")) {
      return { ...base, kind: VOID_ERROR.APPROVER_REFUSED, field: "approver", code };
    }
    if (code === "VOID_WRONG_BRANCH") {
      return { ...base, kind: VOID_ERROR.WRONG_BRANCH };
    }
    return { ...base, kind: VOID_ERROR.FORBIDDEN };
  }

  if (status === 409) {
    // Later-transaction bodies always carry `reason` (null in the race);
    // V7's plain-string 409 never does.
    if (data && "reason" in data) {
      return {
        ...base,
        kind: LATER_TRANSACTION[data.reason] ?? VOID_ERROR.TAKEN_BACK,
        imei: data.imei ?? null,
        later_sale: data.later_sale ?? null,
        existing_unit: data.existing_unit ?? null,
        ...(data.reason === "BOUGHT_BACK_ON_PURCHASE" ? { permanent: true } : {}),
      };
    }
    return { ...base, kind: VOID_ERROR.INTEGRITY };
  }

  if (status === 400) {
    const match = NOT_COMPLETED_RE.exec(message);
    if (match) {
      return {
        ...base,
        kind: VOID_ERROR.NOT_COMPLETED,
        sale_status: match[1],
        reconcile: true,
      };
    }
    return { ...base, kind: VOID_ERROR.INVALID };
  }

  return { ...base, kind: VOID_ERROR.REJECTED };
};

export const SET_YOUR_PIN_MESSAGE =
  "Set your approval PIN first (user menu → Approval PIN), or pick another approver.";
const LOCKED_SUFFIX = " Another manager can approve, or an admin can clear the PIN.";

/**
 * What VoidSaleDialog shows for a classified void error (P6-11, P6-19,
 * P6-20, P6-22).
 *
 * @param {object} error - classifyVoidError's result
 * @param {{ approverIsSelf?: boolean }} [context] - the approver picked is
 *   the session user (APPROVER_NO_PIN then says "set your PIN first")
 * @returns {{
 *   field: "pin"|"approver"|null,   // where it shows; null = an alert
 *   message: string,
 *   laterSale: { id: string, sale_number: string }|null,  // link target
 *   lead: string|null, tail: string|null,  // the text around the link
 *   blocksVoid: boolean,            // Void stays disabled until closed
 *   reconcile: boolean,             // re-fetch the sale, never resend
 * }}
 */
export const voidErrorView = (error, { approverIsSelf = false } = {}) => {
  const view = { field: null, laterSale: null, lead: null, tail: null, blocksVoid: false, reconcile: false };
  const imei = error.imei ? ` (IMEI ${error.imei})` : "";
  const laterSaleText = (lead, tail) =>
    error.later_sale
      ? { ...view, message: `${lead}${error.later_sale.sale_number}${tail}`, laterSale: error.later_sale, lead, tail }
      : { ...view, message: `${lead}a later sale${tail}` };

  switch (error.kind) {
    case VOID_ERROR.WRONG_PIN:
      return { ...view, field: "pin", message: error.message };
    case VOID_ERROR.PIN_LOCKED:
      return { ...view, field: "pin", message: `${error.message}${LOCKED_SUFFIX}` };
    case VOID_ERROR.APPROVER_REFUSED:
      return {
        ...view,
        field: "approver",
        message: error.code === "APPROVER_NO_PIN" && approverIsSelf ? SET_YOUR_PIN_MESSAGE : error.message,
      };
    case VOID_ERROR.WRONG_BRANCH:
      return { ...view, message: error.message, blocksVoid: true };
    case VOID_ERROR.RESOLD:
      return laterSaleText(`The trade-in phone${imei} was sold on `, ". Void that sale first.");
    case VOID_ERROR.TAKEN_BACK_ON_SALE:
      return laterSaleText(`The phone${imei} was traded back in on `, ". Void that sale first.");
    case VOID_ERROR.BOUGHT_BACK_ON_PURCHASE:
      return {
        ...view,
        message: `This sale can't be voided: the phone${imei} was bought back on a later purchase.`,
        blocksVoid: true,
      };
    case VOID_ERROR.TAKEN_BACK:
      return { ...view, message: `A phone on this sale${imei} was taken back on a later sale or purchase. Void that one first.` };
    case VOID_ERROR.NOT_FOUND:
      return { ...view, message: "This sale no longer exists.", blocksVoid: true };
    case VOID_ERROR.INTEGRITY:
      return { ...view, message: "Couldn't void. Nothing was changed." };
    case VOID_ERROR.FORBIDDEN:
      return { ...view, message: "You can't void this sale." };
    case VOID_ERROR.NETWORK:
    case VOID_ERROR.TIMEOUT:
    case VOID_ERROR.SERVER:
    case VOID_ERROR.NOT_COMPLETED:
      return { ...view, message: error.message, reconcile: true };
    default:
      return { ...view, message: error.message || "Couldn't void the sale." };
  }
};
