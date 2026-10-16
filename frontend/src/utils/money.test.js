import { formatLKR, fromCents, toCents } from "./money";

describe("toCents", () => {
  it.each([
    ["1234.50", 123450],
    ["60000.00", 6000000],
    [1234.5, 123450],
    ["0.10", 10],
    [0, 0],
    // Float artefacts round to the nearest cent
    [0.1 + 0.2, 30],
    [100.3 - 50.1, 5020],
  ])("%s → %i", (value, cents) => {
    expect(toCents(value)).toBe(cents);
  });

  it.each([null, undefined, "", "  ", "abc"])("returns NaN for %p", (value) => {
    expect(toCents(value)).toBeNaN();
  });
});

describe("fromCents", () => {
  it.each([
    [123450, "1234.50"],
    [5, "0.05"],
    [0, "0.00"],
    [5020, "50.20"],
    [-250, "-2.50"],
  ])("%i → %s", (cents, value) => {
    expect(fromCents(cents)).toBe(value);
  });

  it("round-trips a cents subtraction without float drift", () => {
    expect(fromCents(toCents("100.30") - toCents("50.10"))).toBe("50.20");
    expect(fromCents(toCents("2000.00") - toCents("1765.20"))).toBe("234.80");
  });
});

describe("formatLKR", () => {
  it("formats a numeric string as LKR with two decimals", () => {
    expect(formatLKR("1500")).toMatch(/1,500\.00/);
  });

  it("returns an em dash for blank values", () => {
    expect(formatLKR(null)).toBe("—");
    expect(formatLKR("")).toBe("—");
  });
});
