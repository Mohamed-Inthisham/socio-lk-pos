import { z } from "zod";

/**
 * Password Schemas (Zod)
 *
 * Client-side validation for the admin's ResetPasswordDialog and the
 * user's own ChangePasswordDialog (Task 2.4). Mirrors the backend's
 * ResetPasswordDto / ChangePasswordDto:
 * - a new password: at least 8 characters and at most 72 BYTES in UTF-8
 *   (bcrypt ignores anything beyond, so the server refuses it). A Sinhala
 *   or Tamil letter takes 3 bytes, so count bytes, never `value.length`.
 * - current_password: required, at most 72 characters (only compared)
 * - confirm_password: must equal new_password; never sent
 *
 * Passwords live only in the dialog's form while it is open: never in
 * Redux, storage or logs, and never in a message.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_TOO_SHORT_MESSAGE = `Use at least ${PASSWORD_MIN_LENGTH} characters`;
export const PASSWORD_TOO_LONG_MESSAGE =
  "That password is too long (letters outside English take more space; at most 72 bytes)";
export const PASSWORD_MISMATCH_MESSAGE = "The passwords don't match";

const encoder = new TextEncoder();

/** The length the server checks: bytes in UTF-8. */
export const utf8ByteLength = (value) => encoder.encode(value).length;

/** A password being set: 8+ characters, at most 72 UTF-8 bytes. */
export const newPasswordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE)
  .refine((v) => utf8ByteLength(v) <= PASSWORD_MAX_BYTES, PASSWORD_TOO_LONG_MESSAGE);

const confirmField = z.string().min(1, "Enter the password again");

// An empty confirmation has its own message ("Enter the password again").
const confirmMatches = (v) => v.confirm_password === "" || v.confirm_password === v.new_password;
const mismatch = { path: ["confirm_password"], message: PASSWORD_MISMATCH_MESSAGE };

/** ResetPasswordDialog: an admin sets another user's password. */
export const resetPasswordSchema = z
  .object({ new_password: newPasswordField, confirm_password: confirmField })
  .refine(confirmMatches, mismatch);

export const resetPasswordDefaults = { new_password: "", confirm_password: "" };

/** Validated values → POST /users/:id/password body (no confirmation). */
export const buildResetPasswordPayload = (values) => ({ new_password: values.new_password });

/** ChangePasswordDialog: the session user changes their own password. */
export const changePasswordSchema = z
  .object({
    current_password: z
      .string()
      .min(1, "Enter your current password")
      .max(72, "That password is too long"),
    new_password: newPasswordField,
    confirm_password: confirmField,
  })
  .refine(confirmMatches, mismatch)
  // The server also refuses this (400 SAME_PASSWORD); caught here first.
  .refine((v) => v.new_password === "" || v.new_password !== v.current_password, {
    path: ["new_password"],
    message: "Choose a password different from your current one",
  });

export const changePasswordDefaults = { current_password: "", new_password: "", confirm_password: "" };

/** Validated values → PUT /auth/me/password body (no confirmation). */
export const buildChangePasswordPayload = (values) => ({
  current_password: values.current_password,
  new_password: values.new_password,
});
