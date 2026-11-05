import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import Button from "../../components/common/Button";
import InputField from "../../components/common/InputField";
import Select from "../../components/common/Select";
import Table from "../../components/common/Table";
import UnitStatusBadge from "../../components/inventory/UnitStatusBadge";
import { UNIT_STATUS_LABELS, UNIT_STATUS_OPTIONS } from "../../constants/unitStatus";
import usePermissions from "../../hooks/usePermissions";
import { listProductUnits, searchProductUnits } from "../../services/productUnitsService";
import { selectActiveBranches } from "../../store/slices/branchesSlice";
import { unitIdentifiers } from "../../utils/unitIdentifiers";

/**
 * ProductUnits Page
 *
 * Route: /inventory/units, admins and managers only (GET /product-units is
 * closed to cashiers). Every identified unit, newest first, across products.
 * Read-only: a row opens that unit.
 *
 * Admins filter by branch; a manager has no picker and sends no branchId,
 * and the backend returns their own branch only.
 *
 * THE URL holds the filters and page (q, status, branchId, page), so Back
 * from a unit restores the list. A value that isn't valid reads as the
 * default; defaults stay out of the URL.
 *
 * SEARCH (q, 2+ characters) is GET /product-units/search: part of an IMEI,
 * serial number, SKU or product name. It runs 300 ms after the typing stops,
 * or at once on Enter, and fills this same table. It covers every status, so
 * the status filter is off meanwhile; its value stays in the URL and applies
 * again when the search ends.
 *
 * Buying prices and customer details are in the list's response but stay off
 * this page on purpose. The search's response doesn't carry them.
 */

const PAGE_SIZE = 25;
const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;
const panel = "rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";

const dateLabel = (iso) =>
  new Date(iso).toLocaleDateString("en-LK", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const Identifier = ({ value }) =>
  value ? <span className="font-mono text-xs">{value}</span> : <span className="text-slate-400">—</span>;

export default function ProductUnits() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = usePermissions();
  const branches = useSelector(selectActiveBranches);
  const [searchParams, setSearchParams] = useSearchParams();

  const q = (searchParams.get("q") ?? "").trim();
  const statusParam = searchParams.get("status") ?? "";
  const status = Object.hasOwn(UNIT_STATUS_LABELS, statusParam) ? statusParam : "";
  const branchParam = searchParams.get("branchId") ?? "";
  // No list (loading, or it failed): keep the URL's branch for the backend to
  // judge, so the view never widens to every branch unasked.
  const knownBranch = branches.length === 0 || branches.some((branch) => branch.id === branchParam);
  const branchId = isAdmin && knownBranch ? branchParam : "";
  const pageParam = Number(searchParams.get("page"));
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;

  const query = q.length >= MIN_QUERY ? q : "";
  const searching = !!query;
  // A search covers every status; the filter's value waits in the URL.
  const listStatus = searching ? "" : status;

  const [searchText, setSearchText] = useState(q);
  const debounceTimer = useRef(null);
  // The q this page last wrote. Anything else came from outside, such as the
  // sidebar link: only then does the box follow the URL, or it would rewrite
  // what's being typed.
  const committedQ = useRef(q);
  useEffect(() => {
    if (q === committedQ.current) return;
    committedQ.current = q;
    clearTimeout(debounceTimer.current);
    setSearchText(q);
  }, [q]);
  useEffect(() => () => clearTimeout(debounceTimer.current), []);

  const [result, setResult] = useState({ status: "loading", rows: [], total: 0, pages: 1, error: "" });
  // The latest request, so a slow older answer can't overwrite a newer one.
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setResult((current) => ({ ...current, status: "loading", error: "" }));
    const params = { page, limit: PAGE_SIZE, ...(branchId && { branchId }) };
    const request = query
      ? searchProductUnits({ ...params, q: query })
      : listProductUnits({ ...params, ...(listStatus && { status: listStatus }) });
    request
      .then(({ data, meta }) => {
        if (requestId !== requestIdRef.current) return;
        setResult({ status: "ready", rows: data, total: meta.total, pages: Math.max(1, meta.totalPages), error: "" });
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setResult((current) => ({ ...current, status: "error", error: "Couldn’t load product units. Try again." }));
      });
  }, [query, listStatus, branchId, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Every write starts from the URL as it is now. setSearchParams' own prev is
  // the render it came from, so a waiting search would overwrite a branch
  // picked in the meantime.
  const latestParams = useRef(searchParams);
  useLayoutEffect(() => {
    latestParams.current = searchParams;
  }, [searchParams]);
  const updateParams = (changes) => {
    const next = new URLSearchParams(latestParams.current);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    latestParams.current = next;
    setSearchParams(next, { replace: true });
  };
  const changeFilter = (field, value) => updateParams({ [field]: value, page: "" });
  const goToPage = (next) => updateParams({ page: next > 1 ? String(next) : "" });
  const commitSearch = (value) => {
    const trimmed = value.trim();
    const next = trimmed.length >= MIN_QUERY ? trimmed : "";
    if (next === committedQ.current) return;
    committedQ.current = next;
    changeFilter("q", next);
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
  const clearSearch = () => {
    clearTimeout(debounceTimer.current);
    setSearchText("");
    commitSearch("");
  };

  const columns = useMemo(() => [
    {
      key: "product",
      header: "Product",
      primary: true,
      render: (row) => (
        <div>
          <div className="font-medium text-slate-900 dark:text-slate-100">{row.product?.name || "—"}</div>
          <div className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">{row.product?.sku}</div>
        </div>
      ),
    },
    { key: "imei", header: "IMEI", render: (row) => <Identifier value={unitIdentifiers(row, row.product?.tracking_method).imei} /> },
    { key: "serial", header: "Serial number", render: (row) => <Identifier value={unitIdentifiers(row, row.product?.tracking_method).serial} /> },
    { key: "status", header: "Status", render: (row) => <UnitStatusBadge status={row.status} /> },
    ...(isAdmin ? [{ key: "branch", header: "Branch", render: (row) => row.branch?.name || "—" }] : []),
    { key: "created_at", header: "Added", render: (row) => <span className="whitespace-nowrap">{dateLabel(row.created_at)}</span> },
  ], [isAdmin]);

  const pendingShort = searchText.trim().length > 0 && searchText.trim().length < MIN_QUERY;
  const filtered = !!(status || branchId);
  const branchOptions = [
    { value: "", label: "All branches" },
    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Product units</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Individual items recorded with an IMEI or serial number. This isn’t total stock: items without an identifier aren’t listed.
        </p>
      </header>

      <section className={`${panel} overflow-hidden`} aria-label="Product units">
        <div className="space-y-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <h2 className="font-semibold">{searching ? "Matching units" : "All units"} <span className="ml-1 text-sm font-normal text-slate-500">({result.total})</span></h2>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <form role="search" onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <InputField
                  aria-label="Search product units"
                  name="unit-search"
                  type="search"
                  icon={Search}
                  placeholder="Search IMEI, serial number, SKU or product name"
                  value={searchText}
                  onChange={(event) => changeSearch(event.target.value)}
                  hint={pendingShort ? `Type at least ${MIN_QUERY} characters to search.` : "Finds part of an IMEI, serial number, SKU or product name, in any status."}
                />
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="submit" variant="accent" icon={Search} label="Search" />
                {(searchText || q) && <Button variant="secondary" label="Clear" onClick={clearSearch} />}
              </div>
            </form>
            <div className="grid gap-3 sm:grid-cols-2 lg:w-96">
              <Select name="status" value={status} onChange={(event) => changeFilter("status", event.target.value)} options={UNIT_STATUS_OPTIONS} placeholder="All statuses" disabled={searching} hint={searching ? "Not used while searching." : undefined} />
              {isAdmin && <Select name="branch" value={branchId} onChange={(event) => changeFilter("branchId", event.target.value)} options={branchOptions} placeholder="All branches" />}
            </div>
          </div>
        </div>
        {result.error ? (
          <div className="p-5 text-center"><p role="alert" className="text-sm text-red-600 dark:text-red-400">{result.error}</p><Button className="mt-3" size="sm" variant="secondary" label="Try again" onClick={load} /></div>
        ) : (
          <Table
            columns={columns}
            data={result.rows}
            loading={result.status === "loading"}
            onRowClick={(row) => navigate(`/inventory/units/${row.id}`, { state: { from: { search: location.search } } })}
            ariaLabel="Product units"
            emptyMessage={searching ? `No units match “${query}”.` : filtered ? "No units match these filters." : "No product units have been recorded yet."}
            dense
          />
        )}
        {result.pages > 1 && <nav aria-label="Product unit pages" className="flex items-center justify-center gap-3 border-t border-slate-200 p-3 dark:border-slate-800">
          <Button size="sm" variant="secondary" label="Previous" disabled={page <= 1 || result.status === "loading"} onClick={() => goToPage(Math.max(1, page - 1))} />
          <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">Page {page} of {result.pages}</span>
          <Button size="sm" variant="secondary" label="Next" disabled={page >= result.pages || result.status === "loading"} onClick={() => goToPage(Math.min(result.pages, page + 1))} />
        </nav>}
      </section>
    </div>
  );
}
