import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import { methodLabel } from "../PaymentDialog/methods";
import { formatLKR } from "../../../utils/money";
import {
  clearCompleteError,
  completeSale,
  refreshCartStock,
  selectCompleteError,
  selectDraftSale,
  selectIsCompleting,
  selectLastCompletedSale,
  selectStockWarnings,
} from "../../../store/slices/posTerminalSlice";

/**
 * CompleteSaleDialog Component
 *
 * The confirm before a sale is completed (planning doc P5-5, P5-6). Opened
 * by the Totals panel's Complete sale button or F9 (PosTerminal), only on
 * a fully paid sale.
 *
 * - Shows the total, the tenders and the change due.
 * - Re-checks branch stock on open (one GET /stock?branchId=, the slice's
 *   refreshCartStock). A shortfall is listed and blocks Complete, with
 *   Check again: the server would refuse it anyway (409). If the lookup
 *   fails, Complete stays available and the server's check is the guard.
 * - Complete is focused on open, so Enter completes and Esc goes back
 *   (§6). It never becomes `disabled` — that would drop focus out of it —
 *   but `aria-disabled` while blocked or completing. Pressing it while the
 *   stock check is still running waits for the check, then completes if
 *   nothing is short.
 * - Completing runs the slice's completeSale (at most once, P5-7). The
 *   dialog can't be dismissed meanwhile. Success (or a sale that turned
 *   out to be gone) closes it; any other failure stays here with the
 *   server's message. Step C refines those messages (P5-8).
 *
 * PROPS:
 * - open
 * - onClose: back without completing (Esc, backdrop, Back) and after success
 * - afterLeave: runs once the close transition ends (focus hand-off)
 */

// The stock check's state for this opening. "idle" = not answered yet:
// it is reset in the event handlers (close, Check again), never in an
// effect, and the effect only sets the answer when it arrives.
const CHECK_IDLE = "idle";
const CHECK_DONE = "done";
const CHECK_FAILED = "failed";

const tenderDetail = (payment) => {
  if (payment.payment_method === "TRADE_IN") {
    return [payment.trade_in_product?.name, payment.trade_in_imei].filter(Boolean).join(" · ");
  }
  if (payment.payment_method === "CASH") return `Received ${formatLKR(payment.cash_received)}`;
  return payment.reference_number ? `Ref ${payment.reference_number}` : null;
};

const CompleteSaleDialog = ({ open, onClose, afterLeave }) => {
  const dispatch = useDispatch();
  const store = useStore();
  const draft = useSelector(selectDraftSale);
  const lastCompleted = useSelector(selectLastCompletedSale);
  const completing = useSelector(selectIsCompleting);
  const completeError = useSelector(selectCompleteError);
  const warnings = useSelector(selectStockWarnings);
  const [check, setCheck] = useState(CHECK_IDLE);
  const checkRequest = useRef(null);

  // After success the draft is gone; keep showing that sale while the dialog fades out.
  const sale = draft ?? lastCompleted;
  const branchId = sale?.branch_id;
  const productIdsKey = [...new Set((draft?.lines ?? []).map((l) => l.product_id))].join(",");

  const runCheck = useCallback(() => {
    const productIds = productIdsKey ? productIdsKey.split(",") : [];
    const request = dispatch(refreshCartStock({ branchId, productIds })).then((action) => {
      const answer = refreshCartStock.fulfilled.match(action) ? CHECK_DONE : CHECK_FAILED;
      if (checkRequest.current === request) setCheck(answer);
      return answer;
    });
    checkRequest.current = request;
    return request;
  }, [dispatch, branchId, productIdsKey]);

  // On open. Not again once the sale has completed (the draft and its lines are gone).
  useEffect(() => {
    if (!open || !branchId || !productIdsKey) return;
    dispatch(clearCompleteError());
    runCheck();
  }, [open, branchId, productIdsKey, runCheck, dispatch]);

  // One entry per product that is short (warnings are per line).
  const shortfall = useMemo(() => {
    const byProduct = new Map();
    for (const line of draft?.lines ?? []) {
      const warning = warnings[line.id];
      if (warning && !byProduct.has(line.product_id)) {
        byProduct.set(line.product_id, { name: line.product_name_snapshot, ...warning });
      }
    }
    return [...byProduct.values()];
  }, [draft, warnings]);

  const checking = check === CHECK_IDLE;
  const blocked = check === CHECK_DONE && shortfall.length > 0;

  const close = () => {
    if (completing) return;
    checkRequest.current = null;
    setCheck(CHECK_IDLE);
    onClose();
  };

  const checkAgain = () => {
    setCheck(CHECK_IDLE);
    runCheck();
  };

  const complete = async () => {
    if (completing || blocked) return;
    if (checking && checkRequest.current) {
      const answer = await checkRequest.current;
      if (answer === CHECK_DONE && Object.keys(selectStockWarnings(store.getState())).length) return;
    }
    const result = await dispatch(completeSale());
    if (completeSale.fulfilled.match(result) || result.payload?.gone) {
      checkRequest.current = null;
      setCheck(CHECK_IDLE);
      onClose();
    }
  };

  const total = sale?.total ?? "0.00";
  const changeDue = sale?.change_due ?? "0.00";
  const payments = sale?.payments ?? [];

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Complete this sale?"
      size="sm"
      dismissible={!completing}
      afterLeave={afterLeave}
      footer={
        <>
          <Button variant="secondary" label="Back" onClick={close} disabled={completing} />
          <Button
            variant="accent"
            onClick={complete}
            aria-disabled={completing || blocked}
            aria-busy={completing}
            aria-keyshortcuts="Enter"
            className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
            data-autofocus
          >
            {completing && <Loader2 size={16} aria-hidden="true" className="animate-spin" />}
            Complete sale
          </Button>
        </>
      }
    >
      <dl className="space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-semibold text-slate-700 dark:text-slate-200">Total</dt>
          <dd data-testid="complete-total" className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatLKR(total)}
          </dd>
        </div>
        {Number(changeDue) > 0 && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-semibold text-emerald-700 dark:text-emerald-300">Change due</dt>
            <dd data-testid="complete-change" className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
              {formatLKR(changeDue)}
            </dd>
          </div>
        )}
      </dl>

      <ul aria-label="Tenders" className="mt-3 divide-y divide-slate-100 dark:divide-slate-800 border-y border-slate-100 dark:border-slate-800 text-sm">
        {payments.map((payment) => {
          const detail = tenderDetail(payment);
          return (
            <li key={payment.id} className="py-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-slate-700 dark:text-slate-200">{methodLabel(payment.payment_method)}</span>
                <span className="tabular-nums text-slate-900 dark:text-slate-100">{formatLKR(payment.amount)}</span>
              </div>
              {detail && (
                <p className="text-xs text-slate-500 dark:text-slate-400 break-words font-mono">{detail}</p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-3 min-h-5 text-sm" aria-live="polite">
        {checking && (
          <p className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <Loader2 size={14} aria-hidden="true" className="animate-spin" />
            Checking stock…
          </p>
        )}
        {check === CHECK_FAILED && (
          <p className="text-slate-500 dark:text-slate-400">
            Couldn&apos;t check stock. It will be checked when the sale completes.
          </p>
        )}
        {blocked && (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-amber-800 dark:text-amber-200"
          >
            <p className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle size={14} aria-hidden="true" />
              Not enough stock
            </p>
            <ul className="mt-1 space-y-0.5">
              {shortfall.map((item) => (
                <li key={item.name}>
                  {item.name}: {item.required} needed, {item.available} in stock
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs">Remove or reduce the item, or ask a manager to adjust stock.</p>
            <Button size="sm" variant="secondary" className="mt-2" label="Check again" onClick={checkAgain} />
          </div>
        )}
      </div>

      {completeError && !completeError.gone && (
        <div
          role="alert"
          className="mt-3 flex gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          <AlertCircle size={16} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
          <span>{completeError.message}</span>
        </div>
      )}
    </Dialog>
  );
};

export default CompleteSaleDialog;
