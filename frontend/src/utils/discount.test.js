import {
  discountShortLabel,
  discountedUnitPrice,
  percentOfCentsHalfUp,
  previewDiscount,
} from "./discount";

const line = (overrides = {}) => ({
  unit_price: "200.00",
  quantity: 2,
  discount_type: null,
  discount_value: null,
  discount_amount: "0.00",
  line_total: "400.00",
  ...overrides,
});

describe("line discounts (P5-20)", () => {
  it("rounds a percent half-up on the exact value, like the server", () => {
    expect(percentOfCentsHalfUp(435, 50)).toBe(218); // 2.175 → 2.18 (F3)
    expect(percentOfCentsHalfUp(33333, 10)).toBe(3333);
    expect(percentOfCentsHalfUp(20, 12.5)).toBe(3);
  });

  it("gives the price per unit after the discount", () => {
    expect(discountedUnitPrice(line())).toBeNull();
    expect(
      discountedUnitPrice(line({ discount_type: "UNIT_PRICE", discount_value: "160.00", discount_amount: "80.00" })),
    ).toBe("160.00");
    expect(
      discountedUnitPrice(line({ discount_type: "PERCENT", discount_value: "20.00", discount_amount: "80.00" })),
    ).toBe("160.00");
    expect(
      discountedUnitPrice(
        line({ discount_type: "AMOUNT", discount_value: "50.00", discount_amount: "50.00", line_total: "350.00" }),
      ),
    ).toBe("175.00");
  });

  it("labels a discount short: 20% / 160.00 each; nothing for AMOUNT", () => {
    expect(discountShortLabel(line({ discount_type: "PERCENT", discount_value: "20.00", discount_amount: "80.00" }))).toBe(
      "20%",
    );
    expect(
      discountShortLabel(
        line({ discount_type: "UNIT_PRICE", discount_value: "160.00", discount_amount: "80.00" }),
        (v) => `[${v}]`,
      ),
    ).toBe("[160.00] each");
    expect(discountShortLabel(line({ discount_type: "AMOUNT", discount_value: "50", discount_amount: "50" }))).toBeNull();
    expect(discountShortLabel(line())).toBeNull();
  });

  describe("previewDiscount", () => {
    const preview = (mode, input, overrides = {}) =>
      previewDiscount({ unitPrice: "200.00", quantity: 2, mode, input, ...overrides });

    it("previews a price each: (unit − price) × qty off", () => {
      expect(preview("UNIT_PRICE", "160")).toMatchObject({
        priceCents: 16000,
        offCents: 8000,
        totalCents: 32000,
        none: false,
      });
    });

    it("previews a percent of the line", () => {
      expect(preview("PERCENT", "20")).toMatchObject({ percent: 20, offCents: 8000, totalCents: 32000 });
      expect(preview("PERCENT", "50", { unitPrice: "4.35", quantity: 1 })).toMatchObject({
        offCents: 218,
        totalCents: 217,
      });
    });

    it("allows a price of 0 and 100%", () => {
      expect(preview("UNIT_PRICE", "0")).toMatchObject({ offCents: 40000, totalCents: 0 });
      expect(preview("PERCENT", "100")).toMatchObject({ offCents: 40000, totalCents: 0 });
    });

    it("marks what takes nothing off: the unit price itself, or 0%", () => {
      expect(preview("UNIT_PRICE", "200")).toMatchObject({ none: true, offCents: 0 });
      expect(preview("PERCENT", "0")).toMatchObject({ none: true });
    });

    it.each([
      ["UNIT_PRICE", "", "Enter the price each."],
      ["UNIT_PRICE", "200.01", "The price each can't be more than the unit price (200.00)."],
      ["UNIT_PRICE", "1.234", "Use a price with up to 2 decimals."],
      ["PERCENT", "", "Enter the percent off."],
      ["PERCENT", "100.5", "The percent can't be more than 100."],
      ["PERCENT", "1..2", "Use a number with up to 2 decimals."],
    ])("%s %j is an error", (mode, input, error) => {
      expect(preview(mode, input)).toEqual({ error });
    });
  });
});
