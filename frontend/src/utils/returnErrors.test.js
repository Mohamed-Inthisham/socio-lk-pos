import { RETURN_ERROR, classifyReturnError, findReturnByRequestId, returnErrorView } from "./returnErrors";
import { SET_YOUR_PIN_MESSAGE } from "./voidErrors";
import { approverRefusedError, pinLockedError, wrongPinError } from "../test/voidEntities";
import {
  CLIENT_REQUEST_ID,
  conditionInvalidError,
  lineNotOnSaleError,
  overrideRequiredError,
  phoneTakenBackError,
  qtyExceededError,
  refundExceedsPaymentError,
  refundMethodError,
  refundTooHighError,
  requestIdConflictError,
  returnNetworkError,
  returnSaleNotFoundError,
  returnServerError,
  returnTimeoutError,
  returnValidationError,
  returnWrongBranchError,
  saleNotCompletedError,
  saleWithReturnsEntity,
} from "../test/returnEntities";
import { saleEntity } from "../test/saleEntities";
import { dayClosedError, dayNotOpenError } from "../test/cashDayEntities";

const FLAGS = { reconcile: false, refresh: false, blocks: false, field: null };

describe("classifyReturnError", () => {
  it.each([
    ["R1 validation", returnValidationError, { kind: RETURN_ERROR.INVALID, status: 400 }],
    ["R2 not found", returnSaleNotFoundError, { kind: RETURN_ERROR.NOT_FOUND, status: 404, blocks: true }],
    ["R3 request id conflict", requestIdConflictError, { kind: RETURN_ERROR.REQUEST_ID_CONFLICT, status: 409, blocks: true }],
    ["R4 not completed", saleNotCompletedError, { kind: RETURN_ERROR.NOT_COMPLETED, status: 400, blocks: true, refresh: true }],
    ["R5 wrong branch", returnWrongBranchError, { kind: RETURN_ERROR.WRONG_BRANCH, status: 403, blocks: true }],
    [
      "R6 line not on sale",
      lineNotOnSaleError,
      { kind: RETURN_ERROR.LINE_NOT_ON_SALE, status: 400, refresh: true, sale_line_id: "line-other" },
    ],
    [
      "P7-27 condition",
      conditionInvalidError,
      { kind: RETURN_ERROR.CONDITION_INVALID, status: 400, refresh: true, sale_line_id: "line-case" },
    ],
    [
      "R7 quantity",
      qtyExceededError,
      { kind: RETURN_ERROR.QTY_EXCEEDED, status: 409, refresh: true, sale_line_id: "line-case", returnable: 1 },
    ],
    [
      "R9 override",
      overrideRequiredError,
      { kind: RETURN_ERROR.OVERRIDE_REQUIRED, status: 400, field: "override_reason", sale_line_ids: ["line-case"] },
    ],
    [
      "R10 refund too high",
      refundTooHighError,
      { kind: RETURN_ERROR.REFUND_TOO_HIGH, status: 400, field: "refund", refund_due: "1600.00", refund_due_cents: 160000 },
    ],
    [
      "R11 refund method",
      refundMethodError,
      { kind: RETURN_ERROR.REFUND_METHOD, status: 400, field: "refunds", method: "TRADE_IN", original_payment_id: "pay-ti" },
    ],
    [
      "R12 refund exceeds payment",
      refundExceedsPaymentError,
      {
        kind: RETURN_ERROR.REFUND_EXCEEDS_PAYMENT,
        status: 409,
        field: "refunds",
        payment_id: "pay-card",
        refundable: "2500.00",
        refundable_cents: 250000,
      },
    ],
    ["wrong PIN", () => wrongPinError(3), { kind: RETURN_ERROR.WRONG_PIN, status: 403, field: "pin", attempts_left: 3 }],
    [
      "PIN locked",
      () => pinLockedError(),
      { kind: RETURN_ERROR.PIN_LOCKED, status: 423, field: "pin", locked_until: "2026-10-22T09:02:00.000Z" },
    ],
    [
      "approver refused",
      () => approverRefusedError("APPROVER_NO_PIN"),
      { kind: RETURN_ERROR.APPROVER_REFUSED, status: 403, field: "approver", code: "APPROVER_NO_PIN" },
    ],
    ["5xx", returnServerError, { kind: RETURN_ERROR.SERVER, status: 500, reconcile: true }],
    ["a timeout", returnTimeoutError, { kind: RETURN_ERROR.TIMEOUT, status: null, reconcile: true }],
    ["no response", returnNetworkError, { kind: RETURN_ERROR.NETWORK, status: null, reconcile: true }],
  ])("%s", (_, make, expected) => {
    const error = make();
    expect(classifyReturnError(error)).toEqual({
      ...FLAGS,
      message: expect.any(String),
      ...expected,
    });
  });

  it.each([
    ["TAKEN_BACK_ON_SALE", { later_sale: { id: "sale-15", sale_number: "INV-20261022-0015" } }],
    ["BOUGHT_BACK_ON_PURCHASE", { later_sale: null, permanent: true }],
    [null, { later_sale: null }],
  ])("R8 phone taken back, reason %s", (reason, expected) => {
    expect(classifyReturnError(phoneTakenBackError(reason))).toEqual({
      ...FLAGS,
      kind: RETURN_ERROR.PHONE_TAKEN_BACK,
      status: 409,
      message: expect.stringMatching(/^This phone \(IMEI 356789012345671\) can't be returned/),
      imei: "356789012345671",
      reason,
      ...expected,
    });
  });

  it.each([
    ["C10 DAY_NOT_OPEN", dayNotOpenError, RETURN_ERROR.DAY_NOT_OPEN],
    ["C11 DAY_CLOSED", dayClosedError, RETURN_ERROR.DAY_CLOSED],
  ])("%s: by its code, blocks, no reconcile (nothing recorded under the request id)", (_, make, kind) => {
    expect(classifyReturnError(make())).toEqual({
      ...FLAGS,
      kind,
      status: 409,
      message: expect.any(String),
      blocks: true,
      business_date: "2026-10-20",
    });
  });

  it("keeps the server's message, the first of a validation list", () => {
    expect(classifyReturnError(returnValidationError()).message).toBe(
      "reason must be at least 3 characters after trimming",
    );
    expect(classifyReturnError(refundTooHighError()).message).toBe("The refunds add up to more than the LKR 1600.00 due.");
  });

  it("reads the code, not the message: a known message under another code is that code", () => {
    const error = refundTooHighError();
    error.response.data = { ...error.response.data, code: "RETURN_QTY_EXCEEDED", sale_line_id: "line-case", returnable: 0 };
    expect(classifyReturnError(error).kind).toBe(RETURN_ERROR.QTY_EXCEEDED);
  });

  it("an unknown 403 is forbidden and an unknown 4xx with a code is rejected", () => {
    const forbidden = Object.assign(new Error("x"), { response: { status: 403, data: { message: "Forbidden resource" } } });
    const other = Object.assign(new Error("x"), { response: { status: 409, data: { message: "?", code: "SOMETHING_NEW" } } });
    expect(classifyReturnError(forbidden)).toMatchObject({ kind: RETURN_ERROR.FORBIDDEN, blocks: true });
    expect(classifyReturnError(other)).toMatchObject({ kind: RETURN_ERROR.REJECTED, blocks: false, reconcile: false });
  });

  it("never copies the request body (it holds the PIN) into the result", () => {
    for (const make of [wrongPinError, returnServerError, returnTimeoutError, refundTooHighError]) {
      expect(JSON.stringify(classifyReturnError(make()))).not.toContain("482915");
    }
  });
});

describe("findReturnByRequestId (P7-15)", () => {
  it("finds the return made with this dialog's id", () => {
    const sale = saleWithReturnsEntity();
    expect(findReturnByRequestId(sale, CLIENT_REQUEST_ID)).toBe(sale.returns[0]);
  });

  it("is null when the sale has no return with it", () => {
    expect(findReturnByRequestId(saleWithReturnsEntity(), "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(findReturnByRequestId(saleEntity(), CLIENT_REQUEST_ID)).toBeNull();
  });
});

describe("returnErrorView", () => {
  const view = (make, context) => returnErrorView(classifyReturnError(make()), context);
  const lineName = (id) => ({ "line-case": "Silicone Case A15" })[id] ?? null;

  it("PIN errors show on the PIN, with the lock's way out", () => {
    expect(view(() => wrongPinError(3))).toMatchObject({ field: "pin", message: "Wrong PIN. 3 attempts left." });
    expect(view(() => pinLockedError())).toMatchObject({
      field: "pin",
      message: "Asha Perera's PIN is locked until 2:32 PM. Another manager can approve, or an admin can clear the PIN.",
    });
  });

  it("an approver without a PIN: the session's own manager is told to set theirs", () => {
    const noPin = () => approverRefusedError("APPROVER_NO_PIN");
    expect(view(noPin, { approverIsSelf: true })).toMatchObject({ field: "approver", message: SET_YOUR_PIN_MESSAGE });
    expect(view(noPin)).toMatchObject({ field: "approver", message: "Asha Perera has no approval PIN set." });
  });

  it("a phone traded back in links the later sale", () => {
    expect(view(() => phoneTakenBackError("TAKEN_BACK_ON_SALE"))).toMatchObject({
      message: "The phone (IMEI 356789012345671) was traded back in on INV-20261022-0015. It can't be returned on this sale.",
      laterSale: { id: "sale-15", sale_number: "INV-20261022-0015" },
      lead: "The phone (IMEI 356789012345671) was traded back in on ",
      tail: ". It can't be returned on this sale.",
      blocks: false,
    });
  });

  it("a phone bought back on a purchase blocks; the race case reads generically", () => {
    expect(view(() => phoneTakenBackError("BOUGHT_BACK_ON_PURCHASE"))).toMatchObject({
      message: "The phone (IMEI 356789012345671) was bought back on a later purchase. It can't be returned on this sale.",
      laterSale: null,
      blocks: true,
    });
    expect(view(() => phoneTakenBackError(null))).toMatchObject({
      message: "The phone (IMEI 356789012345671) was taken back on a later sale or purchase. It can't be returned on this sale.",
      laterSale: null,
    });
  });

  it("the refund errors name the server's figures, with thousands separators", () => {
    // formatLKR puts a no-break space after LKR; fold it to compare the words.
    const words = (text) => text.replace(/\s/g, " ");
    const tooHigh = view(refundTooHighError);
    expect(tooHigh.field).toBe("refund");
    expect(words(tooHigh.message)).toBe("The refund can be at most LKR 1,600.00.");
    const exceeds = view(() => refundExceedsPaymentError("2500.00"));
    expect(exceeds.field).toBe("refunds");
    expect(words(exceeds.message)).toBe("Only LKR 2,500.00 can still go back to that payment.");
    expect(view(refundMethodError)).toMatchObject({ field: "refunds" });
  });

  it("the override reason is asked for on its field", () => {
    expect(view(overrideRequiredError)).toMatchObject({
      field: "override_reason",
      message: "Outside warranty: a manager or admin must give an override reason.",
    });
  });

  it("another return meanwhile: the line's name, and re-read the sale", () => {
    expect(view(() => qtyExceededError(1), { lineName })).toMatchObject({
      message: "Only 1 of Silicone Case A15 can still be returned. The sale was updated.",
      refresh: true,
    });
    expect(view(() => qtyExceededError(0), { lineName })).toMatchObject({
      message: "Silicone Case A15 has already been returned. The sale was updated.",
    });
    expect(view(conditionInvalidError, { lineName }).refresh).toBe(true);
    expect(view(conditionInvalidError).message).toMatch(/^How an item goes back has changed/);
  });

  it.each([
    [saleNotCompletedError, "This sale was voided: it can't take returns."],
    [returnSaleNotFoundError, "This sale no longer exists."],
    [requestIdConflictError, "This return can't be sent. Close it and start the return again."],
    [returnWrongBranchError, "You can only make returns on sales at your own branch."],
  ])("%o blocks the dialog", (make, message) => {
    expect(view(make)).toMatchObject({ message, blocks: true });
  });

  it("DAY_CLOSED: the date built here (never the ISO message), blocks, never reconciled or refreshed", () => {
    const v = view(dayClosedError);
    expect(v).toMatchObject({
      field: null,
      message:
        "Tue 20 Oct 2026 is closed: no returns until tomorrow's opening. Nothing was changed and no PIN attempt was used.",
      blocks: true,
      refresh: false,
      reconcile: false,
      dayRefused: true,
    });
    expect(v.message).not.toContain("2026-10-20");
  });

  it("DAY_NOT_OPEN: open the day, then make the return", () => {
    expect(view(dayNotOpenError)).toMatchObject({
      message:
        "Tue 20 Oct 2026 hasn't been opened yet. Nothing was changed and no PIN attempt was used. Enter the opening balance, then make the return.",
      blocks: true,
      dayRefused: true,
    });
  });

  it.each([returnTimeoutError, returnNetworkError, returnServerError])("%o reconciles", (make) => {
    expect(view(make)).toMatchObject({
      reconcile: true,
      blocks: false,
      message: "Couldn't confirm the return. Checking whether it went through…",
    });
  });
});
