import { Printer } from "lucide-react";
import Button from "../../common/Button";
import { methodLabel } from "../PaymentDialog/methods";
import { recordedTradeInCents } from "../ReturnDialog/returnText";
import { formatLKR, fromCents, toCents } from "../../../utils/money";
import { receiptDateTime } from "../../../utils/receipt";

/**
 * SaleDetailReturns Component
 *
 * A sale's returns on its detail page (planning doc P7-18), oldest first
 * as GET /sales/:id lists them. Per return: number and time; the refund
 * (and what was due when lower); each item and where it went; how the
 * money went back; the trade-in's part; the reason; who approved and who
 * asked; the outside-warranty approval; and Reprint slip, which prints
 * both copies marked "REPRINT · <time>" (the page re-reads the sale
 * first, as for the receipt).
 *
 * PROPS:
 * - sale: the hydrated sale, with returns[]
 * - onReprint: (returnId) => void
 * - reprinting: the return being reprinted, or null
 * - errors: { [returnId]: message } from a failed reprint
 * - disabled: another print is running
 */

const WHERE = {
  RESTOCKED: "back to stock",
  DAMAGED: "damaged",
  INSPECTION: "for inspection",
  NOT_OUR_STOCK: "not our stock",
  UNTRACKED: "no stock change",
};

const howLine = (refund) =>
  refund.method === "CASH"
    ? `Cash ${formatLKR(refund.amount)}`
    : `${methodLabel(refund.method)} reversal ${formatLKR(refund.amount)}${refund.reference_number ? ` (ref ${refund.reference_number})` : ""}`;

const SaleDetailReturns = ({ sale, onReprint, reprinting = null, errors = {}, disabled = false }) => (
  <ol aria-label="Returns" className="divide-y divide-slate-100 dark:divide-slate-800">
    {sale.returns.map((ret) => {
      const lowered = toCents(ret.refund_total) < toCents(ret.refund_due);
      const tradeInCents = recordedTradeInCents(ret, sale);
      const nameOf = (id) => sale.lines.find((l) => l.id === id)?.product_name_snapshot ?? "An item";
      return (
        <li key={ret.id} aria-label={ret.return_number} className="px-4 py-2.5 text-sm" data-testid="detail-return">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <p className="min-w-0">
              <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{ret.return_number}</span>
              <span className="text-slate-500 dark:text-slate-400"> · {receiptDateTime(ret.created_at)}</span>
            </p>
            <p className="shrink-0 font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              Refund {formatLKR(ret.refund_total)}
              {lowered && (
                <span className="font-normal text-slate-500 dark:text-slate-400"> of {formatLKR(ret.refund_due)} due</span>
              )}
            </p>
          </div>

          <ul className="mt-1 text-xs text-slate-700 dark:text-slate-200" data-testid="detail-return-items">
            {ret.lines.map((l) => {
              const saleLine = sale.lines.find((line) => line.id === l.sale_line_id);
              return (
                <li key={l.sale_line_id}>
                  {l.quantity} × {nameOf(l.sale_line_id)}
                  {saleLine?.imei_snapshot && <span className="font-mono tracking-tight"> ({saleLine.identifier_type_snapshot === "SERIAL_NUMBER" ? "Serial number" : "IMEI"} {saleLine.imei_snapshot})</span>}
                  {" → "}
                  {WHERE[l.disposition] ?? l.disposition}
                </li>
              );
            })}
          </ul>

          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300" data-testid="detail-return-how">
            {ret.refunds.length === 0 ? "No refund" : ret.refunds.map(howLine).join(" · ")}
            {tradeInCents > 0 && <> · includes {formatLKR(fromCents(tradeInCents))} from a trade-in</>}
          </p>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Reason: {ret.reason}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Approved by {ret.approver?.full_name ?? "a manager"}
            {ret.requester?.full_name && <> · requested by {ret.requester.full_name}</>}
          </p>
          {ret.out_of_warranty && ret.override_reason && (
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300" data-testid="detail-return-override">
              Outside warranty — approved by {ret.approver?.full_name ?? "a manager"}: {ret.override_reason}
            </p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              size="sm"
              variant="secondary"
              icon={Printer}
              label="Reprint slip"
              title={`Reprint ${ret.return_number}'s slip (both copies, marked REPRINT)`}
              loading={reprinting === ret.id}
              disabled={disabled}
              onClick={() => onReprint(ret.id)}
            />
            {errors[ret.id] && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {errors[ret.id]}
              </p>
            )}
          </div>
        </li>
      );
    })}
  </ol>
);

export default SaleDetailReturns;
