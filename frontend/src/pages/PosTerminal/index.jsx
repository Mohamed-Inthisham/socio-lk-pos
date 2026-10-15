import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useDispatch, useSelector } from "react-redux";
import { AlertTriangle, FilePlus2 } from "lucide-react";
import Button from "../../components/common/Button";
import CartLines from "../../components/pos/CartLines";
import CustomerAttachDialog from "../../components/pos/CustomerAttachDialog";
import CustomerCard from "../../components/pos/CustomerCard";
import NewSaleDialog from "../../components/pos/NewSaleDialog";
import ScanBar from "../../components/pos/ScanBar";
import TotalsPanel from "../../components/pos/TotalsPanel";
import useTerminalBranch from "../../hooks/useTerminalBranch";
import { isTouchOnly } from "../../utils/device";
import {
  discardDraftSale,
  ensureDraftSale,
  selectCartLines,
  selectDraftSale,
  selectPosError,
  selectPosStatus,
} from "../../store/slices/posTerminalSlice";

/**
 * PosTerminal Page
 *
 * Route: /pos. Opens (or resumes) the branch's DRAFT sale on mount and
 * lays out the terminal:
 * - ≥ lg: cart column left, sale/totals column right (Q23, 1366×768 target)
 * - < lg: single column, sale/totals stacked under the cart
 *
 * FOCUS (§6): the scan bar is the home position.
 * - F2 focuses it from anywhere (also from inputs); Esc does too when
 *   focus isn't in an input. Both are ignored while a dialog has focus —
 *   the dialog owns its keys.
 * - Automatic hand-offs (qty Enter, line delete, New sale dialog closed)
 *   return focus to it, except on touch-only devices where that would
 *   keep popping the on-screen keyboard. F2 / a tap always work.
 *
 * Phase 6.4 P1 builds this up: draft lifecycle → ScanBar → CartLines →
 * TotalsPanel; P2 adds the CustomerCard (+ CustomerAttachDialog) under
 * "Current sale". Payments (P3), trade-in (P4) and complete (P5) slot
 * into the right-hand column later.
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

const PosTerminal = () => {
  const dispatch = useDispatch();
  const scanRef = useRef(null);
  const { branchId } = useTerminalBranch();
  const status = useSelector(selectPosStatus);
  const error = useSelector(selectPosError);
  const sale = useSelector(selectDraftSale);
  const lines = useSelector(selectCartLines);
  const [confirmNewSale, setConfirmNewSale] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);

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
        {/* Left: scan + cart */}
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

          <Card className="flex-1 min-h-[16rem] flex flex-col overflow-hidden">
            <CartLines onReturnFocus={returnFocus} />
          </Card>
        </section>

        {/* Right: sale + totals */}
        <aside className="lg:w-[24rem] xl:w-[28rem] flex-shrink-0 flex flex-col gap-3">
          <Card className="p-4">
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

          <TotalsPanel />
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
        afterLeave={() => setTimeout(returnFocus, 0)}
      />
    </div>
  );
};

export default PosTerminal;
