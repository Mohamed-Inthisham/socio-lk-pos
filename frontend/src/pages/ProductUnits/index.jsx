import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import Button from "../../components/common/Button";
import InputField from "../../components/common/InputField";
import Select from "../../components/common/Select";
import Table from "../../components/common/Table";
import usePermissions from "../../hooks/usePermissions";
import { listProductUnits } from "../../services/productUnitsService";
import { selectActiveBranches } from "../../store/slices/branchesSlice";
import { unitIdentifiers } from "../../utils/unitIdentifiers";

/**
 * ProductUnits Page
 *
 * Route: /inventory/units, admins and managers only (GET /product-units is
 * closed to cashiers). Every identified unit, newest first, across products.
 * Read-only: a row opens its product.
 *
 * Admins filter by branch; a manager has no picker and sends no branchId,
 * and the backend returns their own branch only.
 *
 * SEARCH is the API's `imei` filter: an exact match on the legacy imei
 * column, so it runs on Enter or the button, not per keystroke. A serial
 * number paired with an IMEI can't be found yet (FOLLOWUPS).
 *
 * Buying prices and customer details are in the response but stay off this
 * list on purpose.
 */

const PAGE_SIZE = 25;
const panel = "rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";

// RETURNED is a reversed trade-in, not a customer's return: that is INSPECTION.
const STATUS_LOOK = {
  IN_STOCK: {
    label: "In stock",
    className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  SOLD: {
    label: "Sold",
    className: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  },
  INSPECTION: {
    label: "Inspection",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  RETURNED: {
    label: "Back with customer",
    className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  },
  WRITTEN_OFF: {
    label: "Written off",
    className: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  },
};

const statusOptions = [
  { value: "", label: "All statuses" },
  ...Object.entries(STATUS_LOOK).map(([value, { label }]) => ({ value, label })),
];

const dateLabel = (iso) =>
  new Date(iso).toLocaleDateString("en-LK", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const Identifier = ({ value }) =>
  value ? <span className="font-mono text-xs">{value}</span> : <span className="text-slate-400">—</span>;

const StatusBadge = ({ status }) => {
  const look = STATUS_LOOK[status];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${look?.className ?? STATUS_LOOK.SOLD.className}`}
    >
      {look?.label ?? status}
    </span>
  );
};

export default function ProductUnits() {
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const branches = useSelector(selectActiveBranches);
  const [searchText, setSearchText] = useState("");
  const [filters, setFilters] = useState({ imei: "", status: "", branchId: "" });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ status: "loading", rows: [], total: 0, pages: 1, error: "" });
  // The latest request, so a slow older answer can't overwrite a newer one.
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setResult((current) => ({ ...current, status: "loading", error: "" }));
    listProductUnits({
      page,
      limit: PAGE_SIZE,
      ...(filters.imei && { imei: filters.imei }),
      ...(filters.status && { status: filters.status }),
      ...(isAdmin && filters.branchId && { branchId: filters.branchId }),
    })
      .then(({ data, meta }) => {
        if (requestId !== requestIdRef.current) return;
        setResult({ status: "ready", rows: data, total: meta.total, pages: Math.max(1, meta.totalPages), error: "" });
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setResult((current) => ({ ...current, status: "error", error: "Couldn’t load product units. Try again." }));
      });
  }, [filters, page, isAdmin]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const changeFilter = (field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  };
  const submitSearch = (event) => {
    event.preventDefault();
    changeFilter("imei", searchText.trim());
  };
  const clearSearch = () => {
    setSearchText("");
    changeFilter("imei", "");
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
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    ...(isAdmin ? [{ key: "branch", header: "Branch", render: (row) => row.branch?.name || "—" }] : []),
    { key: "created_at", header: "Added", render: (row) => <span className="whitespace-nowrap">{dateLabel(row.created_at)}</span> },
  ], [isAdmin]);

  const filtered = !!(filters.imei || filters.status || (isAdmin && filters.branchId));
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
          <h2 className="font-semibold">All units <span className="ml-1 text-sm font-normal text-slate-500">({result.total})</span></h2>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <form role="search" onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <InputField
                  aria-label="Search by identifier"
                  name="unit-search"
                  type="search"
                  icon={Search}
                  placeholder="Enter or scan an exact IMEI or serial number"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  hint="Exact match on the unit’s main identifier: its IMEI, or its serial number if it has no IMEI. A serial number paired with an IMEI can’t be searched yet."
                />
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="submit" variant="accent" icon={Search} label="Search" />
                {(searchText || filters.imei) && <Button variant="secondary" label="Clear" onClick={clearSearch} />}
              </div>
            </form>
            <div className="grid gap-3 sm:grid-cols-2 lg:w-96">
              <Select name="status" value={filters.status} onChange={(event) => changeFilter("status", event.target.value)} options={statusOptions} placeholder="All statuses" />
              {isAdmin && <Select name="branch" value={filters.branchId} onChange={(event) => changeFilter("branchId", event.target.value)} options={branchOptions} placeholder="All branches" />}
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
            onRowClick={(row) => navigate(`/products/${row.product_id}`)}
            ariaLabel="Product units"
            emptyMessage={filtered ? "No units match these filters." : "No product units have been recorded yet."}
            dense
          />
        )}
        {result.pages > 1 && <nav aria-label="Product unit pages" className="flex items-center justify-center gap-3 border-t border-slate-200 p-3 dark:border-slate-800">
          <Button size="sm" variant="secondary" label="Previous" disabled={page <= 1 || result.status === "loading"} onClick={() => setPage((current) => Math.max(1, current - 1))} />
          <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">Page {page} of {result.pages}</span>
          <Button size="sm" variant="secondary" label="Next" disabled={page >= result.pages || result.status === "loading"} onClick={() => setPage((current) => Math.min(result.pages, current + 1))} />
        </nav>}
      </section>
    </div>
  );
}
