import {
  BRANCH_REQUIRED_MESSAGE,
  buildChangeRolePayload,
  buildCreateUserPayload,
  buildEditUserPayload,
  changeRoleSchema,
  createUserDefaults,
  createUserSchema,
  editUserDefaults,
  editUserSchemaFor,
  isRoleChange,
  NIC_MESSAGE,
  PHONE_MESSAGE,
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
  phone: "0771234567",
  nic: "199012345678",
  address: "12 Temple Road, Kandy",
};
const contact = { phone: "0771234567", nic: "199012345678", address: "12 Temple Road, Kandy" };

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
      phone: "Enter a contact number",
      nic: "Enter the NIC",
      address: "Enter the address",
    });
  });

  it.each([
    ["phone", "12345", PHONE_MESSAGE],
    ["phone", "0071234567", PHONE_MESSAGE],
    ["nic", "90123456V", NIC_MESSAGE],
    ["nic", "199012345678V", NIC_MESSAGE],
    ["nic", "1990 1234 5678", NIC_MESSAGE],
    ["address", "   ", "Enter the address"],
    ["address", "x".repeat(501), "The address must be 500 characters or fewer"],
  ])("refuses %s %j", (field, value, message) => {
    expect(issues(createUserSchema, { ...validCreate, [field]: value })).toEqual({ [field]: message });
  });

  it("sends the contact number as 0XXXXXXXXX and the NIC uppercase, trimmed", () => {
    const parsed = createUserSchema.parse({ ...validCreate, phone: " +94 77 123-4567 ", nic: " 901234567v ", address: "  4 Lake Road " });
    expect(buildCreateUserPayload(parsed)).toMatchObject({ phone: "0771234567", nic: "901234567V", address: "4 Lake Road" });
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
      ...contact,
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
      ...contact,
    });
  });
});

describe("editUserSchemaFor", () => {
  const user = { id: "u1", full_name: "Nimal Silva", email: "nimal@socio.lk", role: "cashier", branch_id: "b1", ...contact };
  // Added before contact details: none yet.
  const older = { ...user, phone: null, nic: null, address: null };

  it("validates name and email", () => {
    const schema = editUserSchemaFor(user);
    expect(issues(schema, editUserDefaults(user))).toEqual({});
    expect(issues(schema, { ...editUserDefaults(user), full_name: "", email: "x" })).toEqual({
      full_name: "Enter the full name (at least 2 characters)",
      email: "Enter a valid email address",
    });
  });

  it("starts from the user's details, empty where they have none", () => {
    expect(editUserDefaults(older)).toEqual({ full_name: "Nimal Silva", email: "nimal@socio.lk", phone: "", nic: "", address: "" });
  });

  it("won't let a contact detail the user has be emptied", () => {
    expect(issues(editUserSchemaFor(user), { ...editUserDefaults(user), phone: "", nic: " ", address: "" })).toEqual({
      phone: "Enter a contact number",
      nic: "Enter the NIC",
      address: "Enter the address",
    });
  });

  it("lets a user added before contact details keep them empty, but checks any typed", () => {
    const schema = editUserSchemaFor(older);
    expect(issues(schema, editUserDefaults(older))).toEqual({});
    expect(issues(schema, { ...editUserDefaults(older), phone: "123", nic: "abc" })).toEqual({
      phone: PHONE_MESSAGE,
      nic: NIC_MESSAGE,
    });
  });

  it("sends changed contact details normalized, and never an empty one", () => {
    expect(buildEditUserPayload({ ...editUserDefaults(user), phone: "+94712345678", nic: "901234567V", address: "4 Lake Road" }, user))
      .toEqual({ phone: "0712345678", nic: "901234567V", address: "4 Lake Road" });
    expect(buildEditUserPayload({ ...editUserDefaults(user), phone: "077 123 4567" }, user)).toEqual({});
    expect(buildEditUserPayload(editUserDefaults(older), older)).toEqual({});
  });

  it("sends only what changed, never role or branch", () => {
    const same = editUserDefaults(user);
    expect(buildEditUserPayload({ ...same, full_name: "Nimal S" }, user)).toEqual({ full_name: "Nimal S" });
    expect(buildEditUserPayload({ ...same, email: "NIMAL@socio.lk" }, user)).toEqual({});
    expect(buildEditUserPayload({ ...same, email: "n2@socio.lk" }, user)).toEqual({ email: "n2@socio.lk" });
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
