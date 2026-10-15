/**
 * Money helpers. The backend sends money as numeric strings ("60000.00");
 * format for display only — never recompute totals client-side.
 */

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
