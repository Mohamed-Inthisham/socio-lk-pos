/**
 * The approval PIN's shape and weak-PIN rule (planning doc P6-15), copied
 * from the backend's backend/src/approvals/weak-pin.ts so the dialog can
 * refuse a weak PIN before sending it. The server stays authoritative.
 *
 * A PIN is exactly 6 digits. With the digits d1…d6, it is weak when every
 * step d(i+1) − d(i), for i = 1…5, is the same value and that value is 0,
 * +1 or −1: all one digit (000000 … 999999), ascending runs (012345 …
 * 456789) and descending runs (543210 … 987654). No wrap-around: 890123
 * is allowed. That is 20 rejected PINs.
 */
export const PIN_PATTERN = /^\d{6}$/;

/** The backend's own message for a weak PIN (approvals.service.ts setOwnPin). */
export const WEAK_PIN_MESSAGE =
  "That PIN is too easy to guess: avoid one repeated digit and straight runs like 123456 or 654321.";

export const isWeakPin = (pin) => {
  if (!PIN_PATTERN.test(pin)) return false;
  const digits = [...pin].map(Number);
  const step = digits[1] - digits[0];
  if (step < -1 || step > 1) return false;
  return digits.every((d, i) => i === 0 || d - digits[i - 1] === step);
};

// Code points of "0" in the digit sets a till's keyboard or input method
// may send; each set runs 0–9 from there. The backend takes ASCII only.
const DIGIT_ZEROS = [
  0x0030, // ASCII
  0xff10, // full-width (East Asian input methods)
  0x0de6, // Sinhala Lith
  0x0be6, // Tamil
  0x0966, // Devanagari
  0x0660, // Arabic-Indic
  0x06f0, // Extended Arabic-Indic (Persian, Urdu)
];

/** One character → its ASCII digit, or null if it isn't a digit in any of the sets above. */
const asciiDigit = (ch) => {
  const cp = ch.codePointAt(0);
  const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
  return zero === undefined ? null : String(cp - zero);
};

/**
 * What a PIN field keeps of what was typed or pasted: digits only (other
 * scripts' digits converted to 0–9), at most 6. `dropped` is true when
 * something that isn't a digit was thrown away, so the field can say
 * "Digits only" instead of silently doing nothing. Digits past the 6th are
 * cut without a hint (maxLength stops typing there anyway).
 *
 * @returns {{ value: string, dropped: boolean }}
 */
export const filterPinInput = (input) => {
  let value = "";
  let dropped = false;
  for (const ch of String(input ?? "")) {
    const digit = asciiDigit(ch);
    if (digit === null) dropped = true;
    else value += digit;
  }
  return { value: value.slice(0, 6), dropped };
};

/** The digits a PIN field keeps (see filterPinInput). */
export const pinDigits = (input) => filterPinInput(input).value;
