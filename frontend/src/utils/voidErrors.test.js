import { SET_YOUR_PIN_MESSAGE, VOID_ERROR, classifyVoidError, voidErrorView } from "./voidErrors";
import {
  approverRefusedError,
  boughtBackError,
  integrityConflictError,
  notCompletedError,
  pinLockedError,
  resoldError,
  saleNotFoundError,
  serverError,
  takenBackOnSaleError,
  takenBackRaceError,
  voidNetworkError,
  voidTimeoutError,
  voidValidationError,
  voidWrongBranchError,
  wrongPinError,
} from "../test/voidEntities";
import { dayClosedError, dayNotOpenError } from "../test/cashDayEntities";

describe("voidErrorView: what the dialog shows (P6-11, P6-19, P6-20, P6-22)", () => {
  const view = (error, context) => voidErrorView(classifyVoidError(error), context);

  it("WRONG_PIN: the server's message with the attempts left, under the PIN", () => {
    expect(view(wrongPinError(3))).toMatchObject({ field: "pin", message: "Wrong PIN. 3 attempts left.", reconcile: false });
  });

  it("PIN_LOCKED: the unlock time, and what to do instead, under the PIN", () => {
    expect(view(pinLockedError())).toMatchObject({
      field: "pin",
      message: "Asha Perera's PIN is locked until 2:32 PM. Another manager can approve, or an admin can clear the PIN.",
    });
    expect(view(pinLockedError({ fifth: true })).message).toMatch(/^Wrong PIN\. Asha Perera's PIN is locked until 2:32 PM\./);
  });

  it.each(["APPROVER_NOT_FOUND", "APPROVER_INACTIVE", "APPROVER_NOT_MANAGER", "APPROVER_WRONG_BRANCH", "APPROVER_NO_PIN"])(
    "%s: the server's message, under the approver",
    (code) => {
      const v = view(approverRefusedError(code));
      expect(v.field).toBe("approver");
      expect(v.message).toBe(approverRefusedError(code).response.data.message);
    },
  );

  it("APPROVER_NO_PIN for yourself: set your PIN first", () => {
    expect(view(approverRefusedError("APPROVER_NO_PIN"), { approverIsSelf: true })).toMatchObject({
      field: "approver",
      message: SET_YOUR_PIN_MESSAGE,
    });
  });

  it("VOID_WRONG_BRANCH: an alert, and Void stays disabled", () => {
    expect(view(voidWrongBranchError())).toMatchObject({
      field: null,
      message: "You can only void sales at your own branch.",
      blocksVoid: true,
    });
  });

  it("RESOLD: the IMEI and a link to the later sale", () => {
    expect(view(resoldError())).toMatchObject({
      message: "The trade-in phone (IMEI 354789102345678) was sold on INV-20261022-0012. Void that sale first.",
      laterSale: { id: "sale-12", sale_number: "INV-20261022-0012" },
      lead: "The trade-in phone (IMEI 354789102345678) was sold on ",
      tail: ". Void that sale first.",
      blocksVoid: false,
    });
  });

  it("TAKEN_BACK_ON_SALE: the IMEI and a link to the later sale", () => {
    expect(view(takenBackOnSaleError())).toMatchObject({
      message: "The phone (IMEI 356789012345671) was traded back in on INV-20261022-0015. Void that sale first.",
      laterSale: { id: "sale-15", sale_number: "INV-20261022-0015" },
    });
  });

  it("BOUGHT_BACK_ON_PURCHASE: never voidable, Void stays disabled", () => {
    expect(view(boughtBackError())).toMatchObject({
      message: "This sale can't be voided: the phone (IMEI 356789012345671) was bought back on a later purchase.",
      laterSale: null,
      blocksVoid: true,
    });
  });

  it("the race (no reason): the generic taken-back wording", () => {
    expect(view(takenBackRaceError())).toMatchObject({
      message: "A phone on this sale (IMEI 356789012345671) was taken back on a later sale or purchase. Void that one first.",
      laterSale: null,
    });
  });

  it("DAY_CLOSED: the date built here (never the ISO message), Void blocked, never reconciled", () => {
    const v = view(dayClosedError());
    expect(v).toMatchObject({
      field: null,
      message:
        "Tue 20 Oct 2026 is closed: no voids until tomorrow's opening. Nothing was changed and no PIN attempt was used.",
      blocksVoid: true,
      reconcile: false,
      dayRefused: true,
    });
    expect(v.message).not.toContain("2026-10-20");
  });

  it("DAY_NOT_OPEN: open the day, then void", () => {
    expect(view(dayNotOpenError())).toMatchObject({
      message:
        "Tue 20 Oct 2026 hasn't been opened yet. Nothing was changed and no PIN attempt was used. Enter the opening balance, then void the sale.",
      blocksVoid: true,
      dayRefused: true,
    });
  });

  it("not found, integrity, validation", () => {
    expect(view(saleNotFoundError())).toMatchObject({ message: "This sale no longer exists.", blocksVoid: true });
    expect(view(integrityConflictError())).toMatchObject({ message: "Couldn't void. Nothing was changed.", reconcile: false });
    expect(view(voidValidationError())).toMatchObject({ message: "pin must be exactly 6 digits" });
  });

  it.each([
    ["a timeout", voidTimeoutError],
    ["no response", voidNetworkError],
    ["a 500", serverError],
    ["not COMPLETED any more", notCompletedError],
  ])("%s re-fetches the sale (never resends)", (_, error) => {
    expect(view(error())).toMatchObject({ reconcile: true });
  });
});

const httpError = (status, data) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });

const unit = { id: "unit-1", status: "SOLD", product_id: "p-1", branch_id: "b-1" };

describe("classifyVoidError: no response", () => {
  it("a network error reconciles", () => {
    const result = classifyVoidError(
      Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }),
    );
    expect(result).toEqual({
      kind: VOID_ERROR.NETWORK,
      message: "Network Error",
      status: null,
      reconcile: true,
      field: null,
    });
  });

  it.each(["ECONNABORTED", "ETIMEDOUT"])("a timeout (%s) reconciles", (code) => {
    const result = classifyVoidError(
      Object.assign(new Error("timeout of 30000ms exceeded"), { code }),
    );
    expect(result).toMatchObject({ kind: VOID_ERROR.TIMEOUT, status: null, reconcile: true });
  });
});

describe("classifyVoidError: server errors", () => {
  it.each([500, 502, 503])("a %s reconciles: the outcome is unknown until re-fetched", (status) => {
    expect(classifyVoidError(httpError(status, { message: "Internal server error" }))).toEqual({
      kind: VOID_ERROR.SERVER,
      message: "Internal server error",
      status,
      reconcile: true,
      field: null,
    });
  });

  it("V7, the integrity 409, doesn't reconcile: the transaction rolled back", () => {
    const message =
      "Insufficient stock for voided trade-in at product p-1, branch b-1: requested 1, available 0. " +
      "This indicates a data integrity issue — …";
    expect(classifyVoidError(httpError(409, { statusCode: 409, message, error: "Conflict" }))).toEqual({
      kind: VOID_ERROR.INTEGRITY,
      message,
      status: 409,
      reconcile: false,
      field: null,
    });
  });
});

describe("classifyVoidError: today isn't open (P9-9, C10, C11)", () => {
  it("409 DAY_CLOSED is day_closed by its code, not INTEGRITY, and doesn't reconcile", () => {
    expect(classifyVoidError(dayClosedError())).toEqual({
      kind: VOID_ERROR.DAY_CLOSED,
      message: "Today (2026-10-20) is closed. No sales, voids or returns until tomorrow's opening.",
      status: 409,
      reconcile: false,
      field: null,
      business_date: "2026-10-20",
    });
  });

  it("409 DAY_NOT_OPEN is day_not_open with the date", () => {
    expect(classifyVoidError(dayNotOpenError())).toMatchObject({
      kind: VOID_ERROR.DAY_NOT_OPEN,
      reconcile: false,
      business_date: "2026-10-20",
    });
  });
});

describe("classifyVoidError: the sale", () => {
  it("V3: 404 not found", () => {
    expect(classifyVoidError(httpError(404, { message: "Sale x not found" }))).toMatchObject({
      kind: VOID_ERROR.NOT_FOUND,
      reconcile: false,
    });
  });

  it("V4: not COMPLETED reconciles, with the status it has", () => {
    const message = "Cannot void a VOIDED sale. Only COMPLETED sales can be voided.";
    expect(classifyVoidError(httpError(400, { message }))).toEqual({
      kind: VOID_ERROR.NOT_COMPLETED,
      message,
      status: 400,
      reconcile: true,
      field: null,
      sale_status: "VOIDED",
    });
  });

  it("V1 and a malformed approval: invalid, the first validation message", () => {
    const result = classifyVoidError(
      httpError(400, {
        message: ["pin must be exactly 6 digits", "void_reason must be at most 500 characters"],
      }),
    );
    expect(result).toMatchObject({
      kind: VOID_ERROR.INVALID,
      message: "pin must be exactly 6 digits",
      reconcile: false,
    });
  });

  it("VOID_WRONG_BRANCH", () => {
    expect(
      classifyVoidError(httpError(403, { message: "This sale is at another branch.", code: "VOID_WRONG_BRANCH" })),
    ).toMatchObject({ kind: VOID_ERROR.WRONG_BRANCH, field: null, reconcile: false });
  });
});

describe("classifyVoidError: the PIN", () => {
  it("WRONG_PIN, with the attempts left, beside the PIN", () => {
    expect(
      classifyVoidError(
        httpError(403, { message: "Wrong PIN. 3 attempts left.", code: "WRONG_PIN", attempts_left: 3 }),
      ),
    ).toEqual({
      kind: VOID_ERROR.WRONG_PIN,
      message: "Wrong PIN. 3 attempts left.",
      status: 403,
      reconcile: false,
      field: "pin",
      attempts_left: 3,
    });
  });

  it("423 PIN_LOCKED, with the unlock time, beside the PIN", () => {
    expect(
      classifyVoidError(
        httpError(423, {
          message: "Wrong PIN. Asha Perera's PIN is locked until 2:32 PM.",
          code: "PIN_LOCKED",
          locked_until: "2026-10-22T09:02:00.000Z",
        }),
      ),
    ).toMatchObject({
      kind: VOID_ERROR.PIN_LOCKED,
      status: 423,
      field: "pin",
      locked_until: "2026-10-22T09:02:00.000Z",
      reconcile: false,
    });
  });

  it.each([
    "APPROVER_NOT_FOUND",
    "APPROVER_INACTIVE",
    "APPROVER_NOT_MANAGER",
    "APPROVER_WRONG_BRANCH",
    "APPROVER_NO_PIN",
  ])("%s: approver refused, beside the approver", (code) => {
    expect(classifyVoidError(httpError(403, { message: "…", code }))).toMatchObject({
      kind: VOID_ERROR.APPROVER_REFUSED,
      field: "approver",
      code,
      reconcile: false,
    });
  });

  it("a 403 without a known code is a plain forbidden", () => {
    expect(classifyVoidError(httpError(403, { message: "Forbidden resource" }))).toMatchObject({
      kind: VOID_ERROR.FORBIDDEN,
      field: null,
    });
  });
});

describe("classifyVoidError: a later transaction blocks the void (P6-22)", () => {
  it("RESOLD names the later sale", () => {
    const later_sale = { id: "sale-2", sale_number: "INV-20261022-0007" };
    expect(
      classifyVoidError(
        httpError(409, {
          message: "Cannot void this sale: trade-in phone (IMEI '356938035643809') has been resold…",
          imei: "356938035643809",
          reason: "RESOLD",
          later_sale,
          existing_unit: unit,
        }),
      ),
    ).toMatchObject({
      kind: VOID_ERROR.RESOLD,
      imei: "356938035643809",
      later_sale,
      existing_unit: unit,
      reconcile: false,
    });
  });

  it("TAKEN_BACK_ON_SALE names the later sale", () => {
    const later_sale = { id: "sale-3", sale_number: "INV-20261022-0009" };
    const result = classifyVoidError(
      httpError(409, { message: "…", imei: "490154203237518", reason: "TAKEN_BACK_ON_SALE", later_sale, existing_unit: unit }),
    );
    expect(result).toMatchObject({ kind: VOID_ERROR.TAKEN_BACK_ON_SALE, later_sale });
    expect(result).not.toHaveProperty("permanent");
  });

  it("BOUGHT_BACK_ON_PURCHASE is permanent, with no later sale", () => {
    expect(
      classifyVoidError(
        httpError(409, {
          message: "This sale can't be voided: the phone (IMEI 490154203237518) was bought back on a later purchase.",
          imei: "490154203237518",
          reason: "BOUGHT_BACK_ON_PURCHASE",
          later_sale: null,
          existing_unit: unit,
        }),
      ),
    ).toMatchObject({
      kind: VOID_ERROR.BOUGHT_BACK_ON_PURCHASE,
      permanent: true,
      later_sale: null,
    });
  });

  it("the race (reason null) is the generic taken-back case", () => {
    expect(
      classifyVoidError(
        httpError(409, { message: "…", imei: "490154203237518", reason: null, later_sale: null, existing_unit: null }),
      ),
    ).toMatchObject({
      kind: VOID_ERROR.TAKEN_BACK,
      imei: "490154203237518",
      later_sale: null,
      existing_unit: null,
      reconcile: false,
    });
  });
});

describe("classifyVoidError: anything else", () => {
  it("another 4xx is rejected, with a fallback message", () => {
    expect(classifyVoidError(httpError(429, {}))).toMatchObject({
      kind: VOID_ERROR.REJECTED,
      message: "Request failed with status code 429",
      status: 429,
      reconcile: false,
    });
  });
});
