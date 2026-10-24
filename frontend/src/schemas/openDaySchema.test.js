import { OPENING_SHAPE_MESSAGE, openDaySchema } from "./openDaySchema";

const check = (opening_balance) => openDaySchema.safeParse({ opening_balance });
const messageOf = (result) => result.error.issues[0].message;

describe("openDaySchema (P9-7)", () => {
  it.each(["5000", "5000.5", "5000.50", "0", "0.00", "  5000  "])("accepts %j", (value) => {
    expect(check(value).success).toBe(true);
  });

  it("trims the amount", () => {
    expect(check(" 5000.50 ").data).toEqual({ opening_balance: "5000.50" });
  });

  it("asks for an amount when blank", () => {
    expect(messageOf(check(""))).toBe("Enter the cash in the box");
    expect(messageOf(check("   "))).toBe("Enter the cash in the box");
  });

  it.each(["-5", "+5", "5,000", "5000.505", "5000.", ".50", "abc", "LKR 5000"])(
    "refuses %j with the shape message",
    (value) => {
      expect(messageOf(check(value))).toBe(OPENING_SHAPE_MESSAGE);
    },
  );

  it("accepts the DTO's largest amount and refuses one cent more", () => {
    expect(check("9999999999.99").success).toBe(true);
    expect(messageOf(check("10000000000.00"))).toBe("Can't be more than LKR 9,999,999,999.99");
  });
});
