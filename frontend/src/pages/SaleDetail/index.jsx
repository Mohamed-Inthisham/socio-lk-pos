import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useSelector } from "react-redux";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Ban, Printer, Undo2 } from "lucide-react";
import Button from "../../components/common/Button";
import SaleDetailView from "../../components/pos/SaleDetailView";
import ReturnDialog from "../../components/pos/ReturnDialog";
import VoidSaleDialog from "../../components/pos/VoidSaleDialog";
import { PERMISSIONS, hasPermission } from "../../constants/rolePermissions";
import { getSale } from "../../services/salesService";
import { colomboToday } from "../../utils/colomboDay";
import { printReceipt, printReturnSlip } from "../../utils/printReceipt";
import { returnableQuantity } from "../../utils/returnMath";

/**
 * SaleDetail Page
 *
 * Route: /pos/sales/:id, inside TerminalLayout (P6-1). A completed or
 * voided sale, read-only (SaleDetailView, P6-6), with Reprint (P6-7) and
 * Void (P6-8 – P6-13).
 *
 * VOID (V, or the button): COMPLETED sales only, every role (VOID_SALE;
 * the approver's PIN is the authority). VoidSaleDialog sends the void;
 * on success the page shows the voided sale it returns (banner, Reversed
 * tenders, no Void button) and focus goes to Reprint, so a void slip is
 * one P away (printed on request, P6-13). A VOIDED sale has no Void button.
 *
 * RETURN ITEMS (R, or the button; P7-16): COMPLETED sales with something
 * left to return, every role (REFUND_SALE; the approver's PIN is the
 * authority). Shown disabled once everything has come back; not on a
 * VOIDED sale. ReturnDialog makes the return; the page then shows the sale
 * the server answered with (new returned quantities) and, once the dialog
 * has closed, focus goes to Return items while something is left, else to
 * Reprint. After Cancel, Headless UI hands focus back to the button.
 *
 * RETURNS (P7-18): the Returns card lists them; Reprint slip re-reads the
 * sale, then prints both copies marked "REPRINT · <time>" (no hotkey: a
 * sale may have several). Once a sale has a return there is no Void
 * (P7-11): "Sales with returns can't be voided." in its place, and V does
 * nothing.
 *
 * REPRINT (P, or the button): re-fetches the sale first, so a sale voided
 * since the page opened prints as voided (and the page shows it), then
 * prints it marked "REPRINT · <time>". A failed fetch prints nothing.
 *
 * Esc (or Back) returns to the list as it was: the list passed
 * { search, pages, activeId } when it opened this sale, and gets it back
 * as `restore`. Opened directly (no list state), Back goes to today's
 * list.
 */

const dialogOpen = () => !!document.querySelector('[role="dialog"]');

/**
 * The tab the detail opens on (P7-18): Returns when the sale was opened
 * from a Recent sales search whose text is in one of its RET numbers (the
 * server's match, contains), else Items.
 */
const initialTabFor = (sale, fromSearch) => {
  const q = new URLSearchParams(fromSearch ?? "").get("q")?.trim().toUpperCase();
  if (!q || !q.startsWith("RET")) return "items";
  return (sale.returns ?? []).some((r) => r.return_number.toUpperCase().includes(q)) ? "returns" : "items";
};

const Card = ({ className = "", children }) => (
  <div
    className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm ${className}`}
  >
    {children}
  </div>
);

const SaleDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from ?? null;
  const [reloadKey, setReloadKey] = useState(0);
  // The answer for one request (`key`); any other reads as loading.
  const [result, setResult] = useState({ key: null, status: "loading", sale: null });
  const requestKey = `${id}#${reloadKey}`;
  const current = result.key === requestKey;
  const status = current ? result.status : "loading"; // loading | ready | not_found | error
  const sale = current ? result.sale : null;
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const justVoided = useRef(false);
  const justReturned = useRef(false);
  const reprintRef = useRef(null);
  const returnRef = useRef(null);
  const role = useSelector((state) => state.auth.user?.role);
  // A sale with a return can't be voided (P7-11): no Void button, V does nothing.
  const hasReturns = (sale?.returns?.length ?? 0) > 0;
  const canVoid = hasPermission(role, PERMISSIONS.VOID_SALE) && sale?.status === "COMPLETED" && !hasReturns;
  const [slipPrinting, setSlipPrinting] = useState(null); // the return whose slip is reprinting
  const [slipErrors, setSlipErrors] = useState({});
  const leftToReturn = sale?.lines?.reduce((sum, line) => sum + returnableQuantity(line), 0) ?? 0;
  const canReturn = hasPermission(role, PERMISSIONS.REFUND_SALE) && sale?.status === "COMPLETED" && leftToReturn > 0;

  useEffect(() => {
    let live = true;
    getSale(id)
      .then((data) => {
        if (live) setResult({ key: requestKey, status: "ready", sale: data });
      })
      .catch((error) => {
        if (!live) return;
        const notFound = error?.response?.status === 404;
        setResult({ key: requestKey, status: notFound ? "not_found" : "error", sale: null });
      });
    return () => {
      live = false;
    };
  }, [id, requestKey]);

  const backToList = () =>
    navigate(`/pos/sales${from?.search ?? ""}`, {
      state: from ? { restore: { pages: from.pages, activeId: from.activeId } } : undefined,
    });

  const reprint = async () => {
    if (printing || slipPrinting || status !== "ready") return;
    setPrinting(true);
    setPrintError(null);
    let fresh;
    try {
      fresh = await getSale(id);
    } catch {
      setPrintError("Couldn't load the sale. Nothing was printed.");
      setPrinting(false);
      return;
    }
    setResult({ key: requestKey, status: "ready", sale: fresh });
    try {
      await printReceipt(fresh, { reprintedAt: new Date().toISOString() });
    } catch {
      setPrintError("Couldn't print the receipt. Try again.");
    } finally {
      setPrinting(false);
    }
  };

  // Reprint a return's slip (P7-17, P7-18): re-read the sale first (as the
  // receipt's Reprint does), then both copies marked "REPRINT · <time>". A
  // failed re-read prints nothing.
  const reprintSlip = async (returnId) => {
    if (printing || slipPrinting) return;
    setSlipPrinting(returnId);
    setSlipErrors({});
    let fresh;
    try {
      fresh = await getSale(id);
    } catch {
      setSlipErrors({ [returnId]: "Couldn't load the sale. Nothing was printed." });
      setSlipPrinting(null);
      return;
    }
    setResult({ key: requestKey, status: "ready", sale: fresh });
    try {
      await printReturnSlip(fresh, returnId, { reprintedAt: new Date().toISOString() });
    } catch {
      setSlipErrors({ [returnId]: "Couldn't print the slip. Try again." });
    } finally {
      setSlipPrinting(null);
    }
  };

  useHotkeys(
    "esc",
    (e) => {
      if (dialogOpen()) return;
      e.preventDefault();
      backToList();
    },
    { enableOnFormTags: true },
    [from],
  );
  useHotkeys(
    "p",
    () => {
      if (!dialogOpen()) reprint();
    },
    { preventDefault: true },
    [printing, slipPrinting, status, requestKey],
  );
  useHotkeys(
    "v",
    () => {
      if (canVoid && !printing && !dialogOpen()) setVoidOpen(true);
    },
    { preventDefault: true },
    [canVoid, printing],
  );
  useHotkeys(
    "r",
    () => {
      if (canReturn && !printing && !dialogOpen()) setReturnOpen(true);
    },
    { preventDefault: true },
    [canReturn, printing],
  );

  const onVoided = (voided) => {
    justVoided.current = true;
    setResult({ key: requestKey, status: "ready", sale: voided });
    setVoidOpen(false);
  };

  // After a void, focus goes to Reprint (a void slip is one P away);
  // after Cancel, Headless UI returns it to the Void button.
  const afterVoidLeave = () => {
    if (!justVoided.current) return;
    justVoided.current = false;
    setTimeout(() => reprintRef.current?.focus(), 0);
  };

  // The sale a return answered with (or a re-read after a refusal): the
  // page shows the new returned quantities at once.
  const showSale = (fresh) => setResult({ key: requestKey, status: "ready", sale: fresh });

  const onReturned = (fresh) => {
    justReturned.current = true;
    showSale(fresh);
  };

  // After a return, focus goes back to Return items while something is
  // left to return, else to Reprint; after Cancel, Headless UI returns it
  // to the button.
  const afterReturnLeave = () => {
    if (!justReturned.current) return;
    justReturned.current = false;
    setTimeout(() => (canReturn ? returnRef.current : reprintRef.current)?.focus(), 0);
  };

  if (status === "ready" && sale) {
    return (
      <>
        <SaleDetailView
          sale={sale}
          today={colomboToday()}
          onBack={backToList}
          initialTab={initialTabFor(sale, from?.search)}
          returnActions={{
            onReprint: reprintSlip,
            reprinting: slipPrinting,
            errors: slipErrors,
            disabled: printing || !!slipPrinting,
          }}
          actions={
            <div className="flex flex-col gap-2">
              <Button
                ref={reprintRef}
                variant="secondary"
                icon={Printer}
                label="Reprint receipt"
                title="Reprint receipt (P)"
                loading={printing}
                onClick={reprint}
                fullWidth
              />
              {sale.status !== "VOIDED" && (
                <Button
                  ref={returnRef}
                  variant="secondary"
                  icon={Undo2}
                  label="Return items"
                  title={canReturn ? "Return items (R)" : "Everything on this sale has been returned"}
                  disabled={!canReturn || printing}
                  onClick={() => setReturnOpen(true)}
                  fullWidth
                />
              )}
              {sale.status !== "VOIDED" && hasReturns && (
                <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="no-void-note">
                  Sales with returns can&apos;t be voided.
                </p>
              )}
              {sale.status !== "VOIDED" && !hasReturns && (
                <Button
                  variant="danger"
                  icon={Ban}
                  label="Void sale"
                  title={canVoid ? "Void this sale (V)" : "Only completed sales can be voided"}
                  disabled={!canVoid || printing}
                  onClick={() => setVoidOpen(true)}
                  fullWidth
                />
              )}
              {printError && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {printError}
                </p>
              )}
            </div>
          }
        />
        {/* Mounted for any loaded sale: after a void the sale is VOIDED,
            and the dialog still has to play its leave (afterLeave hands
            focus to Reprint). Its content renders only while open. */}
        <VoidSaleDialog
          open={voidOpen}
          onClose={() => setVoidOpen(false)}
          sale={sale}
          onVoided={onVoided}
          afterLeave={afterVoidLeave}
        />
        <ReturnDialog
          open={returnOpen}
          onClose={() => setReturnOpen(false)}
          sale={sale}
          onReturned={onReturned}
          onSaleChanged={showSale}
          afterLeave={afterReturnLeave}
        />
      </>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4">
      <Button
        size="sm"
        variant="ghost"
        icon={ArrowLeft}
        label="Sales"
        title="Back to the sales list (Esc)"
        onClick={backToList}
      />

      <Card className="mt-3 max-w-xl p-5">
        {status === "loading" && (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading sale…</p>
        )}

        {status === "not_found" && (
          <p role="alert" className="text-sm text-slate-700 dark:text-slate-200">
            This sale no longer exists.
          </p>
        )}

        {status === "error" && (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-amber-800 dark:text-amber-200">
            <AlertTriangle size={16} aria-hidden="true" />
            <span className="flex-1">Couldn&apos;t load the sale.</span>
            <Button size="sm" variant="accent" label="Try again" onClick={() => setReloadKey((k) => k + 1)} />
          </div>
        )}
      </Card>
    </div>
  );
};

export default SaleDetail;
