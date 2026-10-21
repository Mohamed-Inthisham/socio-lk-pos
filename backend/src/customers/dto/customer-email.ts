/**
 * Normalize a customer email (create and update DTOs): trim and lowercase;
 * an empty string becomes null (no email). Non-strings pass through so the
 * validators can reject them.
 */
export const normalizeCustomerEmail = ({
  value,
}: {
  value: unknown;
}): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.toLowerCase();
};

/** RFC 5321's limit on an address (also the column length). */
export const CUSTOMER_EMAIL_MAX_LENGTH = 254;
