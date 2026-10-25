import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Banknote, CalendarDays, CircleDollarSign, PackageCheck, ReceiptText } from "lucide-react";
import useTerminalBranch from "../../hooks/useTerminalBranch";
import { getDailySalesSummary } from "../../services/salesService";
import { colomboToday, formatColomboDayLabel } from "../../utils/colomboDay";
import { formatLKR } from "../../utils/money";

const tiles = [
  { key: "sales_count", title: "Today’s sales", caption: "Completed sales", icon: ReceiptText, format: (v) => Number(v).toLocaleString() },
  { key: "sales_amount", title: "Sales amount", caption: "Completed sale totals", icon: CircleDollarSign, format: formatLKR },
  { key: "quantity_count", title: "Items sold", caption: "Total item quantity", icon: PackageCheck, format: (v) => Number(v).toLocaleString() },
  { key: "cost_of_sales", title: "Cost of sales", caption: "Cost of sold items", icon: Banknote, format: formatLKR },
];

export default function SalesOverview() {
  const { branchId } = useTerminalBranch();
  const date = colomboToday();
  const [state, setState] = useState({ status: "loading", summary: null });

  useEffect(() => {
    if (!branchId) return;
    let current = true;
    setState({ status: "loading", summary: null });
    getDailySalesSummary({ branchId, date })
      .then((summary) => current && setState({ status: "ready", summary }))
      .catch(() => current && setState({ status: "error", summary: null }));
    return () => { current = false; };
  }, [branchId, date]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"><CalendarDays size={16} aria-hidden="true" />{formatColomboDayLabel(date)}</p>
          <h1 className="mt-1 text-2xl font-semibold">Sales overview</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Today’s completed sales for this branch.</p>
        </div>
        <Link to="/sales/history" className="inline-flex h-10 items-center gap-2 rounded-lg bg-cyan-600 px-4 text-sm font-semibold text-white hover:bg-cyan-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
          See all sales <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </header>

      {state.status === "error" ? (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">Couldn’t load today’s sales summary. Refresh to try again.</div>
      ) : (
        <section aria-label="Today's sales summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map(({ key, title, caption, icon: Icon, format }) => (
            <article key={key} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</span>
                <span className="rounded-lg bg-cyan-50 p-2 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300"><Icon size={18} aria-hidden="true" /></span>
              </div>
              <p className="mt-5 text-2xl font-semibold tabular-nums" aria-live={key === "sales_count" ? "polite" : undefined}>
                {state.status === "loading" ? <span className="text-slate-400">—</span> : format(state.summary[key])}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{caption}</p>
            </article>
          ))}
        </section>
      )}
      {state.status === "loading" && <p role="status" className="sr-only">Loading today’s sales summary</p>}
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"><ReceiptText size={16} aria-hidden="true" />Sales history is available for every recorded date.</div>
    </div>
  );
}
