/**
 * IMEI helpers.
 *
 * A real IMEI is 15 digits whose last digit is a Luhn check digit. The
 * backend only enforces 8–50 letters/digits, so a failed check is a soft
 * hint at the till ("rescan?"), never a block (planning doc P4-7).
 */

/** Luhn check over a string of digits. */
export const passesLuhn = (digits) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};

/** True for a 15-digit value whose check digit is wrong (a likely misscan). */
export const imeiCheckDigitMismatch = (value) => {
  const imei = String(value ?? "").trim();
  return /^\d{15}$/.test(imei) && !passesLuhn(imei);
};
