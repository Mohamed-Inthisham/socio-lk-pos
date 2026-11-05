import { UNIT_STATUS_LABELS } from "../../../constants/unitStatus";

/**
 * UnitStatusBadge Component
 *
 * A product unit's status as one badge. The wording is in
 * constants/unitStatus.js; a status it doesn't know shows as sent.
 *
 * PROPS:
 * - status: the unit's status
 */

const STATUS_CLASSES = {
  IN_STOCK: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  SOLD: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  INSPECTION: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  RETURNED: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  WRITTEN_OFF: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
};

const UnitStatusBadge = ({ status }) => (
  <span
    className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status] ?? STATUS_CLASSES.SOLD}`}
  >
    {UNIT_STATUS_LABELS[status] ?? status}
  </span>
);

export default UnitStatusBadge;
