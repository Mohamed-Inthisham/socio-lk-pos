/**
 * Sri Lankan National Identity Card numbers.
 *
 * Accepts the two issued formats:
 *   901234567V     (old: 9 digits + V or X)
 *   199012345678   (new, from 2016: 12 digits)
 *
 * Normalized form: trimmed and uppercase, so "901234567v" and
 * "901234567V" are the same NIC (uniqueness checks rely on that).
 * Nothing else is rewritten: an old-format NIC is not converted to its
 * 12-digit form.
 *
 * Used for staff accounts (users). Customers keep a looser 5–20 character
 * check (see CreateCustomerDto) for foreign and temporary IDs.
 */
export const SL_NIC_PATTERN = /^(\d{9}[VX]|\d{12})$/;

export const SL_NIC_MESSAGE =
  'NIC must be 9 digits followed by V or X (e.g. 901234567V) or 12 digits (e.g. 199012345678)';

/** Trimmed and uppercase; anything that isn't a string is left as it is. */
export function normalizeSlNic(input: unknown): unknown {
  return typeof input === 'string' ? input.trim().toUpperCase() : input;
}

export function isValidSlNic(input: string | null | undefined): boolean {
  if (typeof input !== 'string') return false;
  return SL_NIC_PATTERN.test(normalizeSlNic(input) as string);
}
