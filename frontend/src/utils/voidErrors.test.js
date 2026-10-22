import { VOID_ERROR, classifyVoidError } from "./voidErrors";

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
          message: "Wrong PIN. Asha Perera's PIN is locked until 14:32.",
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
