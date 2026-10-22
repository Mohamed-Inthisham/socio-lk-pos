/**
 * The approval PIN's shape and weak-PIN rule (Phase 6.4 P6-15).
 *
 * A PIN is exactly 6 digits. With the digits d1…d6, it is weak when every
 * step d(i+1) − d(i), for i = 1…5, is the same value and that value is 0,
 * +1 or −1: all one digit (000000 … 999999), ascending runs (012345 …
 * 456789) and descending runs (543210 … 987654). No wrap-around: 890123
 * is allowed. That is 20 rejected PINs.
 */
export const PIN_PATTERN = /^\d{6}$/;

export function isWeakPin(pin: string): boolean {
  if (!PIN_PATTERN.test(pin)) return false;
  const digits = [...pin].map(Number);
  const step = digits[1] - digits[0];
  if (step < -1 || step > 1) return false;
  return digits.every((d, i) => i === 0 || d - digits[i - 1] === step);
}
