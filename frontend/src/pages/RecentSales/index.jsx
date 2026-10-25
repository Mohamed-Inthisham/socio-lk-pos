import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import Button from "../../components/common/Button";
import Table from "../../components/common/Table";
import DayStepper from "../../components/pos/DayStepper";
import SaleStatusBadge from "../../components/pos/SaleStatusBadge";
import { saleListStatus } from "../../utils/returnMath";
import SalesSearchBox from "../../components/pos/SalesSearchBox";
import useTerminalBranch from "../../hooks/useTerminalBranch";
import { listSales } from "../../services/salesService";
import {
  colomboDayBounds,
  colomboToday,
  formatColomboDayLabel,
  shiftColomboDay,
} from "../../utils/colomboDay";
import { formatColomboTime } from "../../utils/colomboTime";
import { formatLKR } from "../../utils/money";
import { receiptDateTime } from "../../utils/receipt";

/**
 * RecentSales Page
 *
 * Route: /pos/sales, inside TerminalLayout (P6-1). The terminal branch's
 * COMPLETED and VOIDED sales for one Colombo day by completed_at, newest
 * first (P6-2), or a search across all dates (P6-3). Every role sees the
 * branch's sales (P6-4). Rows: time, sale number, customer, cashier,
 * total, and exactly one status badge: Completed, Part returned,
 * Returned or Voided (P6-5, P7-18); pages of 50 with Load more. A sale
 * with refunds shows "Refunded LKR X" under its total, which stays the
 * original; a search also finds RET- numbers (the server matches them).
 *
 * STATE IN THE URL: ?day=YYYY-MM-DD (none = today) and ?q=… (a committed
 * search), so the list comes back as it was after the detail page, and
 * survives a reload. Opening a sale passes { search, pages, activeId };
 * the detail page hands it back on Esc, and the list re-reads its rows
 * (P6-13): as many as were loaded, capped at the backend's 200, with the
 * same sale active (the first row when it's no longer among them).
 *
 * KEYS (P6-1 – P6-5): ↑/↓ move the active row and Enter opens it (also
 * from the search box); `/` focuses the search; ←/→ step the day (not
 * while typing); Esc clears a non-empty search box first, then goes back
 * to /pos. All ignored while a dialog is open.
 *
 * LAYOUT (P6-14): ≥ md the page never scrolls, the list scrolls inside
 * (sticky header, Load more at its end); < md the list is stacked cards
 * and the page scrolls.
 */

export const PAGE_SIZE = 50;
const MAX_LIMIT = 200; // GET /sales `limit` cap
const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

const dialogOpen = () => !!document.querySelector('[role="dialog"]');

/** ?day= when it's a real day, not after today; otherwise today. */
const validDay = (raw, today) => {
  if (!raw) return today;
  try {
    shiftColomboDay(raw, 0);
  } catch {
    return today;
  }
  return raw <= today ? raw : today;
};

/** Exactly one status badge per row: Completed, Part returned, Returned or Voided (P7-18). */
const StatusBadge = ({ row }) => <SaleStatusBadge state={saleListStatus(row)} />;

const RecentSales = ({ salesPath = "/pos/sales", exitPath = "/pos", exitLabel = "Terminal" }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { branchId } = useTerminalBranch();

  const today = colomboToday();
  const day = validDay(searchParams.get("day"), today);
  const q = (searchParams.get("q") ?? "").trim();
  const searching = q.length >= MIN_QUERY;

  const [input, setInput] = useState(q);
  const [reloadKey, setReloadKey] = useState(0);
  // The answer for one query (`key`); any other query reads as loading.
  const [result, setResult] = useState({ key: null, status: "loading", rows: [], total: 0 });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(null);
  const [activeId, setActiveId] = useState(null);

  const searchRef = useRef(null);
  const listRef = useRef(null);
  const requestSeq = useRef(0);
  const debounceTimer = useRef(null);
  // Handed back by the detail page; used by the first load only.
  const restore = useRef(location.state?.restore ?? null);

  const baseParams = useMemo(
    () =>
      searching
        ? { branchId, q, sort: "completed_at" }
        : { branchId, ...colomboDayBounds(day), sort: "completed_at" },
    [branchId, day, q, searching],
  );

  const queryKey = `${JSON.stringify(baseParams)}#${reloadKey}`;
  const current = result.key === queryKey;
  const status = current ? result.status : "loading"; // loading | ready | error
  const rows = current ? result.rows : [];
  const total = current ? result.total : 0;

  // First page (or the restored rows) whenever the query changes.
  useEffect(() => {
    if (!branchId) return;
    const seq = ++requestSeq.current;
    // Cleared once applied, not here: StrictMode runs this effect twice.
    const wanted = restore.current;
    const limit = wanted ? Math.min(Math.max(wanted.pages, 1) * PAGE_SIZE, MAX_LIMIT) : PAGE_SIZE;
    listSales({ ...baseParams, page: 1, limit })
      .then(({ data, meta }) => {
        if (seq !== requestSeq.current) return;
        restore.current = null;
        const keep = wanted && data.some((s) => s.id === wanted.activeId);
        setActiveId(keep ? wanted.activeId : (data[0]?.id ?? null));
        setLoadMoreError(null);
        setResult({ key: queryKey, status: "ready", rows: data, total: meta?.total ?? data.length });
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setResult({ key: queryKey, status: "error", rows: [], total: 0 });
      });
  }, [baseParams, branchId, queryKey]);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  useEffect(() => () => clearTimeout(debounceTimer.current), []);

  const hasMore = status === "ready" && rows.length < total;

  const loadMore = async () => {
    const seq = requestSeq.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = Math.floor(rows.length / PAGE_SIZE) + 1;
      const { data, meta } = await listSales({ ...baseParams, page, limit: PAGE_SIZE });
      if (seq !== requestSeq.current) return;
      setResult((prev) => {
        const seen = new Set(prev.rows.map((s) => s.id));
        return {
          ...prev,
          rows: [...prev.rows, ...data.filter((s) => !seen.has(s.id))],
          total: meta?.total ?? prev.total,
        };
      });
    } catch {
      if (seq === requestSeq.current) setLoadMoreError("Couldn't load more sales. Try again.");
    } finally {
      if (seq === requestSeq.current) setLoadingMore(false);
    }
  };

  const updateParams = useCallback(
    (changes) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  const commitSearch = useCallback(
    (value) => {
      const trimmed = value.trim();
      updateParams({ q: trimmed.length >= MIN_QUERY ? trimmed : null });
    },
    [updateParams],
  );

  const changeInput = (value) => {
    setInput(value);
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => commitSearch(value), DEBOUNCE_MS);
  };

  const clearSearch = () => {
    clearTimeout(debounceTimer.current);
    setInput("");
    commitSearch("");
  };

  const goToDay = (next) => updateParams({ day: next === today ? null : next });

  // A day chosen in the date picker: that day, and the end of any search.
  const pickDay = (next) => {
    if (next > today) return;
    clearTimeout(debounceTimer.current);
    setInput("");
    updateParams({ q: null, day: next === today ? null : next });
  };
  const stepDay = (delta) => {
    if (searching) return;
    const next = shiftColomboDay(day, delta);
    if (next <= today) goToDay(next);
  };

  const openSale = (id) => {
    if (!id) return;
    setActiveId(id);
    navigate(`${salesPath}/${id}`, {
      state: {
        from: {
          search: location.search,
          pages: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
          activeId: id,
        },
      },
    });
  };

  const moveActive = (delta) => {
    if (!rows.length) return;
    const index = rows.findIndex((s) => s.id === activeId);
    const next = Math.min(Math.max((index < 0 ? 0 : index) + delta, 0), rows.length - 1);
    setActiveId(rows[next].id);
  };

  const keyOptions = { enableOnFormTags: true, preventDefault: true };
  useHotkeys("down", () => !dialogOpen() && moveActive(1), keyOptions, [rows, activeId]);
  useHotkeys("up", () => !dialogOpen() && moveActive(-1), keyOptions, [rows, activeId]);
  useHotkeys(
    "enter",
    (e) => {
      // A focused button or link keeps its own Enter (Load more, Today, the
      // day label…), and so does the date picker's input.
      if (dialogOpen() || e.target.closest?.("button, a") || e.target.type === "date") return;
      e.preventDefault();
      openSale(activeId);
    },
    { enableOnFormTags: true },
    [activeId, location.search, rows, salesPath],
  );
  useHotkeys(
    "/",
    () => {
      if (!dialogOpen()) searchRef.current?.focus();
    },
    // By the character, not the key position: "/" sits elsewhere on some layouts.
    { preventDefault: true, useKey: true },
  );
  useHotkeys("left", () => !dialogOpen() && stepDay(-1), { preventDefault: true }, [day, searching, today]);
  useHotkeys("right", () => !dialogOpen() && stepDay(1), { preventDefault: true }, [day, searching, today]);
  useHotkeys(
    "esc",
    (e) => {
      if (dialogOpen()) return;
      // Esc in the date picker's input (where showPicker isn't supported)
      // leaves the input, not the page.
      if (e.target.type === "date") {
        e.target.blur();
        return;
      }
      e.preventDefault();
      if (e.target === searchRef.current && input) {
        clearSearch();
        return;
      }
      navigate(exitPath);
    },
    { enableOnFormTags: true },
    [exitPath, input],
  );

  const pendingShort = input.trim().length > 0 && input.trim().length < MIN_QUERY;
  const dayLabel = formatColomboDayLabel(day);
  // The count ("4 sales", "3 matches for …") shows as a highlighted pill;
  // the search hint and Loading… as plain text, in the same place.
  let countText = "";
  if (!pendingShort && status === "ready" && searching)
    countText = `${total} ${total === 1 ? "match" : "matches"} for “${q}”, all dates`;
  else if (!pendingShort && status === "ready") countText = `${total} ${total === 1 ? "sale" : "sales"}`;
  let statusText = countText;
  if (pendingShort) statusText = "Type 2 or more characters to search all dates";
  else if (status === "loading") statusText = "Loading…";

  const columns = [
    {
      key: "time",
      header: searching ? "Date" : "Time",
      secondary: true,
      render: (s) => (
        <span className="tabular-nums whitespace-nowrap">
          {searching ? receiptDateTime(s.completed_at) : formatColomboTime(s.completed_at)}
        </span>
      ),
    },
    {
      key: "sale_number",
      header: "Sale",
      primary: true,
      render: (s) => (
        <span className="flex items-center gap-2">
          <span className="font-semibold tabular-nums whitespace-nowrap text-slate-900 dark:text-slate-100">
            {s.sale_number}
          </span>
          <span className="md:hidden">
            <StatusBadge row={s} />
          </span>
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      // A customer row is the Customer entity: `name` (users have `full_name`).
      render: (s) =>
        s.customer ? (
          <span className="block max-w-52 md:max-w-96 truncate" title={s.customer.name}>
            {s.customer.name}
          </span>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">Walk-in</span>
        ),
    },
    {
      key: "cashier",
      header: "Cashier",
      render: (s) => (
        <span className="block max-w-52 md:max-w-72 truncate" title={s.cashier?.full_name}>
          {s.cashier?.full_name ?? "—"}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      // The original total always; what went back to the customer under it (P7-18).
      render: (s) => (
        <span className="inline-flex flex-col items-end">
          <span
            className={`tabular-nums whitespace-nowrap font-medium ${s.status === "VOIDED" ? "line-through text-slate-400 dark:text-slate-500" : ""}`}
          >
            {formatLKR(s.total)}
          </span>
          {Number(s.refunded_total) > 0 && (
            // The totals' own formatLKR: "Refunded LKR 5,490.00". 12px, not
            // 11px: at 11px the thousands comma reads like a dot on screen.
            <span className="text-xs tabular-nums whitespace-nowrap text-slate-500 dark:text-slate-400" data-testid="sale-refunded">
              Refunded {formatLKR(s.refunded_total)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      mobileHidden: true,
      render: (s) => <StatusBadge row={s} />,
    },
  ];

  const footer =
    hasMore || loadMoreError ? (
      <div className="flex flex-col items-center gap-1.5 p-3 border-t border-slate-200 dark:border-slate-700">
        {loadMoreError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {loadMoreError}
          </p>
        )}
        {hasMore && (
          <Button
            size="sm"
            variant="secondary"
            label={`Load more (${total - rows.length} more)`}
            loading={loadingMore}
            onClick={loadMore}
          />
        )}
      </div>
    ) : null;

  return (
    <div className="h-full overflow-y-auto md:overflow-hidden">
      <div className="min-h-full md:h-full flex flex-col gap-3 p-3 sm:p-4">
        <h1 className="sr-only">Recent sales</h1>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button
            size="sm"
            variant="ghost"
            icon={ArrowLeft}
            label={exitLabel}
            title={`Back to ${exitLabel.toLowerCase()} (Esc)`}
            onClick={() => navigate(exitPath)}
          />
          <DayStepper
            day={day}
            today={today}
            searching={searching}
            onStep={stepDay}
            onToday={() => goToDay(today)}
            onPick={pickDay}
          />
          <SalesSearchBox
            value={input}
            onChange={changeInput}
            inputRef={searchRef}
          />
          {/* The count, at the right of the toolbar: a highlighted pill
              ("4 sales", "3 matches for …"); the search hint and Loading…
              stay plain text. Never wraps: the search box gives up room. */}
          <p
            id="sales-status"
            aria-live="polite"
            data-testid="sales-count"
            className={`
              ml-auto shrink-0 whitespace-nowrap
              ${
                countText
                  ? "px-3 py-1 rounded-lg text-sm font-semibold tabular-nums bg-cyan-600 text-white dark:bg-cyan-500 dark:text-slate-950"
                  : "text-xs text-slate-500 dark:text-slate-400"
              }
            `}
          >
            {statusText}
          </p>
        </div>

        <div
          ref={listRef}
          tabIndex={-1}
          aria-label="Sales"
          className="flex-1 md:min-h-0 focus:outline-none"
        >
          {status === "error" ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
            >
              <AlertTriangle size={16} aria-hidden="true" />
              <span className="flex-1">Couldn&apos;t load the sales.</span>
              <Button size="sm" variant="accent" label="Try again" onClick={() => setReloadKey((k) => k + 1)} />
            </div>
          ) : (
            <Table
              columns={columns}
              data={rows}
              loading={status === "loading"}
              onRowClick={(s) => openSale(s.id)}
              activeKey={activeId}
              ariaLabel={searching ? "Search results" : `Sales on ${dayLabel}`}
              emptyMessage={searching ? `No sales match “${q}”` : `No sales on ${dayLabel}`}
              fill
              dense
              footer={footer}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default RecentSales;
