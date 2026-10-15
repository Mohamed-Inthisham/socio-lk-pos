import { useSelector } from "react-redux";
import { Loader2 } from "lucide-react";
import { formatLKR } from "../../../utils/money";
import {
  selectCartSyncing,
  selectDraftSale,
} from "../../../store/slices/posTerminalSlice";

/**
 * TotalsPanel Component
 *
 * Sale-level money, read straight from the hydrated sale — never
 * recomputed client-side. Server formulas (SalesService):
 *   subtotal       = Σ unit_price × quantity        (gross)
 *   discount_total = Σ line discount_amount
 *   total          = subtotal − discount_total + tax_total
 *
 * Discount is always 0 in P1 (line discounts arrive with P2, see
 * FOLLOWUPS); the row stays so the layout doesn't shift later. Tax is
 * shown only when non-zero (no tax in R1).
 *
 * While a line mutation is in flight the server totals are about to
 * change, so the panel dims and says "Updating…" instead of showing a
 * figure that looks final.
 */

const isZero = (value) => !Number(value);

const Row = ({ label, value, testId }) => (
  <div className="flex items-baseline justify-between gap-4 text-sm">
    <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
    <dd data-testid={testId} className="tabular-nums text-slate-700 dark:text-slate-200">
      {value}
    </dd>
  </div>
);

const TotalsPanel = () => {
  const sale = useSelector(selectDraftSale);
  const syncing = useSelector(selectCartSyncing);

  if (!sale) return null;

  return (
    <section
      aria-label="Sale totals"
      aria-busy={syncing}
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Totals
        </h2>
        {syncing && (
          <span className="inline-flex items-center gap-1.5 text-xs text-cyan-700 dark:text-cyan-400">
            <Loader2 size={12} aria-hidden="true" className="animate-spin" />
            Updating…
          </span>
        )}
      </div>

      <dl className={`space-y-1.5 transition-opacity ${syncing ? "opacity-50" : ""}`}>
        <Row label="Subtotal" value={formatLKR(sale.subtotal)} testId="totals-subtotal" />
        <Row
          label="Discount"
          value={`−${formatLKR(sale.discount_total ?? 0)}`}
          testId="totals-discount"
        />
        {!isZero(sale.tax_total) && (
          <Row label="Tax" value={formatLKR(sale.tax_total)} testId="totals-tax" />
        )}
        <div className="flex items-baseline justify-between gap-4 pt-3 mt-2 border-t border-slate-200 dark:border-slate-800">
          <dt className="text-base font-semibold text-slate-900 dark:text-slate-100">Total</dt>
          <dd
            data-testid="totals-total"
            className="text-3xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-white"
          >
            {formatLKR(sale.total)}
          </dd>
        </div>
      </dl>
    </section>
  );
};

export default TotalsPanel;
