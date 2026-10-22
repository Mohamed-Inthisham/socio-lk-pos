import {
  OTHER,
  VOID_REASONS,
  VOID_REASON_MAX,
  buildVoidPayload,
  buildVoidReason,
  voidFormDefaults,
  voidSchema,
} from "./voidSchema";

const valid = {
  reason_preset: "WRONG_PRICE",
  reason_detail: "",
  approver_id: "user-9",
  pin: "482915",
};

const issues = (values) => {
  const result = voidSchema.safeParse(values);
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [i.path[0], i.message]));
};

describe("VOID_REASONS (P6-9)", () => {
  it("lists the six presets in order, keys 1–6", () => {
    expect(VOID_REASONS.map((r) => [r.key, r.label])).toEqual([
      ["1", "Customer returned the items"],
      ["2", "Wrong item rung up"],
      ["3", "Wrong price"],
      ["4", "Duplicate sale"],
      ["5", "Payment failed"],
      ["6", "Other"],
    ]);
  });
});

describe("buildVoidReason", () => {
  it("sends the preset alone without a detail", () => {
    expect(buildVoidReason({ reason_preset: "WRONG_PRICE", reason_detail: "  " })).toBe("Wrong price");
  });

  it("joins a preset and its detail with a dash", () => {
    expect(buildVoidReason({ reason_preset: "WRONG_PRICE", reason_detail: " rang 1500, was 1200 " })).toBe(
      "Wrong price — rang 1500, was 1200",
    );
  });

  it("sends the detail alone for Other", () => {
    expect(buildVoidReason({ reason_preset: OTHER, reason_detail: " Test sale " })).toBe("Test sale");
  });
});

describe("voidSchema", () => {
  it("accepts a preset, an approver and a 6-digit PIN", () => {
    expect(issues(valid)).toEqual({});
  });

  it("needs a reason", () => {
    expect(issues({ ...valid, reason_preset: "" })).toEqual({ reason_preset: "Pick a reason" });
  });

  it("needs a detail of at least 3 characters for Other", () => {
    const message = "Say what happened (at least 3 characters)";
    expect(issues({ ...valid, reason_preset: OTHER, reason_detail: "" })).toEqual({ reason_detail: message });
    expect(issues({ ...valid, reason_preset: OTHER, reason_detail: "  ab  " })).toEqual({ reason_detail: message });
    expect(issues({ ...valid, reason_preset: OTHER, reason_detail: "abc" })).toEqual({});
  });

  it("allows exactly 500 characters in the sent reason, not 501", () => {
    const prefix = "Wrong price — ";
    const fits = "x".repeat(VOID_REASON_MAX - prefix.length);
    expect(VOID_REASON_MAX).toBe(500);
    expect(buildVoidReason({ ...valid, reason_detail: fits })).toHaveLength(500);
    expect(issues({ ...valid, reason_detail: fits })).toEqual({});
    expect(issues({ ...valid, reason_detail: `${fits}x` })).toEqual({
      reason_detail: "The reason must be 500 characters or fewer (now 501)",
    });
  });

  it("counts Other's detail alone against the 500", () => {
    expect(issues({ ...valid, reason_preset: OTHER, reason_detail: "y".repeat(500) })).toEqual({});
    expect(issues({ ...valid, reason_preset: OTHER, reason_detail: "y".repeat(501) })).toHaveProperty(
      "reason_detail",
    );
  });

  it("needs an approver", () => {
    expect(issues({ ...valid, approver_id: "" })).toEqual({ approver_id: "Pick who approves" });
  });

  it.each(["", "12345", "1234567", "12345a", " 482915", "４８２９１５"])("refuses the PIN %j", (pin) => {
    expect(issues({ ...valid, pin })).toEqual({ pin: "PIN must be 6 digits" });
  });

  it("doesn't apply the weak-PIN rule (that's for setting a PIN)", () => {
    expect(issues({ ...valid, pin: "123456" })).toEqual({});
  });
});

describe("voidFormDefaults", () => {
  it("starts with no reason, no PIN and no approver (a cashier's session)", () => {
    expect(voidFormDefaults()).toEqual({ reason_preset: "", reason_detail: "", approver_id: "", pin: "" });
  });

  it("preselects the session's manager or admin when given", () => {
    expect(voidFormDefaults({ approverId: "user-9" })).toMatchObject({ approver_id: "user-9", pin: "" });
  });
});

describe("buildVoidPayload", () => {
  it("builds the POST /sales/:id/void body", () => {
    expect(buildVoidPayload({ ...valid, reason_detail: "rang 1500" })).toEqual({
      void_reason: "Wrong price — rang 1500",
      approval: { approver_id: "user-9", pin: "482915" },
    });
  });
});
