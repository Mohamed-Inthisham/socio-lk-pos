import { warrantyLabel } from "../../../constants/warranty";
import { CHECKING_ONLY_TEXT } from "../../../constants/receipt";
import {
  receiptAmount,
  receiptDate,
  receiptDiscountLabel,
  warrantyExpired,
} from "../../../utils/receipt";

/**
 * SaleDetailLines Component
 *
 * A completed or voided sale's lines on the detail page (P6-6), in
 * line_number order as GET /sales/:id returns them. Per line: name and
 * line total; qty × price and the discount (the receipt's labels, P5-20);
 * IMEI and the warranty with its last day and an "Expired" tag once it
 * has passed. "No warranty" is shown here (muted) though the receipt
 * prints nothing for it (P5-19). A line with units returned (P7-18) says
 * "Returned 1 of 2", or "Returned" (and is muted) once all came back; its
 * prices stay as sold.
 *
 * PROPS:
 * - lines: sale.lines
 * - today: "YYYY-MM-DD" in Colombo, for the Expired tag
 */

const Warranty = ({ line, today }) => {
  if (!line.warranty || line.warranty === "NO_WARRANTY") {
    return <span className="text-slate-400 dark:text-slate-500">No warranty</span>;
  }
  if (line.warranty === "CHECKING") return <span>{CHECKING_ONLY_TEXT}</span>;
  const expired = warrantyExpired(line, today);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>
        {warrantyLabel(line.warranty)}
        {line.warranty_until && ` · until ${receiptDate(line.warranty_until)}`}
      </span>
      {expired && (
        <span className="px-1.5 py-px rounded text-[10px] font-semibold uppercase tracking-wider bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
          Expired
        </span>
      )}
    </span>
  );
};

const SaleDetailLines = ({ lines, today }) => (
  <ul aria-label="Items" className="divide-y divide-slate-100 dark:divide-slate-800">
    {lines.map((line) => {
      const discounted = Number(line.discount_amount) > 0;
      const returned = line.returned_quantity ?? 0;
      const allBack = returned > 0 && returned >= line.quantity;
      return (
        <li
          key={line.id}
          aria-label={line.product_name_snapshot}
          className={`px-4 py-2.5 ${allBack ? "text-slate-500 dark:text-slate-400" : ""}`}
          data-testid="detail-line"
        >
          <div className="flex items-start justify-between gap-3">
            {/* Wraps on a phone (the page scrolls); one line in the two-column layout. */}
            <p
              className={`min-w-0 wrap-break-word lg:truncate font-medium ${allBack ? "" : "text-slate-900 dark:text-slate-100"}`}
              title={line.product_name_snapshot}
            >
              {line.product_name_snapshot}
            </p>
            <p className="shrink-0 font-semibold tabular-nums">{receiptAmount(line.line_total)}</p>
          </div>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 tabular-nums flex flex-wrap items-center gap-x-2">
            <span>
              {line.quantity} × {receiptAmount(line.unit_price)}
              {discounted && (
                <span className="text-emerald-700 dark:text-emerald-400">
                  {" · "}
                  {receiptDiscountLabel(line)} −{receiptAmount(line.discount_amount)}
                </span>
              )}
            </span>
            {/* On the qty row, so a returned line stays its usual height */}
            {returned > 0 && (
              <span
                data-testid="detail-line-returned"
                className={`px-1.5 py-px rounded text-[10px] font-semibold uppercase tracking-wider ${allBack ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"}`}
              >
                {allBack ? "Returned" : `Returned ${returned} of ${line.quantity}`}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-2">
            {line.imei_snapshot && (
              <span className="font-mono tracking-tight">IMEI {line.imei_snapshot}</span>
            )}
            <Warranty line={line} today={today} />
          </p>
        </li>
      );
    })}
  </ul>
);

export default SaleDetailLines;
