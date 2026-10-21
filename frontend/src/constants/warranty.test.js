import { DEFAULT_WARRANTY, WARRANTY_CODES, WARRANTY_PERIODS, warrantyLabel } from "./warranty";

describe("warranty periods (P5-18, P5-19)", () => {
  it("lists the backend's codes in the shop's order, No warranty first", () => {
    expect(WARRANTY_CODES).toEqual([
      "NO_WARRANTY",
      "CHECKING",
      "WEEK_1",
      "WEEK_2",
      "MONTH_1",
      "MONTH_2",
      "MONTH_3",
      "MONTH_6",
      "MONTH_12",
      "MONTH_18",
      "MONTH_24",
    ]);
    expect(DEFAULT_WARRANTY).toBe("NO_WARRANTY");
  });

  it("has a cashier-facing label for each", () => {
    expect(WARRANTY_PERIODS.map((p) => p.label)).toEqual([
      "No warranty",
      "Checking",
      "1 week",
      "2 weeks",
      "1 month",
      "2 months",
      "3 months",
      "6 months",
      "12 months",
      "18 months",
      "24 months",
    ]);
  });

  it("warrantyLabel maps a code, and falls back to the code itself", () => {
    expect(warrantyLabel("MONTH_12")).toBe("12 months");
    expect(warrantyLabel("CHECKING")).toBe("Checking");
    expect(warrantyLabel("NO_WARRANTY")).toBe("No warranty");
    expect(warrantyLabel("MONTH_5")).toBe("MONTH_5");
  });
});
