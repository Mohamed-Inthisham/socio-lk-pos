/**
 * Sri Lankan phone helpers.
 *
 * normalizeSlPhone mirrors backend/src/common/utils/sl-phone.ts so the
 * customer form rejects exactly what the API would: 0771234567,
 * +94771234567 and 94771234567 (spaces, dashes and brackets ignored)
 * normalize to 0XXXXXXXXX; anything else is null.
 */
export const normalizeSlPhone = (input) => {
  if (input === null || input === undefined) return null;
  const stripped = String(input).replace(/[\s\-()]/g, "");
  if (!stripped) return null;

  let candidate = stripped;
  if (stripped.startsWith("+94")) {
    candidate = "0" + stripped.slice(3);
  } else if (stripped.startsWith("94") && stripped.length === 11) {
    candidate = "0" + stripped.slice(2);
  }
  return /^0[1-9]\d{8}$/.test(candidate) ? candidate : null;
};

/** "0771234567" → "077 123 4567". Unrecognized input is returned as-is. */
export const formatSlPhone = (phone) => {
  const normalized = normalizeSlPhone(phone);
  if (!normalized) return phone ?? "";
  return `${normalized.slice(0, 3)} ${normalized.slice(3, 6)} ${normalized.slice(6)}`;
};
