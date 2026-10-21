import {
  buildCreatePayload,
  buildUpdatePayload,
  mapProductToFormValues,
  productCreateSchema,
  productFormDefaults,
} from "./productSchema";

// A valid create form (an accessory, so no phone fields are required).
const form = (overrides = {}) => ({
  ...productFormDefaults,
  name: "USB-C Cable 1m",
  product_type: "ACCESSORY",
  brand_id: "11111111-1111-4111-8111-111111111111",
  category_id: "22222222-2222-4222-8222-222222222222",
  branch_id: "33333333-3333-4333-8333-333333333333",
  buying_price: "500",
  selling_price: "1500",
  ...overrides,
});

describe("productSchema — default warranty (P5-18)", () => {
  it("starts new products on No warranty (P5-19)", () => {
    expect(productFormDefaults.default_warranty).toBe("NO_WARRANTY");
    expect(productFormDefaults).not.toHaveProperty("warranty_months");
    expect(productFormDefaults).not.toHaveProperty("checking_warranty_days");
  });

  it("accepts a listed period", () => {
    const result = productCreateSchema.safeParse(form({ default_warranty: "MONTH_12" }));
    expect(result.success).toBe(true);
    expect(result.data.default_warranty).toBe("MONTH_12");
  });

  it.each([
    ["an unlisted period", "MONTH_5"],
    ["an empty value", ""],
  ])("rejects %s", (_, value) => {
    const result = productCreateSchema.safeParse(form({ default_warranty: value }));
    expect(result.success).toBe(false);
    expect(result.error.issues.find((i) => i.path[0] === "default_warranty")).toBeDefined();
  });

  it("sends the default warranty on create, for phones and accessories alike", () => {
    expect(buildCreatePayload(form({ default_warranty: "WEEK_2" })).default_warranty).toBe("WEEK_2");
    expect(
      buildCreatePayload(form({ product_type: "PHONE", phone_condition: "USED", default_warranty: "MONTH_3" }))
        .default_warranty,
    ).toBe("MONTH_3");
  });

  it("loads a product's default into the edit form, No warranty when missing", () => {
    expect(mapProductToFormValues({ default_warranty: "MONTH_24" }).default_warranty).toBe("MONTH_24");
    expect(mapProductToFormValues({}).default_warranty).toBe("NO_WARRANTY");
  });

  it("sends a changed default on update as the code, never null", () => {
    const payload = buildUpdatePayload(form({ default_warranty: "MONTH_6" }), { default_warranty: true });
    expect(payload).toEqual({ default_warranty: "MONTH_6" });
  });

  it("leaves the default out of the update when it wasn't changed", () => {
    const payload = buildUpdatePayload(form({ name: "Renamed" }), { name: true });
    expect(payload).toEqual({ name: "Renamed" });
  });
});
