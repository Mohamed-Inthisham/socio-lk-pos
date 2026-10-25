import { DAY_ACTION, DAY_REFUSAL, dayRefusalOf, dayRefusalText } from "./dayRefusal";
import { dayClosedError, dayNotOpenError, dayAlreadyClosedError } from "../test/cashDayEntities";

describe("dayRefusalOf (P9-9, C10, C11)", () => {
  it("DAY_NOT_OPEN: the code and the server's business date", () => {
    expect(dayRefusalOf(dayNotOpenError().response)).toEqual({
      code: DAY_REFUSAL.NOT_OPEN,
      business_date: "2026-10-20",
    });
  });

  it("DAY_CLOSED: the code and the server's business date", () => {
    expect(dayRefusalOf(dayClosedError().response)).toEqual({
      code: DAY_REFUSAL.CLOSED,
      business_date: "2026-10-20",
    });
  });

  it("by status and code only: another 409 code, the same code on another status, or no response is null", () => {
    expect(dayRefusalOf(dayAlreadyClosedError().response)).toBeNull();
    expect(dayRefusalOf({ status: 400, data: { code: "DAY_CLOSED", business_date: "2026-10-20" } })).toBeNull();
    // A message that reads like one is not one.
    expect(dayRefusalOf({ status: 409, data: { message: "Today (2026-10-20) is closed." } })).toBeNull();
    expect(dayRefusalOf(undefined)).toBeNull();
  });

  it("a body without business_date gives null for it", () => {
    expect(dayRefusalOf({ status: 409, data: { code: "DAY_CLOSED" } })).toEqual({
      code: DAY_REFUSAL.CLOSED,
      business_date: null,
    });
  });
});

describe("dayRefusalText", () => {
  const closed = { code: DAY_REFUSAL.CLOSED, business_date: "2026-10-25" };
  const notOpen = { code: DAY_REFUSAL.NOT_OPEN, business_date: "2026-10-25" };

  it("complete: the date, nothing saved, and what to do with the money and the cart", () => {
    expect(dayRefusalText(closed, DAY_ACTION.COMPLETE)).toEqual({
      title: "Today is closed",
      message:
        "Sun 25 Oct 2026 was closed, so this sale can't be completed. Nothing was saved. If the customer already paid, give the payment back. The cart is kept.",
    });
    expect(dayRefusalText(notOpen, DAY_ACTION.COMPLETE)).toEqual({
      title: "Today isn't open yet",
      message:
        "Sun 25 Oct 2026 hasn't been opened, so this sale can't be completed. Nothing was saved. Count the box without this sale's cash, enter the opening balance, then complete it. The cart and its payments are kept.",
    });
  });

  it("void: the date, nothing changed, no PIN attempt used", () => {
    expect(dayRefusalText(closed, DAY_ACTION.VOID).message).toBe(
      "Sun 25 Oct 2026 is closed: no voids until tomorrow's opening. Nothing was changed and no PIN attempt was used.",
    );
    expect(dayRefusalText(notOpen, DAY_ACTION.VOID).message).toBe(
      "Sun 25 Oct 2026 hasn't been opened yet. Nothing was changed and no PIN attempt was used. Enter the opening balance, then void the sale.",
    );
  });

  it("return: the date, nothing changed, no PIN attempt used", () => {
    expect(dayRefusalText(closed, DAY_ACTION.RETURN).message).toBe(
      "Sun 25 Oct 2026 is closed: no returns until tomorrow's opening. Nothing was changed and no PIN attempt was used.",
    );
    expect(dayRefusalText(notOpen, DAY_ACTION.RETURN).message).toBe(
      "Sun 25 Oct 2026 hasn't been opened yet. Nothing was changed and no PIN attempt was used. Enter the opening balance, then make the return.",
    );
  });

  it("without a date it says Today, never an ISO date", () => {
    const text = dayRefusalText({ code: DAY_REFUSAL.CLOSED, business_date: null }, DAY_ACTION.VOID).message;
    expect(text).toMatch(/^Today is closed: no voids/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
