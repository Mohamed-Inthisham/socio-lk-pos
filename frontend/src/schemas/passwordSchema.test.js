import {
  PASSWORD_MISMATCH_MESSAGE,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  buildChangePasswordPayload,
  buildResetPasswordPayload,
  changePasswordSchema,
  resetPasswordSchema,
  utf8ByteLength,
} from "./passwordSchema";

const issues = (schema, values) => {
  const result = schema.safeParse(values);
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [i.path[0], i.message]));
};
const reset = (pw, confirm = pw) => issues(resetPasswordSchema, { new_password: pw, confirm_password: confirm });

// Sinhala "ශ්‍රී ලංකා" letters and Tamil "தமிழ்" letters are 3 bytes each in UTF-8.
const SINHALA = "ශ";
const TAMIL = "த";

describe("utf8ByteLength", () => {
  it("counts bytes, not characters", () => {
    expect(utf8ByteLength("password")).toBe(8);
    expect(utf8ByteLength(SINHALA)).toBe(3);
    expect(utf8ByteLength(TAMIL)).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("😀")).toBe(4);
  });
});

describe("resetPasswordSchema", () => {
  it("accepts a normal English password", () => {
    expect(reset("fresh-pass-123")).toEqual({});
  });

  it("needs at least 8 characters", () => {
    expect(reset("short7!")).toEqual({ new_password: PASSWORD_TOO_SHORT_MESSAGE });
    expect(reset("exactly8")).toEqual({});
  });

  it("accepts exactly 72 bytes and refuses 73", () => {
    expect(reset("x".repeat(72))).toEqual({});
    expect(reset("x".repeat(73))).toEqual({ new_password: PASSWORD_TOO_LONG_MESSAGE });
  });

  it("counts Sinhala letters as 3 bytes: 24 fit, 25 don't, though both are under 72 characters", () => {
    expect(reset(SINHALA.repeat(24))).toEqual({});
    const tooLong = SINHALA.repeat(25);
    expect(tooLong.length).toBeLessThan(72);
    expect(reset(tooLong)).toEqual({ new_password: PASSWORD_TOO_LONG_MESSAGE });
  });

  it("counts Tamil letters as 3 bytes", () => {
    expect(reset(TAMIL.repeat(24))).toEqual({});
    expect(reset(TAMIL.repeat(25))).toEqual({ new_password: PASSWORD_TOO_LONG_MESSAGE });
  });

  it("counts a mixed-language password by its bytes", () => {
    // 60 ASCII bytes + 4 Sinhala/Tamil letters (12 bytes) = 72 bytes.
    const atLimit = "a".repeat(60) + SINHALA + TAMIL + SINHALA + TAMIL;
    expect(utf8ByteLength(atLimit)).toBe(72);
    expect(reset(atLimit)).toEqual({});
    expect(reset(atLimit + "a")).toEqual({ new_password: PASSWORD_TOO_LONG_MESSAGE });
  });

  it("needs the confirmation, and it must match", () => {
    expect(reset("fresh-pass-123", "")).toEqual({ confirm_password: "Enter the password again" });
    expect(reset("fresh-pass-123", "fresh-pass-124")).toEqual({ confirm_password: PASSWORD_MISMATCH_MESSAGE });
  });

  it("sends only new_password", () => {
    expect(buildResetPasswordPayload({ new_password: "fresh-pass-123", confirm_password: "fresh-pass-123" })).toEqual({
      new_password: "fresh-pass-123",
    });
  });
});

describe("changePasswordSchema", () => {
  const valid = { current_password: "old-pass-1", new_password: "new-pass-12", confirm_password: "new-pass-12" };
  const change = (values) => issues(changePasswordSchema, { ...valid, ...values });

  it("accepts the current password and a new, confirmed one", () => {
    expect(change({})).toEqual({});
  });

  it("needs the current password", () => {
    expect(change({ current_password: "" })).toEqual({ current_password: "Enter your current password" });
  });

  it("applies the new-password rules, bytes included", () => {
    expect(change({ new_password: "short", confirm_password: "short" })).toEqual({
      new_password: PASSWORD_TOO_SHORT_MESSAGE,
    });
    const long = SINHALA.repeat(25);
    expect(change({ new_password: long, confirm_password: long })).toEqual({ new_password: PASSWORD_TOO_LONG_MESSAGE });
  });

  it("refuses a mismatched confirmation", () => {
    expect(change({ confirm_password: "new-pass-13" })).toEqual({ confirm_password: PASSWORD_MISMATCH_MESSAGE });
  });

  it("refuses a new password equal to the current one", () => {
    expect(change({ new_password: "old-pass-1", confirm_password: "old-pass-1" })).toEqual({
      new_password: "Choose a password different from your current one",
    });
  });

  it("sends the current and new password, never the confirmation", () => {
    expect(buildChangePasswordPayload(valid)).toEqual({ current_password: "old-pass-1", new_password: "new-pass-12" });
  });
});
