import { useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AlertCircle, CircleDollarSign, Loader2, Trash2 } from "lucide-react";
import { PAYMENT_METHODS, methodLabel } from "../PaymentDialog/methods";
import RemoveTradeInDialog from "../RemoveTradeInDialog";
import { computeChangeCents } from "../../../schemas/paymentSchema";
import { formatLKR, fromCents } from "../../../utils/money";
import {
  removePayment,
  selectPaymentError,
  selectPayments,
  selectPosStatus,
} from "../../../store/slices/posTerminalSlice";

/**
 * PaymentsList Component
 *
 * The tenders on the draft sale (server payments plus optimistic pending
 * rows, selectPayments). Sits in the left column directly below the cart
 * (P3-4 placement); the Totals panel's Paid / Balance due rows sum it.
 *
 * - Each row: method icon + label, amount, then the reference (CARD,
 *   BANK_TRANSFER, KOKO, MINTPAY), cash received + change (CASH), or
 *   `<product name> · <IMEI>` (TRADE_IN, P4-8: one mono line, truncated,
 *   full text in the tooltip). The name comes from the hydrated sale's
 *   `trade_in_product` (P4-9); a pending row carries the picked product.
 * - Remove: no confirm (P3-2), except TRADE_IN, which asks first
 *   (RemoveTradeInDialog, P4-10). The slice hides the row at once and
 *   restores it if the DELETE fails; the failure shows here (the
 *   slice's paymentError). Focus goes back to the scan bar, as after a
 *   line delete (after a trade-in confirm, once the dialog has closed;
 *   a cancelled confirm returns focus to the remove button).
 * - Pending rows (add in flight) are dimmed with a spinner in place of
 *   the remove button.
 * - No edit (P3-1): a wrong tender is removed and re-added.
 *
 * Layout follows the card's own width (container query), not the
 * viewport: a table with a header row when it has ≥ 32rem (desktop and
 * tablet), stacked rows below that (phones).
 *
 * Height: natural, never shrinking — the cart above (flex-1) gives way
 * instead. The list shows up to 3 rows and scrolls beyond that; with 2+
 * payments it also has an explicit 2-row minimum. Rows have a fixed
 * height in each layout (stacked h-18, table h-14) so those bounds are
 * exact; keep them in step.
 *
 * Renders nothing until the sale has a payment, so the cart keeps the
 * full height until the first tender.
 *
 * PROPS:
 * - onReturnFocus: hand focus back to the scan bar after a remove
 */

const methodIcon = (value) =>
  PAYMENT_METHODS.find((m) => m.value === value)?.icon ?? CircleDollarSign;

const COLUMNS = "@lg:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_7.5rem_2.5rem]";

// Row heights (border included) and the list bounds built on them:
// stacked 4.5rem, table 3.5rem. The list itself has no border, so
// 3 rows fit max-h exactly.
const ROW_HEIGHT = "h-18 @lg:h-14";
const MAX_THREE_ROWS = "max-h-54 @lg:max-h-42";
const MIN_TWO_ROWS = "min-h-36 @lg:min-h-28";

const PaymentDetail = ({ payment }) => {
  if (payment.payment_method === "TRADE_IN") {
    const phone = [payment.trade_in_product?.name, payment.trade_in_imei]
      .filter(Boolean)
      .join(" · ");
    return (
      <span className="font-mono" title={phone}>
        {phone}
      </span>
    );
  }
  if (payment.payment_method === "CASH") {
    const change = computeChangeCents(payment.amount, payment.cash_received);
    return (
      <span className="tabular-nums">
        Received {formatLKR(payment.cash_received)}
        {change > 0 && <> · change {formatLKR(fromCents(change))}</>}
      </span>
    );
  }
  if (!payment.reference_number) return null;
  return (
    <span className="font-mono" title={payment.reference_number}>
      Ref {payment.reference_number}
    </span>
  );
};

// The icon arrives as a prop: a component looked up during render trips
// the React Compiler lint (react-hooks/static-components).
const MethodIcon = ({ icon: Icon }) => (
  <span className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
    <Icon size={16} aria-hidden="true" />
  </span>
);

const PaymentRow = ({ payment, disabled, onRemove }) => {
  const label = methodLabel(payment.payment_method);
  const amount = formatLKR(payment.amount);

  return (
    <li
      aria-label={`${label} ${amount}`}
      aria-busy={payment.pending}
      data-testid="payment-row"
      className={`
        grid grid-cols-[minmax(0,1fr)_auto_2.5rem] ${COLUMNS}
        ${ROW_HEIGHT} content-center
        items-center gap-x-3 gap-y-0.5 px-4 py-2.5
        border-b border-slate-100 dark:border-slate-800 last:border-b-0
        ${payment.pending ? "opacity-60" : ""}
      `}
    >
      {/* Method */}
      <div className="min-w-0 col-start-1 row-start-1 flex items-center gap-2.5">
        <MethodIcon icon={methodIcon(payment.payment_method)} />
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
          {label}
        </span>
      </div>

      {/* Detail: under the method when narrow, its own column when wide */}
      <div className="min-w-0 col-start-1 row-start-2 pl-10.5 @lg:pl-0 @lg:col-start-2 @lg:row-start-1 text-xs text-slate-500 dark:text-slate-400 truncate">
        <PaymentDetail payment={payment} />
      </div>

      {/* Amount */}
      <span className="col-start-2 row-start-1 row-span-2 @lg:row-span-1 @lg:col-start-3 text-right text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {amount}
      </span>

      {/* Remove */}
      <div className="col-start-3 row-start-1 row-span-2 @lg:row-span-1 @lg:col-start-4 flex justify-end">
        {payment.pending ? (
          <span className="w-9 h-9 flex items-center justify-center">
            <Loader2 size={16} aria-label="Recording" className="animate-spin text-cyan-600" />
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Remove ${label} payment of ${amount}`}
            disabled={disabled}
            onClick={onRemove}
            className="
              w-9 h-9 flex items-center justify-center rounded-lg
              text-slate-400 dark:text-slate-500
              hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/40
              disabled:opacity-40 disabled:hover:bg-transparent
              focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500
            "
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
};

const PaymentsList = ({ onReturnFocus }) => {
  const dispatch = useDispatch();
  const payments = useSelector(selectPayments);
  const error = useSelector(selectPaymentError);
  const status = useSelector(selectPosStatus);
  // The trade-in awaiting its remove confirm (kept while the dialog fades
  // out), and whether the confirm is open.
  const [tradeIn, setTradeIn] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const tradeInRemoved = useRef(false);

  const remove = (paymentId) => {
    dispatch(removePayment({ paymentId }));
    onReturnFocus?.();
  };

  const requestRemove = (payment) => {
    if (payment.payment_method !== "TRADE_IN") {
      remove(payment.id);
      return;
    }
    tradeInRemoved.current = false;
    setTradeIn(payment);
    setConfirmOpen(true);
  };

  const confirmDialog = (
    <RemoveTradeInDialog
      open={confirmOpen}
      payment={tradeIn}
      onClose={() => setConfirmOpen(false)}
      onConfirm={() => {
        tradeInRemoved.current = true;
        setConfirmOpen(false);
        dispatch(removePayment({ paymentId: tradeIn.id }));
      }}
      afterLeave={() => {
        setTradeIn(null);
        // Deferred: Headless UI restores focus to the opener after
        // afterLeave; a removed row has no remove button to go back to.
        if (tradeInRemoved.current) setTimeout(() => onReturnFocus?.(), 0);
      }}
    />
  );

  // The confirm stays mounted, at the same place in the tree, when the
  // list empties, so its close transition (and focus hand-off) still runs.
  const empty = payments.length === 0 && !error;

  return (
    <>
      {!empty && (
        <section
          aria-label="Payments"
          data-testid="payments-card"
          className={`@container flex-shrink-0 flex flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm`}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Payments
            </h2>
            {payments.length > 0 && (
              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {payments.length}
              </span>
            )}
          </div>

          {payments.length > 0 && (
            <div className="border-t border-slate-100 dark:border-slate-800 @lg:border-t-0">
              <div
                className={`
                  hidden @lg:grid ${COLUMNS} gap-x-3 px-4 py-1.5
                  border-y border-slate-200 dark:border-slate-800
                  text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400
                `}
              >
                <span className="pl-10.5">Method</span>
                <span>Details</span>
                <span className="text-right">Amount</span>
                <span />
              </div>
              <ul
                aria-label="Payments"
                className={`overflow-y-auto ${MAX_THREE_ROWS} ${payments.length > 1 ? MIN_TWO_ROWS : ""}`}
              >
                {payments.map((payment) => (
                  <PaymentRow
                    key={payment.id}
                    payment={payment}
                    disabled={status !== "ready"}
                    onRemove={() => requestRemove(payment)}
                  />
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 text-sm text-red-600 dark:text-red-400"
            >
              <AlertCircle size={16} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
              {error.message}
            </p>
          )}
        </section>
      )}
      {confirmDialog}
    </>
  );
};

export default PaymentsList;
