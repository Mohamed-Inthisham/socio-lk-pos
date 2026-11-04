/**
 * Product unit statuses, as shown to staff. The values are the backend's
 * (ProductUnitStatus); only the wording is ours.
 *
 * RETURNED is a reversed trade-in, the phone back with its customer. A
 * customer's return is INSPECTION.
 */
export const UNIT_STATUS_LABELS = {
  IN_STOCK: "In stock",
  SOLD: "Sold",
  INSPECTION: "Inspection",
  RETURNED: "Back with customer",
  WRITTEN_OFF: "Written off",
};

/** For a status filter: every status, after All statuses. */
export const UNIT_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...Object.entries(UNIT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
];
