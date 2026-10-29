import { toCents } from "./money";
import { describeDifferenceForDisplay } from "./cashDayMath";
import { formatColomboDayLabel } from "./colomboDay";
import { formatColomboTime } from "./colomboTime";

/**
 * Cash day errors (planning doc P9-18, cash-days.md C1–C9)
 *
 * Turns a failed cashDaysService call into one structured error. Read by
 * status and the body's `code`, never by matching the message, and the
 * till never shows the server's message: it carries ISO dates
 * ("2026-10-23 was not closed"), so cashDayErrorView builds the wording
 * from the code and the fields.
 *
 * The two 404s have no `code` ("Branch not found" from current, open and
 * the list; "Cash day not found" from the summary, close and one day), so
 * the call they came from (CASH_DAY_OP) tells them apart.
 *
 * Result: { kind, op, message, status, reconcile, refresh, blocks, field, ...fields }
 * - kind: one of CASH_DAY_ERROR
 * - op: the call that failed, one of CASH_DAY_OP
 * - message: the server's message as sent (never shown)
 * - status: HTTP status, or null when no response arrived
 * - reconcile: an open or close may have gone through anyway (no
 *   response, a timeout, a 5xx): cashDaySlice re-reads before saying
 *   anything (P9-18)
 * - refresh: the gate's copy of the day is out of date: re-read
 *   GET /cash-days/current
 * - blocks: nothing in the dialog can fix it; it stays refused until
 *   closed
 * - field: where the dialog shows it, "reason" or null (an alert)
 * - fields, only where the error has them: cash_day_id, closed_at
 *   (already_open, already_closed); business_date, cash_day_id
 *   (earlier_not_closed); summary (expected_changed); difference,
 *   difference_cents (reason_required)
 */

export const CASH_DAY_OP = {
  CURRENT: "current",
  OPEN: "open",
  SUMMARY: "summary",
  CLOSE: "close",
  LIST: "list",
  DAY: "day",
};

export const CASH_DAY_ERROR = {
  INVALID: "invalid", // C1 (DTO validation)
  WRONG_BRANCH: "wrong_branch", // C2
  REQUEST_ID_CONFLICT: "request_id_conflict", // C3, another user, branch or day
  ALREADY_OPEN: "already_open", // C4
  EARLIER_NOT_CLOSED: "earlier_not_closed", // C5
  NOT_FOUND: "not_found", // C6, 404 "Cash day not found"
  BRANCH_NOT_FOUND: "branch_not_found", // 404 "Branch not found"
  ALREADY_CLOSED: "already_closed", // C7
  EXPECTED_CHANGED: "expected_changed", // C8
  REASON_REQUIRED: "reason_required", // C9
  OPEN_SALES: "open_sales", // P9-12: a draft with a payment blocks close (unpaid ones are discarded)
  UNAUTHENTICATED: "unauthenticated", // 401: the session could not be refreshed
  SERVER: "server", // 5xx: outcome unknown until re-read
  NETWORK: "network", // no response
  TIMEOUT: "timeout", // CASH_DAY_TIMEOUT_MS / CASH_DAY_READ_TIMEOUT_MS passed
  FORBIDDEN: "forbidden", // a 403 without a known code
  REJECTED: "rejected", // any other 4xx
};

const TIMEOUT_CODES = ["ECONNABORTED", "ETIMEDOUT"];

const WRITES = [CASH_DAY_OP.OPEN, CASH_DAY_OP.CLOSE];

const BRANCH_OPS = [CASH_DAY_OP.CURRENT, CASH_DAY_OP.OPEN, CASH_DAY_OP.LIST];

const messageOf = (data, fallback) => {
  const raw = data?.message;
  return (Array.isArray(raw) ? raw[0] : raw) || fallback;
};

/** By `code`: kind, field, the flags and the extra fields each one carries. */
const BY_CODE = {
  CASH_DAY_WRONG_BRANCH: () => ({ kind: CASH_DAY_ERROR.WRONG_BRANCH, blocks: true }),
  CLIENT_REQUEST_ID_CONFLICT: () => ({ kind: CASH_DAY_ERROR.REQUEST_ID_CONFLICT, blocks: true }),
  DAY_ALREADY_OPEN: (data) => ({
    kind: CASH_DAY_ERROR.ALREADY_OPEN,
    blocks: true,
    refresh: true,
    cash_day_id: data.cash_day_id ?? null,
    closed_at: data.closed_at ?? null,
  }),
  EARLIER_DAY_NOT_CLOSED: (data) => ({
    kind: CASH_DAY_ERROR.EARLIER_NOT_CLOSED,
    blocks: true,
    refresh: true,
    business_date: data.business_date ?? null,
    cash_day_id: data.cash_day_id ?? null,
  }),
  DAY_ALREADY_CLOSED: (data) => ({
    kind: CASH_DAY_ERROR.ALREADY_CLOSED,
    blocks: true,
    refresh: true,
    cash_day_id: data.cash_day_id ?? null,
    closed_at: data.closed_at ?? null,
  }),
  EXPECTED_CHANGED: (data) => ({ kind: CASH_DAY_ERROR.EXPECTED_CHANGED, summary: data.summary ?? null }),
  // Not blocking: once the paid sale is completed or its payment removed
  // (often on another till), Close day sends again from the same dialog.
  // A refused close isn't recorded, so its request id can be sent again.
  OPEN_SALES: (data) => ({
    kind: CASH_DAY_ERROR.OPEN_SALES,
    sale_count: Number.isInteger(data.sale_count) && data.sale_count > 0 ? data.sale_count : 1,
  }),
  REASON_REQUIRED: (data) => ({
    kind: CASH_DAY_ERROR.REASON_REQUIRED,
    field: "reason",
    difference: data.difference ?? null,
    difference_cents: data.difference != null ? toCents(data.difference) : null,
  }),
};

/**
 * @param {unknown} error - the axios error from a cashDaysService call
 * @param {string} op - the call, one of CASH_DAY_OP
 * @returns {{ kind: string, op: string, message: string, status: number|null,
 *   reconcile: boolean, refresh: boolean, blocks: boolean,
 *   field: string|null } & Record<string, unknown>}
 */
export const classifyCashDayError = (error, op) => {
  const base = { op, reconcile: false, refresh: false, blocks: false, field: null };
  const response = error?.response;
  const unknownOutcome = WRITES.includes(op);

  if (!response) {
    const timedOut = TIMEOUT_CODES.includes(error?.code);
    return {
      ...base,
      kind: timedOut ? CASH_DAY_ERROR.TIMEOUT : CASH_DAY_ERROR.NETWORK,
      message: error?.message || "Couldn't reach the server",
      status: null,
      reconcile: unknownOutcome,
    };
  }

  const { status, data } = response;
  const code = data?.code;
  const known = { ...base, message: messageOf(data, error?.message || "The cash day request failed"), status };

  if (status >= 500) return { ...known, kind: CASH_DAY_ERROR.SERVER, reconcile: unknownOutcome };
  if (status === 401) return { ...known, kind: CASH_DAY_ERROR.UNAUTHENTICATED, blocks: true };
  if (status === 404) {
    return BRANCH_OPS.includes(op)
      ? { ...known, kind: CASH_DAY_ERROR.BRANCH_NOT_FOUND, blocks: true }
      : { ...known, kind: CASH_DAY_ERROR.NOT_FOUND, blocks: true, refresh: true };
  }

  if (typeof code === "string" && BY_CODE[code]) {
    return { ...known, ...BY_CODE[code](data ?? {}) };
  }
  if (status === 403) return { ...known, kind: CASH_DAY_ERROR.FORBIDDEN, blocks: true };
  if (status === 400 && code === undefined) return { ...known, kind: CASH_DAY_ERROR.INVALID };
  return { ...known, kind: CASH_DAY_ERROR.REJECTED };
};

/** What a failed read says, by the call. */
const READ_FAILED = {
  [CASH_DAY_OP.CURRENT]: "Couldn't load today's cash day. Check the connection and try again.",
  [CASH_DAY_OP.SUMMARY]: "Couldn't load the day's figures. Check the connection and try again.",
  [CASH_DAY_OP.LIST]: "Couldn't load past days. Check the connection and try again.",
  [CASH_DAY_OP.DAY]: "Couldn't load this cash day. Check the connection and try again.",
};

const at = (iso) => (iso ? ` at ${formatColomboTime(iso)}` : "");

/**
 * The words for an open or close whose answer was lost, after
 * cashDaySlice re-read the server (P9-18): `rereadFailed` (the re-read
 * failed too) or not (the server shows it not done yet). Try again
 * resends the same id and body either way.
 */
const unconfirmedMessage = (error) => {
  if (error.rereadFailed) return "Couldn't reach the server. Check the connection and try again.";
  return error.op === CASH_DAY_OP.OPEN
    ? "The day wasn't opened. Try again."
    : "Couldn't confirm the day was closed. Try again: it sends the same count.";
};

/**
 * What the till shows for a classified cash day error.
 *
 * @param {object} error - classifyCashDayError's result (after a
 *   reconcile, cashDaySlice adds `rereadFailed`)
 * @returns {{ field: string|null, message: string, blocks: boolean,
 *   refresh: boolean, reconcile: boolean }}
 */
export const cashDayErrorView = (error) => {
  const view = {
    field: error.field ?? null,
    blocks: !!error.blocks,
    refresh: !!error.refresh,
    reconcile: !!error.reconcile,
  };
  const closing = error.op === CASH_DAY_OP.CLOSE;

  switch (error.kind) {
    case CASH_DAY_ERROR.INVALID:
      return {
        ...view,
        message: closing
          ? "Enter the counted cash as 0 or more, with at most 2 decimals, and a reason of at most 500 characters."
          : "Enter an amount of 0 or more, with at most 2 decimals.",
      };
    case CASH_DAY_ERROR.WRONG_BRANCH:
      return { ...view, message: "You can only open, close and view cash days at your own branch." };
    case CASH_DAY_ERROR.REQUEST_ID_CONFLICT:
      return {
        ...view,
        message: closing
          ? "This closing can't be sent. Close it and start closing again."
          : "This opening can't be sent. Close it and open the day again.",
      };
    case CASH_DAY_ERROR.ALREADY_OPEN:
      return {
        ...view,
        message: error.closed_at
          ? `Today was already opened and closed${at(error.closed_at)}. A closed day can't be reopened.`
          : "Today is already open.",
      };
    case CASH_DAY_ERROR.EARLIER_NOT_CLOSED:
      return {
        ...view,
        message: error.business_date
          ? `${formatColomboDayLabel(error.business_date)} was not closed. Close it before opening today.`
          : "An earlier day was not closed. Close it before opening today.",
      };
    case CASH_DAY_ERROR.NOT_FOUND:
      return { ...view, message: "This cash day wasn't found. Go back and try again." };
    case CASH_DAY_ERROR.BRANCH_NOT_FOUND:
      return { ...view, message: "This branch wasn't found. Pick another branch." };
    case CASH_DAY_ERROR.ALREADY_CLOSED:
      return { ...view, message: `This day was already closed${at(error.closed_at)}. A closed day can't be changed.` };
    case CASH_DAY_ERROR.EXPECTED_CHANGED:
      return {
        ...view,
        message: "A sale, void or return changed the figures. Check them and close again.",
      };
    case CASH_DAY_ERROR.OPEN_SALES: {
      const count = error.sale_count ?? 1;
      return {
        ...view,
        message: count === 1
          ? "An unfinished sale has a payment recorded, so the day can't close. Complete the sale or remove its payment, then close again."
          : `${count} unfinished sales have payments recorded, so the day can't close. Complete them or remove their payments, then close again.`,
      };
    }
    case CASH_DAY_ERROR.REASON_REQUIRED:
      return {
        ...view,
        message:
          error.difference_cents != null
            ? `${describeDifferenceForDisplay(error.difference_cents)}: give a reason (at least 3 characters).`
            : "Give a reason for the difference (at least 3 characters).",
      };
    case CASH_DAY_ERROR.UNAUTHENTICATED:
      return { ...view, message: "Your session has ended. Log in again." };
    case CASH_DAY_ERROR.FORBIDDEN:
      return { ...view, message: "You can't do this here." };
    case CASH_DAY_ERROR.NETWORK:
    case CASH_DAY_ERROR.TIMEOUT:
    case CASH_DAY_ERROR.SERVER:
      if (error.reconcile) return { ...view, message: unconfirmedMessage(error) };
      return { ...view, message: READ_FAILED[error.op] ?? READ_FAILED[CASH_DAY_OP.CURRENT] };
    default:
      if (closing) return { ...view, message: "Couldn't close the day." };
      if (error.op === CASH_DAY_OP.OPEN) return { ...view, message: "Couldn't open the day." };
      return { ...view, message: READ_FAILED[error.op] ?? READ_FAILED[CASH_DAY_OP.CURRENT] };
  }
};
