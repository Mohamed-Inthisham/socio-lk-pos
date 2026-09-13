/**
 * Sri Lankan phone number normalization + validation.
 *
 * Accepts:
 *   0771234567         (local format)
 *   +94771234567       (international format)
 *   94771234567        (international without +)
 *   0112345678         (landline)
 *
 * Returns normalized form: 10 digits starting with '0'.
 * Returns null if input doesn't match a valid SL number pattern.
 *
 * Used across Customer intake, PhonePurchase, SMS receipts, etc.
 * Kept in common/ because it's a business-wide concept, not
 * customer-specific.
 */
export function normalizeSlPhone(
  input: string | null | undefined,
): string | null {
  if (input === null || input === undefined) return null;

  // Strip whitespace, dashes, parentheses that humans might type.
  const stripped = input.replace(/[\s\-()]/g, '');
  if (stripped.length === 0) return null;

  let candidate: string;

  if (stripped.startsWith('+94')) {
    // +94771234567 -> 0771234567
    candidate = '0' + stripped.slice(3);
  } else if (stripped.startsWith('94') && stripped.length === 11) {
    // 94771234567 -> 0771234567 (only when length matches, to avoid
    // mangling a local number that happens to start with 94).
    candidate = '0' + stripped.slice(2);
  } else {
    candidate = stripped;
  }

  // Final shape: 10 digits, starts with 0, second digit 1-9.
  // (First digit 0, second digit 0 would be nonsensical for SL numbers.)
  return /^0[1-9]\d{8}$/.test(candidate) ? candidate : null;
}

/**
 * Boolean form for use in class-validator's @IsSlPhone-style checks.
 */
export function isValidSlPhone(input: string | null | undefined): boolean {
  return normalizeSlPhone(input) !== null;
}
