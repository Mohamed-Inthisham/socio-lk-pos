import {
  PIN_MISMATCH_MESSAGE,
  approvalPinDefaults,
  approvalPinSchema,
  buildApprovalPinPayload,
} from "./approvalPinSchema";
import { WEAK_PIN_MESSAGE } from "../utils/pin";

const valid = { current_password: "secret-pass", pin: "482915", confirm_pin: "482915" };

const issues = (values) => {
  const result = approvalPinSchema.safeParse(values);
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [i.path[0], i.message]));
};

describe("approvalPinSchema (P6-18)", () => {
  it("accepts a password, a 6-digit PIN and the same PIN again", () => {
    expect(issues(valid)).toEqual({});
  });

  it("needs the current password, at most 72 characters", () => {
    expect(issues({ ...valid, current_password: "" })).toEqual({ current_password: "Enter your current password" });
    expect(issues({ ...valid, current_password: "x".repeat(72) })).toEqual({});
    expect(issues({ ...valid, current_password: "x".repeat(73) })).toEqual({ current_password: "That password is too long" });
  });

  it.each(["", "48291", "4829150", "48a915"])("needs exactly 6 digits (%j)", (pin) => {
    expect(issues({ ...valid, pin, confirm_pin: pin })).toHaveProperty("pin", "The PIN must be 6 digits");
  });

  it.each(["123456", "000000", "654321"])("refuses the weak PIN %s with the backend's message", (pin) => {
    expect(issues({ ...valid, pin, confirm_pin: pin })).toEqual({ pin: WEAK_PIN_MESSAGE });
  });

  it("needs the confirmation to match", () => {
    expect(issues({ ...valid, confirm_pin: "482916" })).toEqual({ confirm_pin: PIN_MISMATCH_MESSAGE });
    expect(issues({ ...valid, confirm_pin: "" })).toHaveProperty("confirm_pin", "Enter the PIN again");
  });

  it("starts empty", () => {
    expect(approvalPinDefaults).toEqual({ current_password: "", pin: "", confirm_pin: "" });
  });

  it("sends the password and the PIN only, never the confirmation", () => {
    expect(buildApprovalPinPayload(valid)).toEqual({ current_password: "secret-pass", pin: "482915" });
  });
});
