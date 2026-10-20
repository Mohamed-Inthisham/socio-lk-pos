import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useDispatch, useSelector } from "react-redux";
import { AlertTriangle, FilePlus2 } from "lucide-react";
import Button from "../../components/common/Button";
import CartLines from "../../components/pos/CartLines";
import CompleteSaleDialog from "../../components/pos/CompleteSaleDialog";
import CustomerAttachDialog from "../../components/pos/CustomerAttachDialog";
import CustomerCard from "../../components/pos/CustomerCard";
import NewSaleDialog from "../../components/pos/NewSaleDialog";
import PaymentDialog from "../../components/pos/PaymentDialog";
import PaymentsList from "../../components/pos/PaymentsList";
import ScanBar from "../../components/pos/ScanBar";
import TotalsPanel from "../../components/pos/TotalsPanel";
import useTerminalBranch from "../../hooks/useTerminalBranch";
import { isTouchOnly } from "../../utils/device";
import {
  discardDraftSale,
  ensureDraftSale,
  selectCanComplete,
  selectCanPay,
  selectCartLines,
  selectDraftSale,
  selectPosError,
  selectPosStatus,
  selectAttachedCustomer,
  selectHasTradeInPayment,
} from "../../store/slices/posTerminalSlice";
import { CASH, TRADE_IN } from "../../schemas/paymentSchema";

/**
 * PosTerminal Page
 *
 * Route: /pos. Opens (or resumes) the branch's DRAFT sale on mount and
 * lays out the terminal:
 * - ≥ lg: cart + payments column left, sale/customer/totals column right
 *   (Q23, 1366×768 target)
 * - < lg: single column — scan, cart, payments, then sale/customer/totals
 *
 * FOCUS (§6): the scan bar is the home position.
 * - F2 focuses it from anywhere (also from inputs); Esc does too when
 *   focus isn't in an input. Both are ignored while a dialog has focus —
 *   the dialog owns its keys.
 * - F3 opens the CustomerAttachDialog from anywhere (also from inputs),
 *   unless a dialog (New sale, Attach customer, IMEI prompt) is already
 *   open, or a trade-in payment holds the customer (P4-11).
 * - F4 opens the PaymentDialog under the same rule, and only when the
 *   Pay button is enabled (both read selectCanPay).
 * - F6 (P4-1, P4-2) opens it on Trade-in under the F4 rule. With no
 *   customer on the sale it starts the attach-then-return sequence
 *   instead. A page can intercept F6 (Chrome/Edge would otherwise move
 *   focus to the address bar): every F6 is preventDefault-ed, also when
 *   it does nothing.
 * - F9 (P5-4) opens the CompleteSaleDialog when the Complete sale button
 *   is enabled (both read selectCanComplete) and no other dialog is open.
 *   Every F9 is preventDefault-ed too: Edge opens Immersive Reader on F9.
 *
 * TRADE-IN ATTACH-THEN-RETURN (P4-2): the PaymentDialog's "Attach
 * customer" (or F6 with no customer) closes the PaymentDialog, opens the
 * CustomerAttachDialog once it has gone, and — if a customer was
 * attached — reopens the PaymentDialog on Trade-in. Cancelling the
 * attach just returns focus to the scan bar.
 * - Automatic hand-offs (qty Enter, line delete, New sale dialog closed)
 *   return focus to it, except on touch-only devices where that would
 *   keep popping the on-screen keyboard. F2 / a tap always work.
 *
 * Phase 6.4 P1 builds this up: draft lifecycle → ScanBar → CartLines →
 * TotalsPanel; P2 adds the CustomerCard (+ CustomerAttachDialog) under
 * "Current sale"; P3 adds the PaymentDialog (Pay / F4) and the
 * PaymentsList below the cart (the cart has the spare height; the
 * right-hand column doesn't). Trade-in (P4) and complete (P5) slot in
 * later.
 */

const Card = ({ className = "", children }) => (
  <div
    className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm ${className}`}
  >
    {children}
  </div>
);

const formatStarted = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-LK", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

const inDialog = () => !!document.activeElement?.closest('[role="dialog"]');
// Any open Headless UI dialog — not just one holding focus.
const dialogOpen = () => inDialog() || !!document.querySelector('[role="dialog"]');

const PosTerminal = () => {
  const dispatch = useDispatch();
  const scanRef = useRef(null);
  const { branchId } = useTerminalBranch();
  const status = useSelector(selectPosStatus);
  const error = useSelector(selectPosError);
  const sale = useSelector(selectDraftSale);
  const lines = useSelector(selectCartLines);
  const canPay = useSelector(selectCanPay);
  const canComplete = useSelector(selectCanComplete);
  const customer = useSelector(selectAttachedCustomer);
  const hasTradeIn = useSelector(selectHasTradeInPayment);
  const [confirmNewSale, setConfirmNewSale] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(CASH);
  const [completeOpen, setCompleteOpen] = useState(false);
  // Attach-then-return (P4-2): the attach is for a trade-in, and whether
  // a customer was actually attached (vs cancelled).
  const tradeInAttach = useRef({ active: false, attached: false, afterPayment: false });

  useEffect(() => {
    if (branchId) dispatch(ensureDraftSale({ branchId }));
  }, [dispatch, branchId]);

  const focusScan = useCallback(() => scanRef.current?.focus(), []);
  // Automatic hand-off: skipped on touch-only devices.
  const returnFocus = useCallback(() => {
    if (!isTouchOnly()) focusScan();
  }, [focusScan]);

  useHotkeys(
    "f2",
    () => {
      if (!inDialog()) focusScan();
    },
    { enableOnFormTags: true, preventDefault: true },
    [focusScan],
  );
  const openPayment = (method) => {
    setPaymentMethod(method);
    setPaymentOpen(true);
  };

  const startTradeInAttach = () => {
    tradeInAttach.current = { active: true, attached: false, afterPayment: false };
    setAttachOpen(true);
  };

  // The PaymentDialog's "Attach customer": close it, attach once it's gone.
  const attachFromPayment = () => {
    tradeInAttach.current = { active: true, attached: false, afterPayment: true };
    setPaymentOpen(false);
  };

  const afterPaymentLeave = () => {
    if (tradeInAttach.current.afterPayment) {
      tradeInAttach.current.afterPayment = false;
      setAttachOpen(true);
      return;
    }
    // Deferred: Headless UI restores focus to the opener after afterLeave.
    setTimeout(returnFocus, 0);
  };

  const afterAttachLeave = () => {
    const { active, attached } = tradeInAttach.current;
    tradeInAttach.current = { active: false, attached: false, afterPayment: false };
    if (active && attached) openPayment(TRADE_IN);
    else setTimeout(returnFocus, 0);
  };

  useHotkeys(
    "f3",
    () => {
      if (status === "ready" && !hasTradeIn && !dialogOpen()) setAttachOpen(true);
    },
    { enableOnFormTags: true, preventDefault: true },
    [status, hasTradeIn],
  );
  useHotkeys(
    "f4",
    () => {
      if (canPay && !dialogOpen()) openPayment(CASH);
    },
    { enableOnFormTags: true, preventDefault: true },
    [canPay],
  );
  useHotkeys(
    "f6",
    () => {
      if (!canPay || dialogOpen()) return;
      if (customer) openPayment(TRADE_IN);
      else startTradeInAttach();
    },
    { enableOnFormTags: true, preventDefault: true },
    [canPay, customer],
  );
  useHotkeys(
    "f9",
    () => {
      if (canComplete && !dialogOpen()) setCompleteOpen(true);
    },
    { enableOnFormTags: true, preventDefault: true },
    [canComplete],
  );
  useHotkeys(
    "esc",
    () => {
      if (!inDialog()) focusScan();
    },
    [focusScan],
  );

  const openSale = () => dispatch(ensureDraftSale({ branchId }));
  const startNewSale = () =>
    dispatch(discardDraftSale({ branchId })).unwrap();

  if (status === "error") {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-6">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            <AlertTriangle size={22} aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold">Couldn&apos;t open a sale</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {error?.message}
          </p>
          <Button
            className="mt-5"
            variant="accent"
            label="Try again"
            onClick={openSale}
          />
        </Card>
      </div>
    );
  }

  if (status === "idle" || status === "loading") {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Opening sale...
          </p>
        </div>
      </div>
    );
  }

  const started = formatStarted(sale?.created_at);
  // Units, not lines — stays visible while the search dropdown covers the cart.
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="h-full overflow-y-auto lg:overflow-hidden">
      <div className="min-h-full lg:h-full flex flex-col lg:flex-row gap-4 p-3 sm:p-4">
        {/*
          Left: scan + cart + payments. The cart flexes (scrolling inside
          when long); Payments below it keeps its natural height (up to 3
          rows, then it scrolls) and renders nothing before the first
          tender. < lg the same order stacks: Payments right after the cart.
        */}
        <section className="flex-1 min-w-0 min-h-0 flex flex-col gap-3">
          {status === "gone" && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
            >
              <AlertTriangle size={16} aria-hidden="true" />
              <span className="flex-1">
                This sale is no longer open — it was completed or discarded
                elsewhere.
              </span>
              <Button size="sm" variant="accent" label="Start a new sale" onClick={openSale} />
            </div>
          )}

          <ScanBar branchId={branchId} disabled={status !== "ready"} inputRef={scanRef} />

          {/* lg:min-h-40 leaves room for 3 payment rows at a ~640px viewport */}
          <Card className="flex-1 min-h-[16rem] lg:min-h-40 flex flex-col overflow-hidden">
            <CartLines onReturnFocus={returnFocus} />
          </Card>

          <PaymentsList onReturnFocus={returnFocus} />
        </section>

        {/*
          Right: sale + totals. ≥ lg the column has the viewport's height
          (Q23: judged at the real browser viewport, ~640px on a 1366×768
          laptop). Safety net: if it can't fit, the column scrolls and
          Totals (Pay / Ready) stays pinned at the bottom.
        */}
        <aside className="lg:w-[24rem] xl:w-[28rem] flex-shrink-0 flex flex-col gap-3 lg:gap-2 lg:min-h-0 lg:overflow-y-auto">
          <Card className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Current sale
                </p>
                <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200" data-testid="sale-meta">
                  Draft · {itemCount} {itemCount === 1 ? "item" : "items"}
                  {started ? ` · started ${started}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={FilePlus2}
                label="New sale"
                disabled={status !== "ready" || lines.length === 0}
                onClick={() => setConfirmNewSale(true)}
              />
            </div>
          </Card>

          <CustomerCard
            onAttach={() => setAttachOpen(true)}
            disabled={status !== "ready"}
          />

          <div data-testid="totals-dock" className="lg:sticky lg:bottom-0">
            <TotalsPanel
              onPay={() => openPayment(CASH)}
              onComplete={() => setCompleteOpen(true)}
            />
          </div>
        </aside>
      </div>

      <NewSaleDialog
        open={confirmNewSale}
        onClose={() => setConfirmNewSale(false)}
        onConfirm={startNewSale}
        itemCount={itemCount}
        // Deferred: Headless UI restores focus to the opener (New sale
        // button) after afterLeave; this runs after that.
        afterLeave={() => setTimeout(returnFocus, 0)}
      />

      <CustomerAttachDialog
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onAttached={() => {
          tradeInAttach.current.attached = true;
        }}
        afterLeave={afterAttachLeave}
      />

      <PaymentDialog
        open={paymentOpen}
        initialMethod={paymentMethod}
        onClose={() => setPaymentOpen(false)}
        onAttachCustomer={attachFromPayment}
        afterLeave={afterPaymentLeave}
      />

      <CompleteSaleDialog
        open={completeOpen}
        onClose={() => setCompleteOpen(false)}
        // Deferred: Headless UI restores focus to the opener after afterLeave.
        afterLeave={() => setTimeout(returnFocus, 0)}
      />
    </div>
  );
};

export default PosTerminal;
