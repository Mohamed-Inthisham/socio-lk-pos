import { COMPLETE_ERROR, classifyCompleteError } from "./completeErrors";
import { dayClosedError, dayNotOpenError } from "../test/cashDayEntities";

const httpError = (status, data) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });

describe("classifyCompleteError", () => {
  it("C10: 409 DAY_NOT_OPEN → day_not_open with business_date, no reconcile (nothing was written)", () => {
    expect(classifyCompleteError(dayNotOpenError())).toEqual({
      kind: COMPLETE_ERROR.DAY_NOT_OPEN,
      message: "Today (2026-10-20) hasn't been opened. Enter the opening balance first.",
      status: 409,
      reconcile: false,
      business_date: "2026-10-20",
    });
  });

  it("C11: 409 DAY_CLOSED → day_closed with business_date, no reconcile", () => {
    expect(classifyCompleteError(dayClosedError())).toMatchObject({
      kind: COMPLETE_ERROR.DAY_CLOSED,
      status: 409,
      reconcile: false,
      business_date: "2026-10-20",
    });
  });
  it("E1: 404 → not_found, no reconcile", () => {
    expect(classifyCompleteError(httpError(404, { message: "Sale not found" }))).toEqual({
      kind: COMPLETE_ERROR.NOT_FOUND,
      message: "Sale not found",
      status: 404,
      reconcile: false,
    });
  });

  it("E2: not a DRAFT → not_draft with the status, and asks to reconcile", () => {
    const err = classifyCompleteError(
      httpError(400, {
        message: "Cannot complete a COMPLETED sale. Only DRAFT sales can be completed.",
      }),
    );

    expect(err).toMatchObject({
      kind: COMPLETE_ERROR.NOT_DRAFT,
      sale_status: "COMPLETED",
      reconcile: true,
    });
  });

  it("E3: no lines", () => {
    expect(
      classifyCompleteError(
        httpError(400, { message: "Cannot complete a sale with no lines. Add at least one line first." }),
      ).kind,
    ).toBe(COMPLETE_ERROR.NO_LINES);
  });

  it("E4: paid ≠ total → unpaid with both figures", () => {
    expect(
      classifyCompleteError(
        httpError(400, {
          message: "Cannot complete sale: amount_paid 1000.00 does not equal total 1500.00",
        }),
      ),
    ).toMatchObject({ kind: COMPLETE_ERROR.UNPAID, amount_paid: "1000.00", total: "1500.00" });
  });

  it("E5: insufficient stock → out_of_stock with the ids from #32 and the parsed figures", () => {
    const err = classifyCompleteError(
      httpError(409, {
        message: 'Insufficient stock for "USB-C Cable 1m": requested 3, available 1',
        product_id: "p-cable",
        sale_line_id: "line-1",
      }),
    );

    expect(err).toEqual({
      kind: COMPLETE_ERROR.OUT_OF_STOCK,
      message: 'Insufficient stock for "USB-C Cable 1m": requested 3, available 1',
      status: 409,
      reconcile: false,
      product_id: "p-cable",
      sale_line_id: "line-1",
      product_name: "USB-C Cable 1m",
      requested: 3,
      available: 1,
    });
  });

  it("E5: still parses the message from a server without the ids", () => {
    expect(
      classifyCompleteError(
        httpError(409, { message: 'Insufficient stock for "Case": requested 2, available 0' }),
      ),
    ).toMatchObject({
      kind: COMPLETE_ERROR.OUT_OF_STOCK,
      product_id: null,
      sale_line_id: null,
      product_name: "Case",
      requested: 2,
      available: 0,
    });
  });

  it("E6: a line's phone was sold elsewhere → unit_sold with the IMEI and unit", () => {
    const existing_unit = { id: "unit-7", status: "SOLD", product_id: "p-phone", branch_id: "b" };

    expect(
      classifyCompleteError(
        httpError(409, {
          message:
            "Cannot sell IMEI '354789102345678': status is SOLD, expected IN_STOCK. Another sale may have completed with this unit while yours was being drafted.",
          existing_unit,
        }),
      ),
    ).toMatchObject({
      kind: COMPLETE_ERROR.UNIT_SOLD,
      imei: "354789102345678",
      existing_unit,
    });
  });

  it("E7: trade-in without a customer", () => {
    expect(
      classifyCompleteError(
        httpError(400, {
          message:
            "Cannot complete sale: TRADE_IN payments require a customer on the sale; set sale.customer_id first",
        }),
      ).kind,
    ).toBe(COMPLETE_ERROR.TRADE_IN_NO_CUSTOMER);
  });

  it("E8: the customer has no NIC → nic_required", () => {
    expect(
      classifyCompleteError(httpError(400, { message: "A trade-in needs the customer's NIC" })).kind,
    ).toBe(COMPLETE_ERROR.NIC_REQUIRED);
  });

  it("E9: inactive trade-in product → named product", () => {
    expect(
      classifyCompleteError(httpError(400, { message: 'Product "Used iPhone 12 128GB" is inactive' })),
    ).toMatchObject({
      kind: COMPLETE_ERROR.TRADE_IN_PRODUCT_INACTIVE,
      product_name: "Used iPhone 12 128GB",
    });
  });

  it("E9: a missing product (id only) is the same kind, without a name", () => {
    expect(
      classifyCompleteError(
        httpError(400, { message: "Product 0b0c8f8e-1111-4222-8333-944445555666 not found or inactive" }),
      ),
    ).toMatchObject({ kind: COMPLETE_ERROR.TRADE_IN_PRODUCT_INACTIVE, product_name: null });
  });

  it.each([
    ["E10 (pre-check)", { id: "unit-9", status: "IN_STOCK", product_id: "p-used" }],
    ["E11 (live index)", null],
  ])("%s: trade-in IMEI held by the shop → imei and payment_id", (_, existing_unit) => {
    expect(
      classifyCompleteError(
        httpError(409, {
          message: "IMEI already exists in inventory",
          imei: "354789102345678",
          payment_id: "pay-ti",
          existing_unit,
        }),
      ),
    ).toMatchObject({
      kind: COMPLETE_ERROR.TRADE_IN_IMEI_IN_STOCK,
      imei: "354789102345678",
      payment_id: "pay-ti",
      existing_unit,
      reconcile: false,
    });
  });

  it("E12: a 5xx → server, and asks to reconcile", () => {
    expect(
      classifyCompleteError(httpError(500, { message: "Internal server error" })),
    ).toMatchObject({ kind: COMPLETE_ERROR.SERVER, status: 500, reconcile: true });
  });

  it("no response → network, and asks to reconcile", () => {
    expect(classifyCompleteError(new Error("Network Error"))).toEqual({
      kind: COMPLETE_ERROR.NETWORK,
      message: "Network Error",
      status: null,
      reconcile: true,
    });
  });

  it.each(["ECONNABORTED", "ETIMEDOUT"])("a timeout (%s) → timeout, and asks to reconcile", (code) => {
    const error = Object.assign(new Error("timeout of 30000ms exceeded"), { code });

    expect(classifyCompleteError(error)).toMatchObject({
      kind: COMPLETE_ERROR.TIMEOUT,
      status: null,
      reconcile: true,
    });
  });

  it("an unrecognised 4xx → rejected, keeping the first message of an array", () => {
    expect(
      classifyCompleteError(httpError(400, { message: ["something else", "and more"] })),
    ).toEqual({
      kind: COMPLETE_ERROR.REJECTED,
      message: "something else",
      status: 400,
      reconcile: false,
    });
  });
});
