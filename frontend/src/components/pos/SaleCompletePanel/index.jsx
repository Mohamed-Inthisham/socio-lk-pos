import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AlertCircle, CheckCircle2, Loader2, Printer, User } from "lucide-react";
import Button from "../../common/Button";
import { methodLabel, tenderDetail } from "../PaymentDialog/methods";
import { formatLKR } from "../../../utils/money";
import { formatColomboDayTime } from "../../../utils/colomboTime";
import {
  selectLastCompletedSale,
  selectNextDraft,
  startNextSale,
} from "../../../store/slices/posTerminalSlice";

/**
 * SaleCompletePanel Component
 *
 * Shown in place of the cart, payments and the right-hand column once a
 * sale completes (planning doc P5-9). The scan bar above it stays live.
 *
 * - The sale number and time, the change to hand back (largest, when
 *   there is cash change), total and paid, the tenders (up to 3, then
 *   "+N more") and the customer.
 * - Next sale (P5-10): the next DRAFT is already being opened in the
 *   background (the slice's openNextDraft), so this normally switches at
 *   once; if the create is still running it waits, and if it failed it
 *   tries again — with the failure shown here. Enter on the empty scan
 *   bar and a scan do the same (ScanBar); a scan also adds its item to
 *   the new draft.
 * - Reprint receipt (P5-12) appears when `onReprint` is given (step E,
 *   printing).
 *
 * PROPS:
 * - onReturnFocus: hand focus back to the scan bar once the next sale is open
 * - onReprint: (sale) => void — reprint this sale's receipt (optional)
 */

// 3 rows + "+N more" keeps the worst case (customer, many tenders) above
// the fold at ~640px (measured at Checkpoint D).
const MAX_TENDERS = 3;

const formatTime = (iso) => formatColomboDayTime(iso) || null;

const Row = ({ label, value, testId }) => (
  <div className="flex items-baseline justify-between gap-4 text-sm">
    <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
    <dd data-testid={testId} className="tabular-nums text-slate-900 dark:text-slate-100">
      {value}
    </dd>
  </div>
);

const SaleCompletePanel = ({ onReturnFocus, onReprint }) => {
  const dispatch = useDispatch();
  const sale = useSelector(selectLastCompletedSale);
  const nextDraft = useSelector(selectNextDraft);
  const [starting, setStarting] = useState(false);

  if (!sale) return null;

  const nextSale = async () => {
    if (starting) return;
    setStarting(true);
    const started = await dispatch(startNextSale());
    setStarting(false);
    if (started) onReturnFocus?.();
  };

  const change = Number(sale.change_due) > 0 ? sale.change_due : null;
  const payments = sale.payments ?? [];
  const shown = payments.slice(0, MAX_TENDERS);
  const more = payments.length - shown.length;
  const failed = nextDraft.status === "failed" && !starting;

  return (
    <section
      aria-label="Sale complete"
      data-testid="sale-complete"
      className="flex-1 min-h-0 overflow-y-auto flex justify-center items-start lg:items-center"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={28} aria-hidden="true" className="flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Sale complete</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <span data-testid="sale-number" className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                {sale.sale_number}
              </span>
              {formatTime(sale.completed_at) && <> · {formatTime(sale.completed_at)}</>}
            </p>
          </div>
        </div>

        {/* Change and totals side by side from sm: keeps Next sale above the fold at ~640px */}
        <div className={`mt-4 grid gap-4 items-center ${change ? "sm:grid-cols-2" : ""}`}>
          {change && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Change due</p>
              <p data-testid="sale-complete-change" className="text-3xl font-bold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-300">
                {formatLKR(change)}
              </p>
            </div>
          )}

          <dl className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-base font-semibold text-slate-900 dark:text-slate-100">Total</dt>
              <dd data-testid="sale-complete-total" className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {formatLKR(sale.total)}
              </dd>
            </div>
            <Row label="Paid" value={formatLKR(sale.amount_paid)} testId="sale-complete-paid" />
          </dl>
        </div>

        <ul aria-label="Tenders" className="mt-3 divide-y divide-slate-100 dark:divide-slate-800 border-y border-slate-100 dark:border-slate-800 text-sm">
          {shown.map((payment) => {
            const detail = tenderDetail(payment);
            return (
              <li key={payment.id} className="py-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-slate-700 dark:text-slate-200">{methodLabel(payment.payment_method)}</span>
                  <span className="tabular-nums text-slate-900 dark:text-slate-100">{formatLKR(payment.amount)}</span>
                </div>
                {detail && <p className="text-xs text-slate-500 dark:text-slate-400 truncate font-mono" title={detail}>{detail}</p>}
              </li>
            );
          })}
          {more > 0 && (
            <li className="py-1.5 text-xs text-slate-500 dark:text-slate-400">+{more} more</li>
          )}
        </ul>

        {sale.customer && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <User size={14} aria-hidden="true" />
            <span data-testid="sale-complete-customer">{sale.customer.name}</span>
          </p>
        )}

        {failed && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300"
          >
            <AlertCircle size={16} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
            Couldn&apos;t open the next sale. {nextDraft.error?.message}
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          {onReprint && (
            <Button variant="secondary" icon={Printer} label="Reprint receipt" onClick={() => onReprint(sale)} />
          )}
          <Button
            variant="accent"
            className="h-12 px-6 text-base"
            aria-keyshortcuts="Enter"
            aria-busy={starting}
            onClick={nextSale}
          >
            {starting && <Loader2 size={16} aria-hidden="true" className="animate-spin" />}
            {failed ? "Try again" : "Next sale"}
            <kbd
              aria-hidden="true"
              className="
                hidden [@media(hover:hover)_and_(pointer:fine)]:inline-flex
                items-center px-1.5 h-6 rounded-md
                text-[11px] font-semibold font-sans text-white/90
                border border-white/30 bg-white/10
              "
            >
              Enter
            </kbd>
          </Button>
        </div>
      </div>
    </section>
  );
};

export default SaleCompletePanel;
