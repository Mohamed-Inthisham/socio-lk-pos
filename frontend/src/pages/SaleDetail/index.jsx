import { useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import Button from "../../components/common/Button";
import { getSale } from "../../services/salesService";
import { formatLKR } from "../../utils/money";
import { receiptDateTime } from "../../utils/receipt";

/**
 * SaleDetail Page
 *
 * Route: /pos/sales/:id, inside TerminalLayout (P6-1). Step B ships the
 * route with a minimal summary (sale number, status, completion time,
 * total); step C replaces the body with SaleDetailView (P6-6), Reprint
 * and, in D2, Void.
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

        {status === "ready" && sale && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tabular-nums">{sale.sale_number ?? "Draft sale"}</h1>
              {sale.status === "VOIDED" ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wider bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
                  Voided
                </span>
              ) : (
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {sale.status === "COMPLETED" ? "Completed" : sale.status}
                </span>
              )}
            </div>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-slate-500 dark:text-slate-400">Completed</dt>
              <dd data-testid="sale-completed-at">{receiptDateTime(sale.completed_at) || "—"}</dd>
              <dt className="text-slate-500 dark:text-slate-400">Total</dt>
              <dd className="font-semibold tabular-nums">{formatLKR(sale.total)}</dd>
            </dl>
          </>
        )}
      </Card>
    </div>
  );
};

export default SaleDetail;
