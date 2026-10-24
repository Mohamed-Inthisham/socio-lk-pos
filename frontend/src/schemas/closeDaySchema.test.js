import { COUNTED_SHAPE_MESSAGE, REASON_REQUIRED_MESSAGE, buildCloseDaySchema } from "./closeDaySchema";

const check = (counted_balance, difference_reason = "", expected = "15500.00") =>
  buildCloseDaySchema(expected).safeParse({ counted_balance, difference_reason });
// The first message per field: the one the form shows (react-hook-form's firstError).
const issues = (result) =>
  result.error.issues.reduce((acc, i) => (i.path[0] in acc ? acc : { ...acc, [i.path[0]]: i.message }), {});

describe("buildCloseDaySchema (P9-11, the rounding rule)", () => {
  it("accepts an exact count, whole rupees or cents, with no reason", () => {
    expect(check("15500").success).toBe(true);
    expect(check("15500.00").success).toBe(true);
  });

  it.each(["15499.01", "15500.99"])("needs no reason under 1.00 either way (%s)", (counted) => {
    expect(check(counted).success).toBe(true);
  });

  it.each(["15499", "15501", "0"])("needs a reason from 1.00 either way (%s)", (counted) => {
    expect(issues(check(counted))).toEqual({ difference_reason: REASON_REQUIRED_MESSAGE });
    expect(issues(check(counted, "  ab  "))).toEqual({ difference_reason: REASON_REQUIRED_MESSAGE });
    expect(check(counted, "Coins short").success).toBe(true);
  });

  it("caps the reason at 500 characters", () => {
    expect(check("15000", "x".repeat(500)).success).toBe(true);
    expect(issues(check("15000", "x".repeat(501)))).toEqual({ difference_reason: "Keep the reason to 500 characters" });
  });

  it("asks for the count when blank, and refuses a sign, separators or 3 decimals", () => {
    expect(issues(check(""))).toEqual({ counted_balance: "Enter the cash counted in the box" });
    for (const bad of ["-5", "15,500", "15500.505"]) {
      expect(issues(check(bad))).toEqual({ counted_balance: COUNTED_SHAPE_MESSAGE });
    }
  });

  it("follows the expected it was built for, negative included", () => {
    expect(check("0", "", "-0.50").success).toBe(true);
    expect(issues(check("0", "", "-25.00"))).toEqual({ difference_reason: REASON_REQUIRED_MESSAGE });
    expect(check("17500", "", "17500.00").success).toBe(true);
  });

  it("refuses more than the DTO's largest amount", () => {
    expect(issues(check("10000000000.00", "Huge"))).toEqual({
      counted_balance: "Can't be more than LKR 9,999,999,999.99",
    });
  });
});
