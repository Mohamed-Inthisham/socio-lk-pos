/**
 * Money helpers. The backend sends money as numeric strings ("60000.00");
 * format for display only — never recompute totals client-side.
 *
 * Balance and change arithmetic runs in integer cents (toCents /
 * fromCents): 100.30 - 50.10 is 50.199999… in floats, 5020 in cents.
 */

/**
 * "1234.50" | 1234.5 → 123450. Rounds to the nearest cent. Returns NaN for
 * null, blank or non-numeric input so callers can't mistake it for 0.
 */
export const toCents = (value) => {
  if (value === null || value === undefined) return NaN;
  if (typeof value === "string" && value.trim() === "") return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

/** 123450 → "1234.50" (the backend's string shape). Integer math, no float rounding. */
export const fromCents = (cents) => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
};

const lkr = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "1500.00" → "LKR 1,500.00". Returns "—" for null/blank, the raw value if non-numeric. */
export const formatLKR = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? lkr.format(n) : String(value);
};
