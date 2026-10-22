import { useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Printer } from "lucide-react";
import Button from "../../components/common/Button";
import SaleDetailView from "../../components/pos/SaleDetailView";
import { getSale } from "../../services/salesService";
import { colomboToday } from "../../utils/colomboDay";
import { printReceipt } from "../../utils/printReceipt";

/**
 * SaleDetail Page
 *
 * Route: /pos/sales/:id, inside TerminalLayout (P6-1). A completed or
 * voided sale, read-only (SaleDetailView, P6-6), with Reprint (P6-7);
 * Void arrives in D2.
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
    if (printing || status !== "ready") return;
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
    [printing, status, requestKey],
  );

  if (status === "ready" && sale) {
    return (
      <SaleDetailView
        sale={sale}
        today={colomboToday()}
        onBack={backToList}
        actions={
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              icon={Printer}
              label="Reprint receipt"
              title="Reprint receipt (P)"
              loading={printing}
              onClick={reprint}
              fullWidth
            />
            {printError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {printError}
              </p>
            )}
          </div>
        }
      />
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
