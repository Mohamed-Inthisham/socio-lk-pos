/**
 * Cash day fixtures, copied from the backend (P9 step A).
 *
 * - A cash day: backend/src/cash-days/cash-days.service.ts CashDayView
 *   (toView). opened_by / closed_by are { id, full_name } only; money is
 *   2-decimal strings; business_date "YYYY-MM-DD"; timestamps ISO; the
 *   closing fields null while open.
 * - GET /cash-days/:id/summary: CashDaySummary; the figures are the P9-5
 *   example as test/cash-days.e2e-spec.ts reads them back (opening
 *   5,000.00, cash sales 12,000.00, cash refunds 1,500.00, expected
 *   15,500.00).
 * - GET /cash-days/current: CurrentCashDay. GET /cash-days: paginate()'s
 *   { data, meta }.
 * - Errors exactly as Nest sends them: Exception(object) bodies the object
 *   as given (cash-days.service.ts), Exception(string) bodies
 *   { statusCode, message, error } (the 404s), validation
 *   { statusCode, message: [..], error }. Every error carries the request
 *   body on `config`, as axios does.
 */

import { cashierRef } from "./returnEntities";

export { cashierRef };

export const BRANCH_ID = "branch-main";
export const CASH_DAY_REQUEST_ID = "3f6a1c2e-8b4d-4e1a-9f0c-5d7b2a9e6c41";

const TENDERS_ZERO = { CARD: "0.00", BANK_TRANSFER: "0.00", KOKO: "0.00", MINTPAY: "0.00" };

/** The day summary jsonb (P9-15). */
export const daySummaryJson = (overrides = {}) => ({
  non_cash_sales: { ...TENDERS_ZERO, CARD: "500.00" },
  non_cash_refunds: { ...TENDERS_ZERO, CARD: "500.00" },
  earlier_voids_non_cash: { ...TENDERS_ZERO },
  trade_in_value: "9500.00",
  counts: { sales_completed: 3, returns: 1, voids: 1 },
  ...overrides,
});

/** Tue 20 Oct 2026, opened 9:02 AM Colombo, still open. */
export const openCashDayEntity = (overrides = {}) => ({
  id: "day-1020",
  branch_id: BRANCH_ID,
  business_date: "2026-10-20",
  opening_balance: "5000.00",
  opened_by: cashierRef,
  opened_at: "2026-10-20T03:32:00.000Z",
  cash_sales: null,
  cash_refunds: null,
  cash_voids_earlier: null,
  expected_balance: null,
  counted_balance: null,
  difference: null,
  difference_reason: null,
  summary: null,
  closed_by: null,
  closed_at: null,
  created_at: "2026-10-20T03:32:00.000Z",
  updated_at: "2026-10-20T03:32:00.000Z",
  ...overrides,
});

/** The same day closed at 6:15 PM Colombo, LKR 100.00 short. */
export const closedCashDayEntity = (overrides = {}) =>
  openCashDayEntity({
    cash_sales: "12000.00",
    cash_refunds: "1500.00",
    cash_voids_earlier: "0.00",
    expected_balance: "15500.00",
    counted_balance: "15400.00",
    difference: "-100.00",
    difference_reason: "Coins short at count",
    summary: daySummaryJson(),
    closed_by: cashierRef,
    closed_at: "2026-10-20T12:45:00.000Z",
    updated_at: "2026-10-20T12:45:00.000Z",
    ...overrides,
  });

/** GET /cash-days/:id/summary for the open day (live). */
export const cashDaySummaryEntity = (overrides = {}) => ({
  cash_day_id: "day-1020",
  business_date: "2026-10-20",
  closed: false,
  opening_balance: "5000.00",
  cash_sales: "12000.00",
  cash_refunds: "1500.00",
  cash_voids_earlier: "0.00",
  expected_balance: "15500.00",
  summary: daySummaryJson(),
  ...overrides,
});

/** GET /cash-days/current. Default: Tue 20 Oct, nothing opened yet, Sun 18 Oct the last closed. */
export const currentCashDayResponse = (overrides = {}) => ({
  business_date: "2026-10-20",
  today: null,
  earlier_open: null,
  last_closed: { business_date: "2026-10-18", counted_balance: "4800.00" },
  ...overrides,
});

/** GET /cash-days: today open, Mon 19 Oct closed, newest first. */
export const pastDaysResponse = (overrides = {}) => ({
  data: [
    openCashDayEntity(),
    closedCashDayEntity({
      id: "day-1019",
      business_date: "2026-10-19",
      opened_at: "2026-10-19T03:30:00.000Z",
      closed_at: "2026-10-19T12:40:00.000Z",
      created_at: "2026-10-19T03:30:00.000Z",
      updated_at: "2026-10-19T12:40:00.000Z",
    }),
  ],
  meta: { total: 2, page: 1, limit: 20, totalPages: 1, hasNext: false, hasPrev: false },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const OPEN_BODY = JSON.stringify({
  branch_id: BRANCH_ID,
  opening_balance: 5000,
  client_request_id: CASH_DAY_REQUEST_ID,
});

const axiosError = (status, data) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
    config: { data: OPEN_BODY },
  });

/** C1 */
export const cashDayValidationError = () =>
  axiosError(400, {
    statusCode: 400,
    message: ["opening_balance must be a number with at most 2 decimals"],
    error: "Bad Request",
  });

/** C2 */
export const cashDayWrongBranchError = () =>
  axiosError(403, {
    message: "You can only open, close and view cash days at your own branch.",
    code: "CASH_DAY_WRONG_BRANCH",
  });

/** C3 */
export const cashDayRequestIdConflictError = () =>
  axiosError(409, {
    message: "This request id was already used for another opening or closing. Start again.",
    code: "CLIENT_REQUEST_ID_CONFLICT",
  });

/** C4: closedAt null while today is open, set when it was opened and closed. */
export const dayAlreadyOpenError = (closedAt = null) =>
  axiosError(409, {
    message: closedAt
      ? "Today (2026-10-20) was already opened and closed at 6:15 PM. A closed day can't be reopened."
      : "Today (2026-10-20) is already open.",
    code: "DAY_ALREADY_OPEN",
    cash_day_id: "day-1020",
    closed_at: closedAt,
  });

/** C5 */
export const earlierDayNotClosedError = () =>
  axiosError(409, {
    message: "2026-10-19 was not closed. Close it before opening today.",
    code: "EARLIER_DAY_NOT_CLOSED",
    business_date: "2026-10-19",
    cash_day_id: "day-1019",
  });

/** C6 */
export const cashDayNotFoundError = () =>
  axiosError(404, { statusCode: 404, message: "Cash day not found", error: "Not Found" });

/** 404 on current, open and the list. */
export const branchNotFoundError = () =>
  axiosError(404, { statusCode: 404, message: "Branch not found", error: "Not Found" });

/** C7 */
export const dayAlreadyClosedError = () =>
  axiosError(409, {
    message: "2026-10-20 is already closed. A closed day can't be changed.",
    code: "DAY_ALREADY_CLOSED",
    cash_day_id: "day-1020",
    closed_at: "2026-10-20T12:45:00.000Z",
  });

/** C8: a 2,000.00 cash sale went through meanwhile. */
export const expectedChangedError = () =>
  axiosError(409, {
    message:
      "The figures changed while the day was being closed (a sale, void or return went through). Check them and close again.",
    code: "EXPECTED_CHANGED",
    summary: cashDaySummaryEntity({
      cash_sales: "14000.00",
      expected_balance: "17500.00",
      summary: daySummaryJson({ counts: { sales_completed: 4, returns: 1, voids: 1 } }),
    }),
  });

/** C9 */
export const reasonRequiredError = (difference = "-1500.00") =>
  axiosError(400, {
    message: `Short LKR ${difference.replace("-", "")}: give a reason (at least 3 characters).`,
    code: "REASON_REQUIRED",
    difference,
  });

/**
 * C10, C11 (backend 0b): complete, void or return refused because today
 * isn't open, from backend/src/cash-days/day-gate.ts assertDayOpen
 * (ConflictException(object): the body is the object as given). Default:
 * Tue 20 Oct 2026. `body` is the refused request's, as axios keeps it.
 */
export const dayNotOpenError = (businessDate = "2026-10-20", body = "{}") =>
  Object.assign(new Error("Request failed with status code 409"), {
    response: {
      status: 409,
      data: {
        message: `Today (${businessDate}) hasn't been opened. Enter the opening balance first.`,
        code: "DAY_NOT_OPEN",
        business_date: businessDate,
      },
    },
    config: { data: body },
  });

export const dayClosedError = (businessDate = "2026-10-20", body = "{}") =>
  Object.assign(new Error("Request failed with status code 409"), {
    response: {
      status: 409,
      data: {
        message: `Today (${businessDate}) is closed. No sales, voids or returns until tomorrow's opening.`,
        code: "DAY_CLOSED",
        business_date: businessDate,
      },
    },
    config: { data: body },
  });

/** The refresh failed after a 401 (api.js rejects with the refresh's error). */
export const cashDayUnauthenticatedError = () =>
  axiosError(401, { statusCode: 401, message: "Unauthorized" });

export const cashDayServerError = () =>
  axiosError(500, { statusCode: 500, message: "Internal server error" });

export const cashDayForbiddenError = () =>
  axiosError(403, { statusCode: 403, message: "Forbidden resource", error: "Forbidden" });

export const cashDayTimeoutError = () =>
  Object.assign(new Error("timeout of 30000ms exceeded"), { code: "ECONNABORTED", config: { data: OPEN_BODY } });

export const cashDayNetworkError = () =>
  Object.assign(new Error("Network Error"), { code: "ERR_NETWORK", config: { data: OPEN_BODY } });
