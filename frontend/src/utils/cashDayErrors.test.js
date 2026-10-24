import { CASH_DAY_ERROR, CASH_DAY_OP, cashDayErrorView, classifyCashDayError } from "./cashDayErrors";
import {
  branchNotFoundError,
  cashDayForbiddenError,
  cashDayNetworkError,
  cashDayNotFoundError,
  cashDayRequestIdConflictError,
  cashDayServerError,
  cashDayTimeoutError,
  cashDayUnauthenticatedError,
  cashDayValidationError,
  cashDayWrongBranchError,
  dayAlreadyClosedError,
  dayAlreadyOpenError,
  earlierDayNotClosedError,
  expectedChangedError,
  reasonRequiredError,
} from "../test/cashDayEntities";

const { CURRENT, OPEN, SUMMARY, CLOSE, LIST, DAY } = CASH_DAY_OP;
const FLAGS = { reconcile: false, refresh: false, blocks: false, field: null };
// formatLKR puts a no-break space (U+00A0) between "LKR" and the amount.
const LKR = `LKR${String.fromCharCode(0xa0)}`;

describe("classifyCashDayError", () => {
  it.each([
    ["C1 validation", cashDayValidationError, OPEN, { kind: CASH_DAY_ERROR.INVALID, status: 400 }],
    ["C2 wrong branch", cashDayWrongBranchError, OPEN, { kind: CASH_DAY_ERROR.WRONG_BRANCH, status: 403, blocks: true }],
    [
      "C3 request id conflict",
      cashDayRequestIdConflictError,
      CLOSE,
      { kind: CASH_DAY_ERROR.REQUEST_ID_CONFLICT, status: 409, blocks: true },
    ],
    [
      "C4 already open",
      () => dayAlreadyOpenError(),
      OPEN,
      { kind: CASH_DAY_ERROR.ALREADY_OPEN, status: 409, blocks: true, refresh: true, cash_day_id: "day-1020", closed_at: null },
    ],
    [
      "C5 earlier day not closed",
      earlierDayNotClosedError,
      OPEN,
      {
        kind: CASH_DAY_ERROR.EARLIER_NOT_CLOSED,
        status: 409,
        blocks: true,
        refresh: true,
        business_date: "2026-10-19",
        cash_day_id: "day-1019",
      },
    ],
    [
      "C7 already closed",
      dayAlreadyClosedError,
      CLOSE,
      {
        kind: CASH_DAY_ERROR.ALREADY_CLOSED,
        status: 409,
        blocks: true,
        refresh: true,
        cash_day_id: "day-1020",
        closed_at: "2026-10-20T12:45:00.000Z",
      },
    ],
    [
      "C9 reason required",
      () => reasonRequiredError("-1500.00"),
      CLOSE,
      {
        kind: CASH_DAY_ERROR.REASON_REQUIRED,
        status: 400,
        field: "reason",
        difference: "-1500.00",
        difference_cents: -150000,
      },
    ],
    ["401", cashDayUnauthenticatedError, CURRENT, { kind: CASH_DAY_ERROR.UNAUTHENTICATED, status: 401, blocks: true }],
    ["another 403", cashDayForbiddenError, LIST, { kind: CASH_DAY_ERROR.FORBIDDEN, status: 403, blocks: true }],
  ])("%s", (_, makeError, op, expected) => {
    expect(classifyCashDayError(makeError(), op)).toEqual({
      ...FLAGS,
      op,
      message: expect.any(String),
      ...expected,
    });
  });

  it("C8 carries the fresh summary from the 409 body", () => {
    const err = classifyCashDayError(expectedChangedError(), CLOSE);
    expect(err).toMatchObject({ ...FLAGS, kind: CASH_DAY_ERROR.EXPECTED_CHANGED, status: 409 });
    expect(err.summary).toEqual(
      expect.objectContaining({ cash_day_id: "day-1020", cash_sales: "14000.00", expected_balance: "17500.00" }),
    );
    expect(err.summary).toEqual(expectedChangedError().response.data.summary);
  });

  it("C4 for a today already closed carries closed_at", () => {
    expect(classifyCashDayError(dayAlreadyOpenError("2026-10-20T12:45:00.000Z"), OPEN).closed_at).toBe(
      "2026-10-20T12:45:00.000Z",
    );
  });

  it.each([SUMMARY, CLOSE, DAY])("a 404 from %s is C6, the day not found (re-read current)", (op) => {
    expect(classifyCashDayError(cashDayNotFoundError(), op)).toMatchObject({
      kind: CASH_DAY_ERROR.NOT_FOUND,
      status: 404,
      blocks: true,
      refresh: true,
    });
  });

  it.each([CURRENT, OPEN, LIST])("a 404 from %s is the branch not found, by the call, not the message", (op) => {
    // The same body either way: only the call tells them apart.
    expect(classifyCashDayError(cashDayNotFoundError(), op).kind).toBe(CASH_DAY_ERROR.BRANCH_NOT_FOUND);
    expect(classifyCashDayError(branchNotFoundError(), op)).toMatchObject({
      kind: CASH_DAY_ERROR.BRANCH_NOT_FOUND,
      blocks: true,
      refresh: false,
    });
  });

  it.each([
    ["no response", cashDayNetworkError, CASH_DAY_ERROR.NETWORK, null],
    ["a timeout", cashDayTimeoutError, CASH_DAY_ERROR.TIMEOUT, null],
    ["a 5xx", cashDayServerError, CASH_DAY_ERROR.SERVER, 500],
  ])("%s on open or close needs a re-read (the outcome is unknown)", (_, makeError, kind, status) => {
    for (const op of [OPEN, CLOSE]) {
      expect(classifyCashDayError(makeError(), op)).toMatchObject({ kind, status, op, reconcile: true });
    }
  });

  it.each([CURRENT, SUMMARY, LIST, DAY])("a lost answer on the read %s needs no re-read", (op) => {
    expect(classifyCashDayError(cashDayTimeoutError(), op)).toMatchObject({
      kind: CASH_DAY_ERROR.TIMEOUT,
      reconcile: false,
    });
  });

  it("reads the code, never the message", () => {
    const error = earlierDayNotClosedError();
    error.response.data.message = "Something else entirely";
    expect(classifyCashDayError(error, OPEN).kind).toBe(CASH_DAY_ERROR.EARLIER_NOT_CLOSED);

    const unknown = cashDayWrongBranchError();
    unknown.response.data.code = "SOMETHING_NEW";
    expect(classifyCashDayError(unknown, OPEN).kind).toBe(CASH_DAY_ERROR.FORBIDDEN);
  });

  it("an unknown 409 is rejected, not guessed", () => {
    const error = cashDayRequestIdConflictError();
    error.response.data.code = "SOMETHING_NEW";
    expect(classifyCashDayError(error, CLOSE)).toMatchObject({ kind: CASH_DAY_ERROR.REJECTED, status: 409 });
  });
});

describe("cashDayErrorView", () => {
  const view = (makeError, op, extra = {}) => cashDayErrorView({ ...classifyCashDayError(makeError(), op), ...extra });

  it.each([
    ["C1 on open", cashDayValidationError, OPEN, "Enter an amount of 0 or more, with at most 2 decimals."],
    [
      "C1 on close",
      cashDayValidationError,
      CLOSE,
      "Enter the counted cash as 0 or more, with at most 2 decimals, and a reason of at most 500 characters.",
    ],
    ["C2", cashDayWrongBranchError, OPEN, "You can only open, close and view cash days at your own branch."],
    ["C3 on open", cashDayRequestIdConflictError, OPEN, "This opening can't be sent. Close it and open the day again."],
    [
      "C3 on close",
      cashDayRequestIdConflictError,
      CLOSE,
      "This closing can't be sent. Close it and start closing again.",
    ],
    ["C4 open", () => dayAlreadyOpenError(), OPEN, "Today is already open."],
    [
      "C4 closed",
      () => dayAlreadyOpenError("2026-10-20T12:45:00.000Z"),
      OPEN,
      "Today was already opened and closed at 6:15 PM. A closed day can't be reopened.",
    ],
    [
      "C5, the date in words (never the server's ISO date)",
      earlierDayNotClosedError,
      OPEN,
      "Mon 19 Oct 2026 was not closed. Close it before opening today.",
    ],
    ["C6", cashDayNotFoundError, CLOSE, "This cash day wasn't found. Go back and try again."],
    ["branch 404", branchNotFoundError, CURRENT, "This branch wasn't found. Pick another branch."],
    [
      "C7",
      dayAlreadyClosedError,
      CLOSE,
      "This day was already closed at 6:15 PM. A closed day can't be changed.",
    ],
    [
      "C8",
      expectedChangedError,
      CLOSE,
      "The figures changed while you were closing (a sale, void or return went through). Check the new expected cash and close again.",
    ],
    [
      "C9, with the thousands separator",
      () => reasonRequiredError("-1500.00"),
      CLOSE,
      `Short ${LKR}1,500.00: give a reason (at least 3 characters).`,
    ],
    ["C9 over", () => reasonRequiredError("50.50"), CLOSE, `Over ${LKR}50.50: give a reason (at least 3 characters).`],
    ["401", cashDayUnauthenticatedError, CURRENT, "Your session has ended. Log in again."],
    ["another 403", cashDayForbiddenError, CLOSE, "You can't do this here."],
  ])("%s", (_, makeError, op, message) => {
    expect(view(makeError, op).message).toBe(message);
  });

  it("puts C9 beside the reason box and the rest in an alert", () => {
    expect(view(() => reasonRequiredError(), CLOSE).field).toBe("reason");
    expect(view(expectedChangedError, CLOSE).field).toBeNull();
  });

  it.each([
    [CURRENT, "Couldn't load today's cash day. Check the connection and try again."],
    [SUMMARY, "Couldn't load the day's figures. Check the connection and try again."],
    [LIST, "Couldn't load past days. Check the connection and try again."],
    [DAY, "Couldn't load this cash day. Check the connection and try again."],
  ])("a failed read of %s offers Try again", (op, message) => {
    expect(view(cashDayTimeoutError, op).message).toBe(message);
    expect(view(cashDayServerError, op).message).toBe(message);
  });

  it("an open whose answer was lost, after the re-read", () => {
    expect(view(cashDayTimeoutError, OPEN, { rereadFailed: false }).message).toBe("The day wasn't opened. Try again.");
    expect(view(cashDayNetworkError, OPEN, { rereadFailed: true }).message).toBe(
      "Couldn't reach the server. Check the connection and try again.",
    );
  });

  it("a close whose answer was lost, after the re-read", () => {
    expect(view(cashDayServerError, CLOSE, { rereadFailed: false }).message).toBe(
      "Couldn't confirm the day was closed. Try again: it sends the same count.",
    );
    expect(view(cashDayTimeoutError, CLOSE, { rereadFailed: true }).message).toBe(
      "Couldn't reach the server. Check the connection and try again.",
    );
  });

  it("never shows the server's message", () => {
    for (const [makeError, op] of [
      [earlierDayNotClosedError, OPEN],
      [dayAlreadyClosedError, CLOSE],
      [() => dayAlreadyOpenError("2026-10-20T12:45:00.000Z"), OPEN],
    ]) {
      const error = classifyCashDayError(makeError(), op);
      expect(cashDayErrorView(error).message).not.toBe(error.message);
      expect(cashDayErrorView(error).message).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});
