import { BadRequestException } from '@nestjs/common';

/**
 * bcrypt only uses the first 72 bytes of its input and silently ignores the
 * rest, so a new password longer than that must be refused, never hashed
 * (or truncated). Checking an existing password (login, the approval-PIN
 * current password) is not limited: it truncates exactly as the hash did.
 */
export const BCRYPT_MAX_INPUT_BYTES = 72;

export const PASSWORD_TOO_LONG_MESSAGE =
  'Password cannot exceed 72 bytes (letters outside English can take 2–4 bytes each)';

/**
 * Refuse a new password bcrypt would truncate. Call right before
 * `bcrypt.hash` on any path that sets a password, DTO-validated or not.
 * The message never includes the password.
 */
export function assertBcryptPasswordLength(password: string): void {
  if (Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_INPUT_BYTES) {
    throw new BadRequestException(PASSWORD_TOO_LONG_MESSAGE);
  }
}
