import { z } from "zod";
import { PASSWORD_MISMATCH_MESSAGE, newPasswordField } from "./passwordSchema";
import { normalizeSlPhone } from "../utils/phone";

/**
 * User Schemas (Zod)
 *
 * Client-side validation for the Users page dialogs (Task 2.4). Mirrors
 * the backend's CreateUserDto, UpdateUserDto and ChangeRoleDto:
 * - full_name: 2 – 100 characters (trimmed)
 * - email: a valid address, at most 255 characters (lower-cased by the
 *   server)
 * - password: see passwordSchema (8 characters, 72 UTF-8 bytes)
 * - role: admin | manager | cashier
 * - branch_id: an admin has none; a manager or cashier needs one (the
 *   server also checks it is active)
 * - phone, nic, address (Task 2.5): required for a new user. A Sri Lankan
 *   number (sent as 0XXXXXXXXX); an NIC of 9 digits + V/X or 12 digits
 *   (sent uppercase); an address of at most 500 characters. On edit each
 *   is required only once the user has one: the server never clears
 *   them, and users added before them may have none.
 *
 * Builders turn validated values into request bodies: an admin never
 * gets a branch_id, and the confirmation is never sent.
 */

export const USER_ROLES = ["admin", "manager", "cashier"];
export const BRANCH_REQUIRED_MESSAGE = "Managers and cashiers need a branch";

/** Roles that work at one branch. */
export const needsBranch = (role) => role === "manager" || role === "cashier";

const fullNameField = z
  .string()
  .trim()
  .min(2, "Enter the full name (at least 2 characters)")
  .max(100, "The name must be 100 characters or fewer");

const emailField = z
  .string()
  .trim()
  .min(1, "Enter an email address")
  .max(255, "The email must be 255 characters or fewer")
  // Only once something is typed: an empty field has its own message.
  .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address");

const roleField = z.enum(USER_ROLES, { message: "Choose a role" });

export const PHONE_MESSAGE = "Enter a Sri Lankan number, e.g. 0771234567 or +94771234567";
export const NIC_MESSAGE = "Enter 9 digits and V or X (e.g. 901234567V), or 12 digits";
export const ADDRESS_MAX_LENGTH = 500;
const NIC_PATTERN = /^(\d{9}[VX]|\d{12})$/;

// The format checks pass an empty value; `required` adds its own message.
const phoneFormat = z.string().trim().refine((v) => v === "" || normalizeSlPhone(v) !== null, PHONE_MESSAGE);
const nicFormat = z.string().trim().toUpperCase().refine((v) => v === "" || NIC_PATTERN.test(v), NIC_MESSAGE);
const addressFormat = z.string().trim().max(ADDRESS_MAX_LENGTH, `The address must be ${ADDRESS_MAX_LENGTH} characters or fewer`);
const required = (field, message) => field.refine((v) => v !== "", message);

const CONTACT_REQUIRED = {
  phone: "Enter a contact number",
  nic: "Enter the NIC",
  address: "Enter the address",
};
const CONTACT_FORMATS = { phone: phoneFormat, nic: nicFormat, address: addressFormat };

const branchRequired = (v) => !needsBranch(v.role) || !!v.branch_id;
const branchIssue = { path: ["branch_id"], message: BRANCH_REQUIRED_MESSAGE };

/** UserFormDialog, create mode. */
export const createUserSchema = z
  .object({
    full_name: fullNameField,
    email: emailField,
    password: newPasswordField,
    confirm_password: z.string().min(1, "Enter the password again"),
    role: roleField,
    branch_id: z.string(),
    phone: required(phoneFormat, CONTACT_REQUIRED.phone),
    nic: required(nicFormat, CONTACT_REQUIRED.nic),
    address: required(addressFormat, CONTACT_REQUIRED.address),
  })
  .refine((v) => v.confirm_password === "" || v.confirm_password === v.password, {
    path: ["confirm_password"],
    message: PASSWORD_MISMATCH_MESSAGE,
  })
  .refine(branchRequired, branchIssue);

export const createUserDefaults = {
  full_name: "",
  email: "",
  password: "",
  confirm_password: "",
  role: "cashier",
  branch_id: "",
  phone: "",
  nic: "",
  address: "",
};

/** Validated values → POST /users body. */
export const buildCreateUserPayload = (values) => ({
  full_name: values.full_name,
  email: values.email,
  password: values.password,
  role: values.role,
  ...(needsBranch(values.role) && { branch_id: values.branch_id }),
  phone: normalizeSlPhone(values.phone),
  nic: values.nic.toUpperCase(),
  address: values.address,
});

/**
 * UserFormDialog, edit mode: name, email and contact details. A contact
 * field the user already has can't be emptied; one they don't have yet
 * may stay empty.
 */
export const editUserSchemaFor = (user) =>
  z.object({
    full_name: fullNameField,
    email: emailField,
    ...Object.fromEntries(Object.entries(CONTACT_FORMATS).map(([name, format]) => [
      name,
      user[name] ? required(format, CONTACT_REQUIRED[name]) : format,
    ])),
  });

/** The edit form's starting values for a user. */
export const editUserDefaults = (user) => ({
  full_name: user.full_name,
  email: user.email,
  phone: user.phone ?? "",
  nic: user.nic ?? "",
  address: user.address ?? "",
});

/** Validated values → PATCH /users/:id body: only what changed, never an empty value. */
export const buildEditUserPayload = (values, user) => {
  const payload = {};
  if (values.full_name !== user.full_name) payload.full_name = values.full_name;
  if (values.email.toLowerCase() !== user.email) payload.email = values.email;
  const phone = normalizeSlPhone(values.phone);
  if (phone && phone !== user.phone) payload.phone = phone;
  const nic = (values.nic ?? "").toUpperCase();
  if (nic && nic !== user.nic) payload.nic = nic;
  if (values.address && values.address !== user.address) payload.address = values.address;
  return payload;
};

/** ChangeRoleDialog. */
export const changeRoleSchema = z
  .object({ role: roleField, branch_id: z.string() })
  .refine(branchRequired, branchIssue);

/** Validated values → PATCH /users/:id/role body. */
export const buildChangeRolePayload = (values) =>
  needsBranch(values.role) ? { role: values.role, branch_id: values.branch_id } : { role: values.role };

/** Would this role/branch pair change anything for the user? */
export const isRoleChange = (values, user) =>
  values.role !== user.role || (needsBranch(values.role) && values.branch_id !== (user.branch_id ?? ""));
