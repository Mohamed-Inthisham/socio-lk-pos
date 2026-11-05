import { STOCK_STATUS_LABELS } from "../../../constants/stockStatus";

/**
 * StockStatusBadge Component
 *
 * A product's or a branch's stock status as one badge. The wording is in
 * constants/stockStatus.js; a status it doesn't know shows as sent.
 *
 * PROPS:
 * - status: the stock status
 */

const STATUS_CLASSES = {
  IN_STOCK: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  LOW_STOCK: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  OUT_OF_STOCK: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  NOT_TRACKED: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

const StockStatusBadge = ({ status }) => (
  <span
    className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status] ?? STATUS_CLASSES.NOT_TRACKED}`}
  >
    {STOCK_STATUS_LABELS[status] ?? status}
  </span>
);

export default StockStatusBadge;
