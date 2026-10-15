import { useSelector } from "react-redux";
import { CheckCircle2, Loader2 } from "lucide-react";
import Button from "../../common/Button";
import { formatLKR } from "../../../utils/money";
import {
  selectBalanceDue,
  selectCanPay,
  selectCartSyncing,
  selectDraftSale,
  selectPaidTotal,
  selectReadyToComplete,
} from "../../../store/slices/posTerminalSlice";

/**
 * TotalsPanel Component
 *
 * Sale-level money, read straight from the hydrated sale — never
 * recomputed client-side. Server formulas (SalesService):
 *   subtotal       = Σ unit_price × quantity        (gross)
 *   discount_total = Σ line discount_amount
 *   total          = subtotal − discount_total + tax_total
 *   amount_paid    = Σ payment amount
 * Balance due is total − amount_paid, subtracted in integer cents
 * (selectBalanceDue).
 *
 * Discount is always 0 in P1 (line discounts arrive with P2, see
 * FOLLOWUPS); the row stays so the layout doesn't shift later. Tax is
 * shown only when non-zero (no tax in R1).
 *
 * While a line or payment mutation is in flight the server totals are
 * about to change, so the panel dims and says "Updating…" instead of
 * showing a figure that looks final.
 *
 * PAY (P3-6): "Pay LKR X" (X = balance due) opens the PaymentDialog via
 * `onPay`, as F4 does on the terminal. Both use selectCanPay: disabled
 * with an empty cart, nothing left to pay, or a mutation in flight — the
 * button keeps the last known balance and no spinner of its own.
 *
 * READY (P3-7): once the last confirmed server sale is fully paid, the
 * button gives way to a calm "Ready to complete" state (complete arrives
 * with P5). Ready vs Pay never flips mid-mutation: while syncing, the
 * Ready box dims like the totals, and Pay is disabled (its own disabled
 * styling is the same 50% dim).
 *
 * PROPS:
 * - onPay: () => void — open the PaymentDialog
 */

const isZero = (value) => !Number(value);

const Row = ({ label, value, testId, strong = false }) => (
  <div className="flex items-baseline justify-between gap-4 text-sm">
    <dt className={strong ? "font-semibold text-slate-700 dark:text-slate-200" : "text-slate-500 dark:text-slate-400"}>
      {label}
    </dt>
    <dd
      data-testid={testId}
      className={`tabular-nums ${strong ? "font-semibold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-200"}`}
    >
      {value}
    </dd>
  </div>
);

const TotalsPanel = ({ onPay }) => {
  const sale = useSelector(selectDraftSale);
  const syncing = useSelector(selectCartSyncing);
  const paid = useSelector(selectPaidTotal);
  const balance = useSelector(selectBalanceDue);
  const canPay = useSelector(selectCanPay);
  const ready = useSelector(selectReadyToComplete);

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
        <div className="pt-2 space-y-1.5">
          <Row label="Paid" value={formatLKR(paid)} testId="totals-paid" />
          <Row label="Balance due" value={formatLKR(balance)} testId="totals-balance" strong />
        </div>
      </dl>

      <div className="mt-4">
        {ready ? (
          <div
            role="status"
            data-testid="totals-ready"
            className={`flex items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 transition-opacity ${syncing ? "opacity-50" : ""}`}
          >
            <CheckCircle2
              size={20}
              aria-hidden="true"
              className="flex-shrink-0 text-emerald-600 dark:text-emerald-400"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                Ready to complete
              </p>
              <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
                Paid in full
                {!isZero(sale.change_due) && (
                  <>
                    {" · "}change due{" "}
                    <span className="tabular-nums font-semibold" data-testid="totals-change">
                      {formatLKR(sale.change_due)}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
        ) : (
          <Button
            variant="accent"
            fullWidth
            className="h-12 text-base"
            aria-keyshortcuts="F4"
            disabled={!canPay}
            onClick={onPay}
          >
            <span className="tabular-nums">Pay {formatLKR(balance)}</span>
            <kbd
              aria-hidden="true"
              className="
                hidden [@media(hover:hover)_and_(pointer:fine)]:inline-flex
                items-center px-1.5 h-6 rounded-md
                text-[11px] font-semibold font-sans text-white/90
                border border-white/30 bg-white/10
              "
            >
              F4
            </kbd>
          </Button>
        )}
      </div>
    </section>
  );
};

export default TotalsPanel;
