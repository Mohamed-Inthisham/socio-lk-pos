import { z } from "zod";
import { PASSWORD_MISMATCH_MESSAGE, newPasswordField } from "./passwordSchema";

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
};

/** Validated values → POST /users body. */
export const buildCreateUserPayload = (values) => ({
  full_name: values.full_name,
  email: values.email,
  password: values.password,
  role: values.role,
  ...(needsBranch(values.role) && { branch_id: values.branch_id }),
});

/** UserFormDialog, edit mode: name and email only. */
export const editUserSchema = z.object({ full_name: fullNameField, email: emailField });

/** Validated values → PATCH /users/:id body: only what changed. */
export const buildEditUserPayload = (values, user) => {
  const payload = {};
  if (values.full_name !== user.full_name) payload.full_name = values.full_name;
  if (values.email.toLowerCase() !== user.email) payload.email = values.email;
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
