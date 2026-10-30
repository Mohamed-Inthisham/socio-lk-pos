import {
  BRANCH_REQUIRED_MESSAGE,
  buildChangeRolePayload,
  buildCreateUserPayload,
  buildEditUserPayload,
  changeRoleSchema,
  createUserDefaults,
  createUserSchema,
  editUserSchema,
  isRoleChange,
} from "./userSchema";
import { PASSWORD_MISMATCH_MESSAGE, PASSWORD_TOO_LONG_MESSAGE } from "./passwordSchema";

const issues = (schema, values) => {
  const result = schema.safeParse(values);
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [i.path[0], i.message]));
};

const validCreate = {
  ...createUserDefaults,
  full_name: "Nimal Silva",
  email: "nimal@socio.lk",
  password: "fresh-pass-1",
  confirm_password: "fresh-pass-1",
  branch_id: "b1",
};

describe("createUserSchema", () => {
  it("defaults to a cashier and accepts a complete form", () => {
    expect(createUserDefaults.role).toBe("cashier");
    expect(issues(createUserSchema, validCreate)).toEqual({});
  });

  it("needs every required field", () => {
    expect(issues(createUserSchema, createUserDefaults)).toEqual({
      full_name: "Enter the full name (at least 2 characters)",
      email: "Enter an email address",
      password: "Use at least 8 characters",
      confirm_password: "Enter the password again",
      branch_id: BRANCH_REQUIRED_MESSAGE,
    });
  });

  it("checks the email and the name length", () => {
    expect(issues(createUserSchema, { ...validCreate, email: "not-an-email" })).toEqual({
      email: "Enter a valid email address",
    });
    expect(issues(createUserSchema, { ...validCreate, full_name: " A " })).toHaveProperty("full_name");
    expect(issues(createUserSchema, { ...validCreate, full_name: "x".repeat(101) })).toHaveProperty("full_name");
  });

  it("applies the 72-byte rule and the confirmation", () => {
    const long = "ශ".repeat(25);
    expect(issues(createUserSchema, { ...validCreate, password: long, confirm_password: long })).toEqual({
      password: PASSWORD_TOO_LONG_MESSAGE,
    });
    expect(issues(createUserSchema, { ...validCreate, confirm_password: "other-pass" })).toEqual({
      confirm_password: PASSWORD_MISMATCH_MESSAGE,
    });
  });

  it.each(["manager", "cashier"])("a %s needs a branch", (role) => {
    expect(issues(createUserSchema, { ...validCreate, role, branch_id: "" })).toEqual({
      branch_id: BRANCH_REQUIRED_MESSAGE,
    });
  });

  it("an admin needs no branch, and none is sent", () => {
    expect(issues(createUserSchema, { ...validCreate, role: "admin", branch_id: "" })).toEqual({});
    expect(buildCreateUserPayload({ ...validCreate, role: "admin", branch_id: "b1" })).toEqual({
      full_name: "Nimal Silva",
      email: "nimal@socio.lk",
      password: "fresh-pass-1",
      role: "admin",
    });
  });

  it("sends the branch for staff, trimmed values, and never the confirmation", () => {
    const parsed = createUserSchema.parse({ ...validCreate, full_name: "  Nimal Silva ", email: " nimal@socio.lk " });
    expect(buildCreateUserPayload(parsed)).toEqual({
      full_name: "Nimal Silva",
      email: "nimal@socio.lk",
      password: "fresh-pass-1",
      role: "cashier",
      branch_id: "b1",
    });
  });
});

describe("editUserSchema", () => {
  const user = { id: "u1", full_name: "Nimal Silva", email: "nimal@socio.lk", role: "cashier", branch_id: "b1" };

  it("validates name and email", () => {
    expect(issues(editUserSchema, { full_name: "Nimal", email: "nimal@socio.lk" })).toEqual({});
    expect(issues(editUserSchema, { full_name: "", email: "x" })).toEqual({
      full_name: "Enter the full name (at least 2 characters)",
      email: "Enter a valid email address",
    });
  });

  it("sends only what changed, never role or branch", () => {
    expect(buildEditUserPayload({ full_name: "Nimal S", email: "nimal@socio.lk" }, user)).toEqual({ full_name: "Nimal S" });
    expect(buildEditUserPayload({ full_name: "Nimal Silva", email: "NIMAL@socio.lk" }, user)).toEqual({});
    expect(buildEditUserPayload({ full_name: "Nimal Silva", email: "n2@socio.lk" }, user)).toEqual({ email: "n2@socio.lk" });
  });
});

describe("changeRoleSchema", () => {
  it("an admin needs no branch and sends none", () => {
    expect(issues(changeRoleSchema, { role: "admin", branch_id: "" })).toEqual({});
    expect(buildChangeRolePayload({ role: "admin", branch_id: "b1" })).toEqual({ role: "admin" });
  });

  it.each(["manager", "cashier"])("a %s needs a branch, sent with the role", (role) => {
    expect(issues(changeRoleSchema, { role, branch_id: "" })).toEqual({ branch_id: BRANCH_REQUIRED_MESSAGE });
    expect(buildChangeRolePayload({ role, branch_id: "b2" })).toEqual({ role, branch_id: "b2" });
  });

  it("knows when nothing would change", () => {
    const cashier = { role: "cashier", branch_id: "b1" };
    expect(isRoleChange({ role: "cashier", branch_id: "b1" }, cashier)).toBe(false);
    expect(isRoleChange({ role: "cashier", branch_id: "b2" }, cashier)).toBe(true);
    expect(isRoleChange({ role: "manager", branch_id: "b1" }, cashier)).toBe(true);
    expect(isRoleChange({ role: "admin", branch_id: "" }, { role: "admin", branch_id: null })).toBe(false);
  });
});
