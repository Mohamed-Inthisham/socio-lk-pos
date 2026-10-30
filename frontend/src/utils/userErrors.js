/**
 * User errors (Task 2.4)
 *
 * Turns a failed /users or /auth/me/password request into
 * { message, field, code, status } for the Users page dialogs and
 * ChangePasswordDialog:
 * - message: what to show; the server's own wording where it is already
 *   clear (validation, inactive branch), plain words for coded refusals
 * - field: the form field the message belongs under, or null for the
 *   dialog's alert
 * - code: the server's `code`, when it sent one
 * - status: HTTP status, or null when no response arrived
 *
 * Only the response's status, code and message are read: the axios error
 * also carries the request body (passwords), so it is never kept, logged
 * or shown.
 */

export const SIGN_IN_AGAIN_MESSAGE =
  "Your password was changed successfully. Please sign in again with your new password.";

const CODE_MESSAGES = {
  CANNOT_CHANGE_OWN_ROLE: ["You can't change your own role. Ask another admin to do it.", null],
  LAST_ACTIVE_ADMIN: [
    "This is the last active admin. Make another user an admin first, so the shop always has one.",
    null,
  ],
  CANNOT_DEACTIVATE_SELF: ["You can't deactivate your own account.", null],
  CANNOT_RESET_OWN_PASSWORD: ["To change your own password, use Change password in your user menu.", null],
  WRONG_PASSWORD: ["Your current password is incorrect.", "current_password"],
  SAME_PASSWORD: ["Choose a password different from your current one.", "new_password"],
  PASSWORD_CHANGED_SIGN_IN_AGAIN: [SIGN_IN_AGAIN_MESSAGE, null],
};

const firstMessage = (data) => (Array.isArray(data?.message) ? data.message[0] : data?.message);

/** Which form field a plain 400 message is about. */
const fieldOf = (message) => {
  if (/branch/i.test(message)) return "branch_id";
  if (/password/i.test(message)) return "password";
  if (/email/i.test(message)) return "email";
  if (/full_name|name/i.test(message)) return "full_name";
  if (/role/i.test(message)) return "role";
  return null;
};

/**
 * @param {unknown} error - an axios error
 * @param {string} fallback - shown when nothing more useful arrived
 *   (no response, 5xx)
 */
export const userErrorOf = (error, fallback) => {
  const status = error?.response?.status ?? null;
  const data = error?.response?.data;
  const code = typeof data?.code === "string" ? data.code : null;
  const message = firstMessage(data);
  const result = (text, field = null) => ({ message: text, field, code, status });

  if (code && CODE_MESSAGES[code]) return result(...CODE_MESSAGES[code]);
  if (status === 409) return result("That email is already registered to another user.", "email");
  if (status === 404) return result("This user no longer exists. Close this and the list will refresh.");
  if (status === 403) return result("Only admins can manage users.");
  if (status === 400 && typeof message === "string") {
    // "Branch <uuid> does not exist": no id on screen.
    if (/^Branch .* does not exist$/.test(message)) {
      return result("That branch no longer exists. Choose another branch.", "branch_id");
    }
    return result(message, fieldOf(message));
  }
  return result(fallback);
};
