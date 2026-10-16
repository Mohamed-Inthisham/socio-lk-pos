import { computeChangeCents } from "./paymentSchema";

describe("computeChangeCents", () => {
  it.each([
    ["2000.00 received for 1234.50", "1234.50", "2000.00", 76550],
    ["cents that drift in floats", "50.10", "100.30", 5020],
    ["an exact amount", "1234.50", "1234.50", 0],
    ["whole numbers without decimals", "1500", "2000", 50000],
    ["surrounding spaces", " 1234.5 ", " 2000 ", 76550],
  ])("returns the change for %s", (_, amount, cash, expected) => {
    expect(computeChangeCents(amount, cash)).toBe(expected);
  });

  it("returns a negative figure when the cash is short", () => {
    expect(computeChangeCents("1234.50", "1000")).toBe(-23450);
  });

  it.each([
    ["blank cash received", "1234.50", ""],
    ["blank amount", "", "2000"],
    ["whitespace only", "1234.50", "   "],
    ["undefined", "1234.50", undefined],
    ["null", null, "2000"],
    ["non-numeric input", "1234.50", "abc"],
    ["more than 2 decimals", "1234.505", "2000"],
    ["a negative value", "1234.50", "-2000"],
    ["thousands separators", "1,234.50", "2000"],
  ])("returns null for %s", (_, amount, cash) => {
    expect(computeChangeCents(amount, cash)).toBeNull();
  });
});
