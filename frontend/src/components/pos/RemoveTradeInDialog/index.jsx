import { AlertTriangle } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import { formatLKR } from "../../../utils/money";

/**
 * RemoveTradeInDialog Component
 *
 * Confirms removing a TRADE_IN payment (planning doc P4-10). Other tenders
 * are removed without a confirm (P3-2): re-adding them is one keystroke,
 * but re-adding a trade-in means re-entering the product, IMEI and prices.
 *
 * Confirming only closes the dialog and calls `onConfirm`; the removal
 * itself is the PaymentsList's optimistic one (hidden at once, restored
 * with an error if the DELETE fails). Remove is focused on open, so
 * Enter confirms and Esc cancels (§6).
 *
 * PROPS:
 * - open
 * - payment: the TRADE_IN payment to remove (kept while closing, so the
 *   body doesn't empty during the fade-out)
 * - onClose: cancel (Esc, backdrop, Keep trade-in)
 * - onConfirm: remove it
 * - afterLeave: runs once the close transition ends (focus hand-off)
 */

export const REMOVE_TRADE_IN_MESSAGE = "You'll need to re-enter the phone details.";

const RemoveTradeInDialog = ({ open, payment, onClose, onConfirm, afterLeave }) => {
  const phone = [payment?.trade_in_product?.name, payment?.trade_in_imei]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Remove trade-in?"
      size="sm"
      afterLeave={afterLeave}
      footer={
        <>
          <Button variant="secondary" label="Keep trade-in" onClick={onClose} />
          <Button
            variant="danger"
            label="Remove trade-in"
            onClick={onConfirm}
            data-autofocus
          />
        </>
      }
    >
      <div className="flex gap-3">
        <div className="w-10 h-10 flex-shrink-0 rounded-xl flex items-center justify-center bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          <AlertTriangle size={20} aria-hidden="true" />
        </div>
        <div className="min-w-0 text-sm">
          {payment && (
            <>
              {/* Wraps rather than truncates: this is where the cashier checks which phone */}
              <p className="font-mono break-words text-slate-900 dark:text-slate-100">{phone}</p>
              <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                Trade-in value{" "}
                <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatLKR(payment.amount)}
                </span>
              </p>
            </>
          )}
          <p className="mt-2 text-slate-600 dark:text-slate-300">{REMOVE_TRADE_IN_MESSAGE}</p>
        </div>
      </div>
    </Dialog>
  );
};

export default RemoveTradeInDialog;
