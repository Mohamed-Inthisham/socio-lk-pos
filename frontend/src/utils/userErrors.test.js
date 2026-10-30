import { SIGN_IN_AGAIN_MESSAGE, userErrorOf } from "./userErrors";

const failure = (status, data) => ({
  response: { status, data },
  // What axios also carries: the request, passwords included.
  config: { data: JSON.stringify({ new_password: "secret-new-pass" }) },
});

describe("userErrorOf", () => {
  it.each([
    ["CANNOT_CHANGE_OWN_ROLE", 400, /can't change your own role/, null],
    ["LAST_ACTIVE_ADMIN", 400, /last active admin/, null],
    ["CANNOT_DEACTIVATE_SELF", 400, /can't deactivate your own account/, null],
    ["CANNOT_RESET_OWN_PASSWORD", 400, /Change password in your user menu/, null],
    ["WRONG_PASSWORD", 403, /current password is incorrect/, "current_password"],
    ["SAME_PASSWORD", 400, /different from your current one/, "new_password"],
  ])("maps %s to plain words", (code, status, message, field) => {
    const result = userErrorOf(failure(status, { message: "server words", code }), "fallback");
    expect(result).toMatchObject({ code, status, field });
    expect(result.message).toMatch(message);
  });

  it("maps PASSWORD_CHANGED_SIGN_IN_AGAIN to the sign-in-again message", () => {
    expect(userErrorOf(failure(503, { code: "PASSWORD_CHANGED_SIGN_IN_AGAIN" }), "fallback")).toEqual({
      message: SIGN_IN_AGAIN_MESSAGE,
      field: null,
      code: "PASSWORD_CHANGED_SIGN_IN_AGAIN",
      status: 503,
    });
  });

  it("puts a duplicate email (409) under the email field", () => {
    expect(userErrorOf(failure(409, { message: "Email is already registered" }), "fallback")).toMatchObject({
      field: "email",
      message: "That email is already registered to another user.",
    });
  });

  it("keeps the server's clear 400 messages, under their field", () => {
    expect(userErrorOf(failure(400, { message: 'Branch "Kandy" is not active' }), "f")).toMatchObject({
      message: 'Branch "Kandy" is not active',
      field: "branch_id",
    });
    expect(userErrorOf(failure(400, { message: ["Password must be at least 8 characters"] }), "f")).toMatchObject({
      message: "Password must be at least 8 characters",
      field: "password",
    });
  });

  it("never shows a branch id", () => {
    const result = userErrorOf(failure(400, { message: "Branch 5f0e-uuid does not exist" }), "f");
    expect(result.message).toBe("That branch no longer exists. Choose another branch.");
    expect(result.field).toBe("branch_id");
  });

  it("explains 404 and 403", () => {
    expect(userErrorOf(failure(404, { message: "User not found" }), "f").message).toMatch(/no longer exists/);
    expect(userErrorOf(failure(403, { message: "Forbidden resource" }), "f").message).toBe("Only admins can manage users.");
  });

  it("falls back when no response arrived or on 5xx", () => {
    expect(userErrorOf(new Error("Network Error"), "Couldn't save. Try again.")).toEqual({
      message: "Couldn't save. Try again.",
      field: null,
      code: null,
      status: null,
    });
    expect(userErrorOf(failure(500, { message: "Internal server error" }), "Try again.").message).toBe("Try again.");
  });

  it("never includes the request's passwords", () => {
    const result = userErrorOf(failure(400, { message: "Validation failed" }), "f");
    expect(JSON.stringify(result)).not.toContain("secret-new-pass");
  });
});
