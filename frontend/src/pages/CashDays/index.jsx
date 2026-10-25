import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { ArrowLeft, CalendarDays, ChevronRight } from "lucide-react";
import Button from "../../components/common/Button";
import CashDayFigures from "../../components/pos/CashDayFigures";
import useTerminalBranch from "../../hooks/useTerminalBranch";
import { fetchPastDays, selectPastDays } from "../../store/slices/cashDaySlice";
import { cashDayErrorView } from "../../utils/cashDayErrors";
import { describeDifferenceForDisplay } from "../../utils/cashDayMath";
import { formatColomboDayLabel } from "../../utils/colomboDay";
import { formatColomboTime } from "../../utils/colomboTime";
import { getCashDay, getCashDaySummary } from "../../services/cashDaysService";
import { formatLKR, toCents } from "../../utils/money";

const panelClass = "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900";
const linkClass = "text-cyan-700 dark:text-cyan-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded";

const CashDaySummaryDetails = ({ summary }) => {
  if (!summary) return null;
  const tenderGroups = [
    ["Non-cash sales", summary.non_cash_sales],
    ["Non-cash refunds", summary.non_cash_refunds],
    ["Earlier voids (non-cash)", summary.earlier_voids_non_cash],
  ];
  const counts = summary.counts;

  return (
    <section className={`${panelClass} p-4 sm:p-5`} aria-labelledby="cash-day-breakdown-heading">
      <h2 id="cash-day-breakdown-heading" className="font-semibold">Day activity</h2>
      {counts && (
        <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-slate-500 dark:text-slate-400">Sales</dt><dd className="mt-1 font-medium tabular-nums">{counts.sales_completed}</dd></div>
          <div><dt className="text-slate-500 dark:text-slate-400">Returns</dt><dd className="mt-1 font-medium tabular-nums">{counts.returns}</dd></div>
          <div><dt className="text-slate-500 dark:text-slate-400">Voids</dt><dd className="mt-1 font-medium tabular-nums">{counts.voids}</dd></div>
        </dl>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {tenderGroups.map(([title, amounts]) => amounts && (
          <div key={title}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
            <dl className="mt-2 space-y-1 text-sm">
              {Object.entries(amounts).map(([method, amount]) => (
                <div key={method} className="flex justify-between gap-3">
                  <dt className="text-slate-600 dark:text-slate-400">{method.replaceAll("_", " ")}</dt>
                  <dd className="tabular-nums">{formatLKR(amount)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      {Number(summary.trade_in_value) > 0 && (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
          Trade-in value <span className="ml-2 font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatLKR(summary.trade_in_value)}</span>
        </p>
      )}
    </section>
  );
};

const CashDayDetail = ({ id }) => {
  const [result, setResult] = useState({ status: "loading", day: null, figures: null, error: null });

  useEffect(() => {
    let live = true;
    setResult({ status: "loading", day: null, figures: null, error: null });
    Promise.all([getCashDay(id), getCashDaySummary(id)])
      .then(([day, figures]) => {
        if (live) setResult({ status: "ready", day, figures, error: null });
      })
      .catch(() => {
        if (live) setResult({ status: "error", day: null, figures: null, error: "Couldn't load this cash day. Try again." });
      });
    return () => { live = false; };
  }, [id]);

  if (result.status === "loading") {
    return <p role="status" className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading cash day…</p>;
  }
  if (result.status === "error") {
    return <div className="p-4"><p role="alert" className="text-sm text-red-600 dark:text-red-400">{result.error}</p></div>;
  }

  const { day, figures } = result;
  const closed = !!day.closed_at;
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <Link to="/cash-days" className={`${linkClass} inline-flex items-center gap-2 text-sm`}>
        <ArrowLeft size={16} aria-hidden="true" /> All cash days
      </Link>
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{formatColomboDayLabel(day.business_date)}</h1>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${closed ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"}`}>
            {closed ? "Closed" : "Open"}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Opened at {formatColomboTime(day.opened_at)} by {day.opened_by?.full_name ?? "Unknown"}
          {closed && ` · closed at ${formatColomboTime(day.closed_at)} by ${day.closed_by?.full_name ?? "Unknown"}`}
        </p>
      </header>

      <section className={`${panelClass} p-4 sm:p-5`} aria-label="Cash figures">
        <CashDayFigures
          figures={figures}
          countedText={closed ? day.counted_balance : null}
          differenceCents={closed ? toCents(day.difference) : NaN}
        />
        {closed && day.difference_reason && (
          <p className="mt-3 text-sm"><span className="text-slate-500 dark:text-slate-400">Difference reason: </span>{day.difference_reason}</p>
        )}
      </section>
      <CashDaySummaryDetails summary={figures.summary} />
      {closed && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Saved closing difference: <span className="font-medium text-slate-900 dark:text-slate-100">{describeDifferenceForDisplay(toCents(day.difference))}</span>
        </p>
      )}
    </div>
  );
};

const CashDays = () => {
  const { id } = useParams();
  const dispatch = useDispatch();
  const { branchId } = useTerminalBranch();
  const pastDays = useSelector(selectPastDays);

  useEffect(() => {
    if (branchId) dispatch(fetchPastDays({ branchId, page: 1 }));
  }, [branchId, dispatch]);

  if (id) return <CashDayDetail key={id} id={id} />;

  const days = pastDays.items;
  const error = pastDays.error ? cashDayErrorView(pastDays.error).message : null;
  const loadMore = () => dispatch(fetchPastDays({ branchId, page: (pastDays.meta?.page ?? 1) + 1 }));

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <header className="flex items-start gap-3">
        <CalendarDays size={22} className="mt-0.5 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-semibold">Cash days</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Opening, closing, and saved cash figures for this branch.</p>
        </div>
      </header>

      {pastDays.status === "loading" && days.length === 0 && (
        <p role="status" className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading cash days…</p>
      )}
      {pastDays.status === "error" && (
        <div className={`${panelClass} p-4`}>
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <Button className="mt-3" size="sm" variant="secondary" label="Try again" onClick={() => dispatch(fetchPastDays({ branchId, page: 1 }))} />
        </div>
      )}
      {pastDays.status === "ready" && days.length === 0 && (
        <div className={`${panelClass} p-6 text-center text-sm text-slate-500 dark:text-slate-400`}>No cash days have been recorded for this branch yet.</div>
      )}

      {days.length > 0 && (
        <div className="space-y-2">
          {days.map((day) => (
            <Link key={day.id} to={`/cash-days/${day.id}`} className={`${panelClass} flex flex-wrap items-center gap-x-5 gap-y-2 p-4 transition-colors hover:border-cyan-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500`}>
              <span className="min-w-36 font-medium">{formatColomboDayLabel(day.business_date)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${day.closed_at ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"}`}>
                {day.closed_at ? "Closed" : "Open"}
              </span>
              <span className="text-sm text-slate-600 dark:text-slate-400">Opening <span className="text-slate-900 dark:text-slate-100">{formatLKR(day.opening_balance)}</span></span>
              {day.expected_balance != null && <span className="text-sm text-slate-600 dark:text-slate-400">Expected <span className="text-slate-900 dark:text-slate-100">{formatLKR(day.expected_balance)}</span></span>}
              {day.counted_balance != null && <span className="text-sm text-slate-600 dark:text-slate-400">Counted <span className="text-slate-900 dark:text-slate-100">{formatLKR(day.counted_balance)}</span></span>}
              {day.difference != null && <span className="text-sm text-slate-600 dark:text-slate-400">Difference <span className="text-slate-900 dark:text-slate-100">{describeDifferenceForDisplay(toCents(day.difference))}</span></span>}
              {day.closed_by?.full_name && <span className="text-sm text-slate-600 dark:text-slate-400">Closed by <span className="text-slate-900 dark:text-slate-100">{day.closed_by.full_name}</span></span>}
              <span className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-cyan-700 dark:text-cyan-300">Details <ChevronRight size={16} aria-hidden="true" /></span>
            </Link>
          ))}
        </div>
      )}
      {pastDays.meta?.hasNext && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" label="Load more" loading={pastDays.status === "loading"} onClick={loadMore} />
        </div>
      )}
    </div>
  );
};

export default CashDays;
