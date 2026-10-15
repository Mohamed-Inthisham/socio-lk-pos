import { useSelector } from "react-redux";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import { formatLKR } from "../../../utils/money";
import {
  selectBalanceDue,
  selectDraftSale,
  selectPaidTotal,
} from "../../../store/slices/posTerminalSlice";

/**
 * PaymentDialog Component
 *
 * Takes one tender per submission (P3-6; multi-tender = open it again).
 * Opened by the Totals panel's "Pay LKR X" button or F4.
 *
 * The header shows the server's total, what is already paid and the
 * balance due. The method picker and the CASH / reference fields land in
 * the following P3 steps.
 *
 * PROPS:
 * - open, onClose
 * - afterLeave: runs once the close transition ends (focus hand-off to
 *   the scan bar)
 */

const Figure = ({ label, value, testId, strong = false }) => (
  <div className="min-w-0">
    <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
      {label}
    </dt>
    <dd
      data-testid={testId}
      className={`mt-0.5 tabular-nums truncate ${strong ? "text-lg font-bold text-slate-900 dark:text-white" : "text-sm font-medium text-slate-700 dark:text-slate-200"}`}
    >
      {value}
    </dd>
  </div>
);

const PaymentDialog = ({ open, onClose, afterLeave }) => {
  const sale = useSelector(selectDraftSale);
  const paid = useSelector(selectPaidTotal);
  const balance = useSelector(selectBalanceDue);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Take payment"
      afterLeave={afterLeave}
      footer={<Button variant="secondary" label="Cancel" onClick={onClose} />}
    >
      <dl className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-4 py-3">
        <Figure label="Total" value={formatLKR(sale?.total)} testId="payment-total" />
        <Figure label="Paid" value={formatLKR(paid)} testId="payment-paid" />
        <Figure label="Balance" value={formatLKR(balance)} testId="payment-balance" strong />
      </dl>
    </Dialog>
  );
};

export default PaymentDialog;
