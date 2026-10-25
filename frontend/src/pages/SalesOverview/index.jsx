import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Banknote, CalendarDays, CircleDollarSign, PackageCheck, ReceiptText } from "lucide-react";
import Select from "../../components/common/Select";
import useTerminalBranch from "../../hooks/useTerminalBranch";
import { getDailySalesSummary } from "../../services/salesService";
import { colomboToday, formatColomboDayLabel, shiftColomboDay } from "../../utils/colomboDay";
import { formatLKR } from "../../utils/money";

const periods = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["last-3-days", "Last 3 days"],
  ["this-week", "This week"], ["last-week", "Last week"], ["last-2-weeks", "Last 2 weeks"],
  ["this-month", "This month"], ["last-month", "Last month"], ["last-3-months", "Last 3 months"],
  ["last-6-months", "Last 6 months"], ["this-year", "This year"], ["last-year", "Last year"],
];
const periodKeys = new Set(periods.map(([key]) => key));

const shiftMonths = (day, amount) => {
  const [year, month, date] = day.split("-").map(Number);
  const firstTargetMonth = new Date(Date.UTC(year, month - 1 + amount, 1));
  const lastDate = new Date(Date.UTC(firstTargetMonth.getUTCFullYear(), firstTargetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  const clampedDate = Math.min(date, lastDate);
  return `${String(firstTargetMonth.getUTCFullYear()).padStart(4, "0")}-${String(firstTargetMonth.getUTCMonth() + 1).padStart(2, "0")}-${String(clampedDate).padStart(2, "0")}`;
};

const monthStart = (day) => `${day.slice(0, 7)}-01`;
const yearStart = (day) => `${day.slice(0, 4)}-01-01`;
const mondayOfWeek = (day) => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return shiftColomboDay(day, -(weekday === 0 ? 6 : weekday - 1));
};

export const rangeForPeriod = (period, today) => {
  switch (period) {
    case "yesterday": return { from: shiftColomboDay(today, -1), to: shiftColomboDay(today, -1) };
    case "last-3-days": return { from: shiftColomboDay(today, -2), to: today };
    case "this-week": return { from: mondayOfWeek(today), to: today };
    case "last-week": {
      const end = shiftColomboDay(mondayOfWeek(today), -1);
      return { from: shiftColomboDay(end, -6), to: end };
    }
    case "last-2-weeks": return { from: shiftColomboDay(today, -13), to: today };
    case "this-month": return { from: monthStart(today), to: today };
    case "last-month": {
      const end = shiftColomboDay(monthStart(today), -1);
      return { from: monthStart(end), to: end };
    }
    case "last-3-months": return { from: shiftMonths(today, -3), to: today };
    case "last-6-months": return { from: shiftMonths(today, -6), to: today };
    case "this-year": return { from: yearStart(today), to: today };
    case "last-year": return { from: `${Number(today.slice(0, 4)) - 1}-01-01`, to: `${Number(today.slice(0, 4)) - 1}-12-31` };
    default: return { from: today, to: today };
  }
};

const tiles = [
  { key: "sales_count", title: "Sales count", caption: "Completed sales", icon: ReceiptText, format: (v) => Number(v).toLocaleString() },
  { key: "sales_amount", title: "Sales amount", caption: "Completed sale totals", icon: CircleDollarSign, format: formatLKR },
  { key: "quantity_count", title: "Items sold", caption: "Total item quantity", icon: PackageCheck, format: (v) => Number(v).toLocaleString() },
  { key: "cost_of_sales", title: "Cost of sales", caption: "Cost of sold items", icon: Banknote, format: formatLKR },
  { key: "return_count", title: "Return sales count", caption: "Return transactions", icon: ReceiptText, format: (v) => Number(v).toLocaleString() },
  { key: "return_quantity", title: "Return sales quantity", caption: "Items returned", icon: PackageCheck, format: (v) => Number(v).toLocaleString() },
  { key: "voided_count", title: "Voided sales count", caption: "Sales voided", icon: ReceiptText, format: (v) => Number(v).toLocaleString() },
];

const pickerClass = "h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 scheme-light dark:scheme-dark";

export default function SalesOverview() {
  const { branchId } = useTerminalBranch();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = colomboToday();
  const periodParam = searchParams.get("period");
  const singleDate = searchParams.get("date");
  const period = periodKeys.has(periodParam) ? periodParam : "today";
  const range = useMemo(() => {
    if (singleDate) {
      try {
        if (singleDate <= today && shiftColomboDay(singleDate, 0) === singleDate) return { from: singleDate, to: singleDate };
      } catch { /* Invalid URL dates fall back to the selected preset. */ }
    }
    return rangeForPeriod(period, today);
  }, [period, singleDate, today]);
  const isSingleDate = range.from === range.to;
  const selectedPeriod = singleDate && isSingleDate ? "custom" : period;
  const rangeLabel = isSingleDate
    ? formatColomboDayLabel(range.from)
    : `${formatColomboDayLabel(range.from)} – ${formatColomboDayLabel(range.to)}`;
  const [state, setState] = useState({ status: "loading", summary: null });

  useEffect(() => {
    if (!branchId) return;
    let current = true;
    setState({ status: "loading", summary: null });
    getDailySalesSummary({ branchId, from: range.from, to: range.to })
      .then((summary) => current && setState({ status: "ready", summary }))
      .catch(() => current && setState({ status: "error", summary: null }));
    return () => { current = false; };
  }, [branchId, range.from, range.to]);

  const pickPeriod = (value) => setSearchParams(value === "today" ? {} : { period: value });
  const pickDate = (value) => {
    if (!value) return;
    setSearchParams(value <= today ? { date: value } : {});
  };
  const pickerValue = isSingleDate ? range.from : "";
  const periodTitle = selectedPeriod === "custom" ? "Selected date" : periods.find(([key]) => key === selectedPeriod)?.[1] ?? "Today";

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"><CalendarDays size={16} aria-hidden="true" />{rangeLabel}</p>
          <h1 className="mt-1 text-2xl font-semibold">Sales overview</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{periodTitle} completed sales for this branch.</p>
        </div>
        <Link to="/sales/history" className="inline-flex h-10 items-center gap-2 rounded-lg bg-cyan-600 px-4 text-sm font-semibold text-white hover:bg-cyan-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
          See all sales <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </header>

      <section aria-label="Sales date range" className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 sm:items-end">
        <Select
          label="Period"
          value={selectedPeriod}
          onChange={(event) => pickPeriod(event.target.value)}
          options={[
            ...periods.map(([value, label]) => ({ value, label })),
            ...(selectedPeriod === "custom" ? [{ value: "custom", label: "Selected date" }] : []),
          ]}
          className="w-full"
        />
        <label className="flex w-full flex-col gap-1.5 text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Or choose a date
          <input aria-label="Choose sales date" className={`${pickerClass} w-full`} type="date" max={today} value={pickerValue} onChange={(event) => pickDate(event.target.value)} />
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">Weeks start Monday. Rolling periods include today.</p>
      </section>

      {state.status === "error" ? (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">Couldn’t load the sales summary for this period. Refresh to try again.</div>
      ) : (
        <section aria-label="Sales summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map(({ key, title, caption, icon: Icon, format }) => (
            <article key={key} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</span>
                <span className="rounded-lg bg-cyan-50 p-2 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300"><Icon size={18} aria-hidden="true" /></span>
              </div>
              <p className="mt-5 text-2xl font-semibold tabular-nums">{state.status === "loading" ? <span className="text-slate-400">—</span> : format(state.summary[key])}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{caption}</p>
            </article>
          ))}
        </section>
      )}
      {state.status === "loading" && <p role="status" className="sr-only">Loading sales summary</p>}
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"><ReceiptText size={16} aria-hidden="true" />Sales history is available for every recorded date.</div>
    </div>
  );
}
