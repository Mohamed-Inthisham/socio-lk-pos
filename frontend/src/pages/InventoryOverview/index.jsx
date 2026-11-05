import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import Button from "../../components/common/Button";
import Dialog from "../../components/common/Dialog";
import InputField from "../../components/common/InputField";
import Select from "../../components/common/Select";
import Table from "../../components/common/Table";
import StockStatusBadge from "../../components/inventory/StockStatusBadge";
import { STOCK_STATUS_LABELS, STOCK_STATUS_OPTIONS } from "../../constants/stockStatus";
import usePermissions from "../../hooks/usePermissions";
import { listBranches } from "../../services/branchesService";
import { getStockOverview } from "../../services/stockService";
import { selectActiveBranches } from "../../store/slices/branchesSlice";
import { formatLKR } from "../../utils/money";

/**
 * InventoryOverview Page
 *
 * One row per product with its stock (GET /stock/overview): every branch for
 * an admin, their own branch for a manager, who sends no branchId and gets
 * only that from the backend. Read-only. A product's name opens that product.
 *
 * A QUANTITY product has no identified units, and a NOT_TRACKED product has
 * no quantity: both show a dash, never a zero.
 *
 * A row's Branches button opens its stock per branch, for admins: a manager
 * has only the one. Next to the button is how many branches are low or out,
 * since the combined status can look fine while one branch is short.
 *
 * The cards and the heading's count are the backend's (summary, meta): they
 * cover every page, and the cards ignore the status filter, so they read as
 * the breakdown of what the other filters selected. After a failed load they
 * go blank, since the last figures would describe other filters.
 *
 * THE URL holds the filters and page (search, stockStatus, branchId,
 * includeInactive, page). A value that isn't valid reads as the default;
 * defaults stay out of the URL. includeInactive is still sent to the API when
 * false. A page past the end moves to the last page.
 *
 * Admins filter by branch, inactive ones included, since All branches counts
 * their stock; a manager has no picker and any branchId in the URL is ignored.
 * A branch in the URL waits for the branch list: one that isn't on it leaves
 * the URL and is never requested.
 *
 * The response has no buying or cost price, and this page shows none.
 */

const PAGE_SIZE = 25;
const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;
const MAX_QUERY = 100;
const panel = "rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";
const SHORT_STATUSES = ["LOW_STOCK", "OUT_OF_STOCK"];
const TRACKING_LABELS = { QUANTITY: "Quantity", IMEI: "IMEI", SERIAL_NUMBER: "Serial number" };
const SUMMARY_CARDS = [
  { key: "total_products", label: "Total products" },
  { key: "in_stock", label: "In stock" },
  { key: "low_stock", label: "Low stock", tone: "text-amber-800 dark:text-amber-200" },
  { key: "out_of_stock", label: "Out of stock", tone: "text-red-800 dark:text-red-200" },
  { key: "not_tracked", label: "Not tracked" },
  { key: "total_quantity", label: "Total quantity" },
];

const Dash = () => <span className="text-slate-400">—</span>;

const SummaryCards = ({ summary, busy }) => (
  <dl aria-busy={busy} className={`grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6 ${busy ? "opacity-60" : ""}`}>
    {SUMMARY_CARDS.map(({ key, label, tone = "text-slate-900 dark:text-slate-100" }) => (
      <div key={key} className={`${panel} p-4`}>
        <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
        <dd className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{summary?.[key] ?? "—"}</dd>
      </div>
    ))}
  </dl>
);

const Product = ({ row }) => (
  <div>
    <div className="font-medium text-slate-900 dark:text-slate-100">
      <Link to={`/products/${row.id}`} className="hover:text-cyan-700 hover:underline dark:hover:text-cyan-300">{row.name}</Link>
      {!row.is_active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">Inactive</span>}
    </div>
    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
      <span className="font-mono">{row.sku}</span> · {TRACKING_LABELS[row.tracking_method] ?? row.tracking_method}
    </div>
  </div>
);

const Quantity = ({ row }) =>
  row.quantity === null ? <Dash /> : (
    <div>
      <div className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{row.quantity}</div>
      <div className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">Min {row.min_quantity}</div>
    </div>
  );

const Units = ({ units }) =>
  units === null ? <Dash /> : (
    <div className="whitespace-nowrap tabular-nums">
      <div>{units.in_stock} in stock</div>
      {units.inspection > 0 && <div className="text-xs text-amber-700 dark:text-amber-300">{units.inspection} in inspection</div>}
    </div>
  );

const Branches = ({ row, onOpen }) => {
  const count = row.branches.length;
  if (count === 0) return <Dash />;
  const short = row.branches.filter((branch) => SHORT_STATUSES.includes(branch.stock_status)).length;
  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        label={count === 1 ? "1 branch" : `${count} branches`}
        aria-label={`Branches for ${row.name}`}
        onClick={() => onOpen(row)}
      />
      {short > 0 && <div className="mt-1 whitespace-nowrap text-xs text-amber-700 dark:text-amber-300">{short} low or out</div>}
    </div>
  );
};

const BranchStock = ({ branch }) => (
  <li className="flex items-center justify-between gap-3 py-3">
    <div className="min-w-0">
      <div className="font-medium text-slate-900 dark:text-slate-100">{branch.name}</div>
      {!branch.is_active && <div className="text-xs text-slate-500 dark:text-slate-400">Inactive branch</div>}
    </div>
    <div className="flex shrink-0 items-center gap-3">
      {branch.quantity !== null && (
        <span className="text-right text-sm tabular-nums text-slate-700 dark:text-slate-200">
          {branch.quantity} <span className="text-xs text-slate-500 dark:text-slate-400">/ min {branch.min_quantity}</span>
        </span>
      )}
      <StockStatusBadge status={branch.stock_status} />
    </div>
  </li>
);

export default function InventoryOverview() {
  const { isAdmin } = usePermissions();
  const activeBranches = useSelector(selectActiveBranches);
  const [searchParams, setSearchParams] = useSearchParams();

  // The app's list holds active branches only, so admins load their own.
  const [branchList, setBranchList] = useState({ status: "loading", branches: [] });
  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    listBranches({ includeInactive: true })
      .then((branches) => { if (!cancelled) setBranchList({ status: "ready", branches }); })
      .catch(() => { if (!cancelled) setBranchList({ status: "failed", branches: [] }); });
    return () => { cancelled = true; };
  }, [isAdmin]);

  const searchParam = (searchParams.get("search") ?? "").trim();
  const statusParam = searchParams.get("stockStatus") ?? "";
  const stockStatus = Object.hasOwn(STOCK_STATUS_LABELS, statusParam) ? statusParam : "";
  const branchParam = searchParams.get("branchId") ?? "";
  const adminBranch = isAdmin ? branchParam : "";
  // A branch in the URL is checked before it's asked for. If the list failed
  // it can't be: the backend judges it, so the view never widens unasked.
  const unknownBranch = !!adminBranch && branchList.status === "ready"
    && !branchList.branches.some((branch) => branch.id === adminBranch);
  const branchPending = unknownBranch || (!!adminBranch && branchList.status === "loading");
  const branchId = unknownBranch ? "" : adminBranch;
  const includeInactive = searchParams.get("includeInactive") === "true";
  const pageParam = Number(searchParams.get("page"));
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
  const query = searchParam.length >= MIN_QUERY && searchParam.length <= MAX_QUERY ? searchParam : "";

  const [searchText, setSearchText] = useState(searchParam);
  const debounceTimer = useRef(null);
  // The search this page last wrote. Anything else came from outside: only
  // then does the box follow the URL, or it would rewrite what's being typed.
  const committedSearch = useRef(searchParam);
  useEffect(() => {
    if (searchParam === committedSearch.current) return;
    committedSearch.current = searchParam;
    clearTimeout(debounceTimer.current);
    setSearchText(searchParam);
  }, [searchParam]);
  useEffect(() => () => clearTimeout(debounceTimer.current), []);

  // Every write starts from the URL as it is now. setSearchParams' own prev is
  // the render it came from, so a waiting search would overwrite a branch
  // picked in the meantime.
  const latestParams = useRef(searchParams);
  useLayoutEffect(() => {
    latestParams.current = searchParams;
  }, [searchParams]);
  const updateParams = useCallback((changes) => {
    const next = new URLSearchParams(latestParams.current);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    latestParams.current = next;
    setSearchParams(next, { replace: true });
  }, [setSearchParams]);
  const changeFilter = (field, value) => updateParams({ [field]: value, page: "" });
  const goToPage = useCallback((next) => updateParams({ page: next > 1 ? String(next) : "" }), [updateParams]);

  const [result, setResult] = useState({ status: "loading", rows: [], total: null, summary: null, pages: 1, error: "" });
  const [branchesOf, setBranchesOf] = useState(null);
  // The latest request, so a slow older answer can't overwrite a newer one.
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setResult((current) => ({ ...current, status: "loading", error: "" }));
    if (branchPending) return;
    getStockOverview({ page, limit: PAGE_SIZE, includeInactive, branchId, search: query, stockStatus })
      .then(({ data, summary, meta }) => {
        if (requestId !== requestIdRef.current) return;
        const pages = Math.max(1, meta.totalPages);
        setResult({ status: "ready", rows: data, total: meta.total, summary, pages, error: "" });
        if (page > pages) goToPage(pages);
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setResult({ status: "error", rows: [], total: null, summary: null, pages: 1, error: "Couldn’t load the inventory overview. Try again." });
      });
  }, [page, includeInactive, branchId, branchPending, query, stockStatus, goToPage]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // As a filter change would: the page was a page of that branch.
  useEffect(() => {
    if (unknownBranch) updateParams({ branchId: "", page: "" });
  }, [unknownBranch, updateParams]);

  const commitSearch = (value) => {
    const trimmed = value.trim();
    const next = trimmed.length >= MIN_QUERY ? trimmed : "";
    if (next === committedSearch.current) return;
    committedSearch.current = next;
    changeFilter("search", next);
  };
  const changeSearch = (value) => {
    setSearchText(value);
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => commitSearch(value), DEBOUNCE_MS);
  };
  const submitSearch = (event) => {
    event.preventDefault();
    clearTimeout(debounceTimer.current);
    commitSearch(searchText);
  };
  const clearFilters = () => {
    clearTimeout(debounceTimer.current);
    setSearchText("");
    committedSearch.current = "";
    updateParams({ search: "", stockStatus: "", branchId: "", includeInactive: "", page: "" });
  };

  const columns = useMemo(() => [
    { key: "product", header: "Product", primary: true, render: (row) => <Product row={row} /> },
    {
      key: "selling_price",
      header: "Selling price",
      align: "right",
      render: (row) => <span className="whitespace-nowrap tabular-nums">{formatLKR(row.selling_price)}</span>,
    },
    { key: "stock_status", header: "Status", render: (row) => <StockStatusBadge status={row.stock_status} /> },
    { key: "quantity", header: "Quantity", align: "right", render: (row) => <Quantity row={row} /> },
    { key: "units", header: "Identified units", render: (row) => <Units units={row.units} /> },
    ...(isAdmin ? [{ key: "branches", header: "Branches", render: (row) => <Branches row={row} onOpen={setBranchesOf} /> }] : []),
  ], [isAdmin]);

  const pendingShort = searchText.trim().length > 0 && searchText.trim().length < MIN_QUERY;
  const filtered = !!(query || stockStatus || branchId || includeInactive);
  const branchOptions = [
    { value: "", label: "All branches" },
    ...(branchList.status === "ready" ? branchList.branches : activeBranches).map((branch) => ({
      value: branch.id,
      label: branch.is_active ? branch.name : `${branch.name} (inactive)`,
    })),
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Inventory Overview</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Stock for every product. Quantities come from stock records; identified units are the items recorded with an IMEI or serial number.
        </p>
      </header>

      <SummaryCards summary={result.summary} busy={result.status === "loading"} />

      <section className={`${panel} overflow-hidden`} aria-label="Inventory overview">
        <div className="space-y-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <h2 className="font-semibold">Products{result.total !== null && <span className="ml-1 text-sm font-normal text-slate-500"> ({result.total})</span>}</h2>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <form role="search" onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <InputField
                  aria-label="Search products"
                  name="product-search"
                  type="search"
                  icon={Search}
                  maxLength={MAX_QUERY}
                  placeholder="Search name, SKU or barcode"
                  value={searchText}
                  onChange={(event) => changeSearch(event.target.value)}
                  hint={pendingShort ? `Type at least ${MIN_QUERY} characters to search.` : undefined}
                />
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="submit" variant="accent" icon={Search} label="Search" />
                {(filtered || searchText) && <Button variant="secondary" label="Clear filters" onClick={clearFilters} />}
              </div>
            </form>
            <div className={`grid gap-3 ${isAdmin ? "sm:grid-cols-2 lg:w-96" : "lg:w-48"}`}>
              <Select name="stockStatus" value={stockStatus} onChange={(event) => changeFilter("stockStatus", event.target.value)} options={STOCK_STATUS_OPTIONS} placeholder="All statuses" />
              {isAdmin && <Select name="branch" value={branchId} onChange={(event) => changeFilter("branchId", event.target.value)} options={branchOptions} placeholder="All branches" />}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => changeFilter("includeInactive", event.target.checked ? "true" : "")}
              className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 dark:border-slate-600 [color-scheme:light] dark:[color-scheme:dark]"
            />
            Include inactive products
          </label>
        </div>
        {result.error ? (
          <div className="p-5 text-center"><p role="alert" className="text-sm text-red-600 dark:text-red-400">{result.error}</p><Button className="mt-3" size="sm" variant="secondary" label="Try again" onClick={load} /></div>
        ) : (
          <Table
            columns={columns}
            data={result.rows}
            loading={result.status === "loading"}
            ariaLabel="Inventory overview"
            emptyMessage={query ? `No products match “${query}”.` : filtered ? "No products match these filters." : "No products to show."}
            dense
          />
        )}
        {result.pages > 1 && <nav aria-label="Inventory pages" className="flex items-center justify-center gap-3 border-t border-slate-200 p-3 dark:border-slate-800">
          <Button size="sm" variant="secondary" label="Previous" disabled={page <= 1 || result.status === "loading"} onClick={() => goToPage(Math.max(1, page - 1))} />
          <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">Page {page} of {result.pages}</span>
          <Button size="sm" variant="secondary" label="Next" disabled={page >= result.pages || result.status === "loading"} onClick={() => goToPage(Math.min(result.pages, page + 1))} />
        </nav>}
      </section>

      <Dialog
        open={!!branchesOf}
        onClose={() => setBranchesOf(null)}
        title={branchesOf?.name ?? "Branches"}
        description="Stock at each branch."
      >
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {branchesOf?.branches.map((branch) => <BranchStock key={branch.id} branch={branch} />)}
        </ul>
      </Dialog>
    </div>
  );
}
