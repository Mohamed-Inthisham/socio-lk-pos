import {
  DUPLICATE_IMEI_MESSAGE,
  buildPaymentPayload,
  buildPaymentSchema,
  computeChangeCents,
  paymentFormDefaults,
} from "./paymentSchema";

// Form values as the dialog holds them (strings), for a TRADE_IN.
const tradeInValues = (overrides = {}) => ({
  ...paymentFormDefaults("50000.00"),
  payment_method: "TRADE_IN",
  trade_in_product_id: "p-used-ip12",
  trade_in_imei: "354789102345678",
  trade_in_buying_price: "40000",
  ...overrides,
});

// First message per field: zod 4 keeps running a field's later checks
// after one fails, and the dialog (zodResolver) shows only the first.
const issues = (result) => {
  const first = {};
  for (const issue of result.error.issues) first[issue.path.join(".")] ??= issue.message;
  return first;
};

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

describe("paymentFormDefaults", () => {
  it("starts on Cash with the balance as the amount and an empty trade-in value (P4-5)", () => {
    expect(paymentFormDefaults("50000.00")).toEqual({
      payment_method: "CASH",
      amount: "50000.00",
      cash_received: "",
      reference_number: "",
      trade_in_product_id: "",
      trade_in_imei: "",
      trade_in_buying_price: "",
      trade_in_selling_price: "",
      trade_in_notes: "",
    });
  });
});

describe("buildPaymentSchema — TRADE_IN", () => {
  const parse = (values, options) => buildPaymentSchema("50000.00", options).safeParse(values);

  it("accepts a product, IMEI and value, with resale price and notes left blank", () => {
    expect(parse(tradeInValues()).success).toBe(true);
  });

  it("ignores the Amount field: the trade-in value is the amount", () => {
    expect(parse(tradeInValues({ amount: "" })).success).toBe(true);
  });

  it("asks for the product, IMEI and trade-in value", () => {
    const result = parse(
      tradeInValues({ trade_in_product_id: "", trade_in_imei: "  ", trade_in_buying_price: "" }),
    );

    expect(issues(result)).toEqual({
      trade_in_product_id: "Pick the trade-in product",
      trade_in_imei: "Enter the IMEI",
      trade_in_buying_price: "Enter the trade-in value",
    });
  });

  it.each([
    ["7 characters", "1234567"],
    ["51 characters", "1".repeat(51)],
    ["a dash", "35478-9102345678"],
    ["an inner space", "35478 9102345678"],
  ])("rejects an IMEI with %s", (_, imei) => {
    expect(issues(parse(tradeInValues({ trade_in_imei: imei })))).toEqual({
      trade_in_imei: "IMEI must be 8–50 letters or digits",
    });
  });

  it.each([
    ["8 digits", "12345678"],
    ["50 letters and digits", "A1".repeat(25)],
    ["a 15-digit IMEI that fails Luhn (only a soft hint, P4-7)", "354789102345679"],
    ["surrounding spaces", "  354789102345678  "],
  ])("accepts an IMEI of %s", (_, imei) => {
    expect(parse(tradeInValues({ trade_in_imei: imei })).success).toBe(true);
  });

  it("rejects an IMEI already on another trade-in on this sale, ignoring case and spaces", () => {
    const options = { tradeInImeis: ["ab12345678"] };

    expect(issues(parse(tradeInValues({ trade_in_imei: " AB12345678 " }), options))).toEqual({
      trade_in_imei: DUPLICATE_IMEI_MESSAGE,
    });
    expect(parse(tradeInValues(), options).success).toBe(true);
  });

  it("caps the trade-in value at the balance due, in cents (P4-4)", () => {
    expect(parse(tradeInValues({ trade_in_buying_price: "50000.00" })).success).toBe(true);
    expect(issues(parse(tradeInValues({ trade_in_buying_price: "50000.01" }))).trade_in_buying_price).toMatch(
      /^Trade-in value can't exceed the balance due \(LKR\s50,000\.00\)\. Add items, or record the phone purchase separately\.$/,
    );
  });

  it.each([
    ["zero", "0", "Trade-in value must be more than 0"],
    ["0.00", "0.00", "Trade-in value must be more than 0"],
    ["more than 2 decimals", "100.505", "Enter an amount like 1500 or 1499.80"],
    ["a negative value", "-100", "Enter an amount like 1500 or 1499.80"],
  ])("rejects a trade-in value of %s", (_, value, message) => {
    expect(issues(parse(tradeInValues({ trade_in_buying_price: value })))).toEqual({
      trade_in_buying_price: message,
    });
  });

  it.each([
    ["zero", "0", "Resale price must be more than 0"],
    ["0.00", "0.00", "Resale price must be more than 0"],
    ["text", "abc", "Enter an amount like 1500 or 1499.80"],
  ])("rejects a resale price of %s (P4-6)", (_, value, message) => {
    expect(issues(parse(tradeInValues({ trade_in_selling_price: value })))).toEqual({
      trade_in_selling_price: message,
    });
  });

  it("accepts a resale price below the trade-in value (that's only a warning, P4-6)", () => {
    expect(parse(tradeInValues({ trade_in_selling_price: "0.01" })).success).toBe(true);
  });
});

describe("buildPaymentPayload", () => {
  it("sends the trade-in value as both amount and trade_in_buying_price, leaving blank optionals out", () => {
    expect(buildPaymentPayload(tradeInValues({ trade_in_imei: " 354789102345678 " }))).toEqual({
      payment_method: "TRADE_IN",
      amount: 40000,
      trade_in_product_id: "p-used-ip12",
      trade_in_imei: "354789102345678",
      trade_in_buying_price: 40000,
    });
  });

  it("sends the resale price and trimmed notes when given, and no cash or reference fields", () => {
    const payload = buildPaymentPayload(
      tradeInValues({
        trade_in_buying_price: "39999.9",
        trade_in_selling_price: "55000",
        trade_in_notes: "  Screen scratch, battery 89%  ",
        cash_received: "60000",
        reference_number: "AUTH-1",
      }),
    );

    expect(payload).toEqual({
      payment_method: "TRADE_IN",
      amount: 39999.9,
      trade_in_product_id: "p-used-ip12",
      trade_in_imei: "354789102345678",
      trade_in_buying_price: 39999.9,
      trade_in_selling_price: 55000,
      trade_in_notes: "Screen scratch, battery 89%",
    });
  });

  it("sends no trade-in fields for the other methods", () => {
    const values = { ...paymentFormDefaults("1500.00"), trade_in_imei: "354789102345678" };

    expect(buildPaymentPayload({ ...values, cash_received: "2000" })).toEqual({
      payment_method: "CASH",
      amount: 1500,
      cash_received: 2000,
    });
    expect(
      buildPaymentPayload({ ...values, payment_method: "CARD", reference_number: " AUTH-1 " }),
    ).toEqual({ payment_method: "CARD", amount: 1500, reference_number: "AUTH-1" });
  });
});
