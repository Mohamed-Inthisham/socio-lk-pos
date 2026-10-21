/**
 * Warranty periods (planning doc P5-18) — the backend's WarrantyPeriod
 * codes, in the order the shop offers them. Used by the product forms
 * (a product's default), the cart (each line's period) and the receipt.
 *
 * CHECKING: the customer checks the item in the shop; there is no
 * warranty once they leave. It also covers items sold without a warranty
 * (cables etc.) — there is no separate "No warranty".
 */
export const WARRANTY_PERIODS = [
  { value: "CHECKING", label: "Checking" },
  { value: "WEEK_1", label: "1 week" },
  { value: "WEEK_2", label: "2 weeks" },
  { value: "MONTH_1", label: "1 month" },
  { value: "MONTH_2", label: "2 months" },
  { value: "MONTH_3", label: "3 months" },
  { value: "MONTH_6", label: "6 months" },
  { value: "MONTH_12", label: "12 months" },
  { value: "MONTH_18", label: "18 months" },
  { value: "MONTH_24", label: "24 months" },
];

export const WARRANTY_CODES = WARRANTY_PERIODS.map((p) => p.value);

export const DEFAULT_WARRANTY = "CHECKING";

/** "12 months" for "MONTH_12"; the code itself if unknown. */
export const warrantyLabel = (code) =>
  WARRANTY_PERIODS.find((p) => p.value === code)?.label ?? code;
