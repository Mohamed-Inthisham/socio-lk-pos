/**
 * SaleStatusBadge Component
 *
 * A sale's status as one badge (planning doc P6-5, P7-18): Completed
 * (green), Part returned (amber), Returned (slate) or Voided (red). Recent
 * sales shows exactly one per row (utils/returnMath saleListStatus); the detail header
 * shows Completed or Voided, and next to it the return state when there
 * is one.
 *
 * PROPS:
 * - state: "COMPLETED" | "PARTIAL" | "FULL" | "VOIDED"; anything else
 *   (e.g. a return state of NONE) renders nothing
 */

const LOOK = {
  COMPLETED: {
    label: "Completed",
    className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  PARTIAL: {
    label: "Part returned",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  FULL: {
    label: "Returned",
    className: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  },
  VOIDED: {
    label: "Voided",
    className: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  },
};

const SaleStatusBadge = ({ state }) => {
  const look = LOOK[state];
  if (!look) return null;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap ${look.className}`}
    >
      {look.label}
    </span>
  );
};

export default SaleStatusBadge;
