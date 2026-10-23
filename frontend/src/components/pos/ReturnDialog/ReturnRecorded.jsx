import { CheckCircle2 } from "lucide-react";
import { formatLKR, toCents } from "../../../utils/money";
import { handOverLines, itemLines, lkr, recordedTradeInCents } from "./returnText";

/**
 * ReturnRecorded Component
 *
 * What the ReturnDialog shows once a return is recorded (planning doc
 * P7-15, P7-17): read from the sale the server answered with, by
 * return_id, never from the form, so a resend (or a lost response found
 * on re-read) shows what was actually recorded. Step D prints the slip
 * from here.
 *
 * PROPS:
 * - ret: the recorded return (sale.returns[] entry)
 * - sale: the sale it belongs to
 * - resent: the server had recorded it already (200 on a resend)
 */

const Section = ({ title, children }) => (
  <section className="min-w-0">
    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">{title}</h3>
    {children}
  </section>
);

const ReturnRecorded = ({ ret, sale, resent }) => {
  const tradeInCents = recordedTradeInCents(ret, sale);
  const lowered = toCents(ret.refund_total) < toCents(ret.refund_due);
  return (
    <div className="flex flex-col gap-4" data-testid="return-recorded">
      <div
        role="status"
        className="flex items-start gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-3"
      >
        <CheckCircle2 size={18} aria-hidden="true" className="shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="text-sm text-emerald-900 dark:text-emerald-100">
          <p className="font-semibold">Return {ret.return_number} recorded.</p>
          {resent && <p className="text-xs">This return was already recorded; nothing was added twice.</p>}
          <p className="text-xs">Approved by {ret.approver?.full_name ?? "a manager"}.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4">
        <Section title="Hand over">
          <ul className="space-y-1 text-sm font-medium text-slate-900 dark:text-slate-100" data-testid="return-hand-over">
            {handOverLines(ret).map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            Refund {formatLKR(ret.refund_total)}
            {lowered && <> of {formatLKR(ret.refund_due)} due</>}.
          </p>
          {tradeInCents > 0 && (
            <p className="text-xs text-slate-600 dark:text-slate-300">Includes {lkr(tradeInCents)} from a trade-in.</p>
          )}
        </Section>

        <Section title="Items">
          <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200" data-testid="return-items">
            {itemLines(ret, sale).map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          {ret.out_of_warranty && ret.override_reason && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              Outside warranty — approved by {ret.approver?.full_name ?? "a manager"}: {ret.override_reason}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
};

export default ReturnRecorded;
