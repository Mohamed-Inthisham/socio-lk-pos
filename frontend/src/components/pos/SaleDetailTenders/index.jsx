import { methodLabel } from "../PaymentDialog/methods";
import { cashChange, receiptAmount } from "../../../utils/receipt";

/**
 * SaleDetailTenders Component
 *
 * A sale's tenders on the detail page (P6-6), in the order they were
 * taken. Per tender: method and amount; the reference (card, bank
 * transfer, Koko, Mintpay); cash received and change; for a trade-in the
 * phone, its IMEI, the trade-in value, and the resale price and notes
 * when set (deferred here by P4-8). On a voided sale each stamped payment
 * is tagged "Reversed" (no refund is recorded; P6-12).
 *
 * PROPS:
 * - payments: sale.payments
 */

const Detail = ({ children }) => (
  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 tabular-nums">{children}</p>
);

const SaleDetailTenders = ({ payments }) => (
  <ul aria-label="Tenders" className="divide-y divide-slate-100 dark:divide-slate-800">
    {payments.map((p) => {
      const tradeIn = p.payment_method === "TRADE_IN";
      const change = p.payment_method === "CASH" ? cashChange(p) : "0.00";
      return (
        <li key={p.id} aria-label={methodLabel(p.payment_method)} className="px-4 py-2.5" data-testid="detail-tender">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
              {methodLabel(p.payment_method)}
              {p.reversed_at && (
                <span className="px-1.5 py-px rounded text-[10px] font-semibold uppercase tracking-wider bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
                  Reversed
                </span>
              )}
            </p>
            <p className="shrink-0 font-semibold tabular-nums">{receiptAmount(p.amount)}</p>
          </div>
          {p.reference_number && p.payment_method !== "CASH" && <Detail>Ref {p.reference_number}</Detail>}
          {p.payment_method === "CASH" && (
            <Detail>
              Received {receiptAmount(p.cash_received)}
              {Number(change) > 0 && ` · Change ${receiptAmount(change)}`}
            </Detail>
          )}
          {tradeIn && (
            <>
              <Detail>
                {[p.trade_in_product?.name, p.trade_in_imei && `IMEI ${p.trade_in_imei}`].filter(Boolean).join(" · ")}
              </Detail>
              <Detail>
                Trade-in value {receiptAmount(p.trade_in_buying_price ?? p.amount)}
                {p.trade_in_selling_price && ` · Resale ${receiptAmount(p.trade_in_selling_price)}`}
              </Detail>
              {p.trade_in_notes && <Detail>Notes: {p.trade_in_notes}</Detail>}
            </>
          )}
        </li>
      );
    })}
  </ul>
);

export default SaleDetailTenders;
