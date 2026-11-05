/**
 * A product's stock status, as shown to staff. The values are the backend's
 * (StockStatus); only the wording is ours.
 *
 * NOT_TRACKED has no quantity at all: it never means zero.
 */
export const STOCK_STATUS_LABELS = {
  IN_STOCK: "In stock",
  LOW_STOCK: "Low stock",
  OUT_OF_STOCK: "Out of stock",
  NOT_TRACKED: "Not tracked",
};

/** For a status filter: every status, after All statuses. */
export const STOCK_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...Object.entries(STOCK_STATUS_LABELS).map(([value, label]) => ({ value, label })),
];
