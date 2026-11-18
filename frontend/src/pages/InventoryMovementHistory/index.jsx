import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RotateCcw } from "lucide-react";
import Button from "../../components/common/Button";
import InputField from "../../components/common/InputField";
import Select from "../../components/common/Select";
import Table from "../../components/common/Table";
import usePermissions from "../../hooks/usePermissions";
import { listBranches } from "../../services/branchesService";
import { listProducts } from "../../services/productsService";
import { getStockMovements } from "../../services/stockService";

const PAGE_SIZE = 25;
const panel =
  "rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";
const TYPE_LABELS = {
  OPENING_BALANCE: "Opening balance",
  PURCHASE: "Purchase received",
  TRADE_IN: "Trade-in received",
  SALE: "Sale",
  REVERSAL: "Sale void reversal",
  CUSTOMER_RETURN: "Customer return",
  INSPECTION_PASSED: "Inspection passed",
  ADJUSTMENT_IN: "Adjustment in",
  ADJUSTMENT_OUT: "Adjustment out",
};
const TYPE_OPTIONS = [
  { value: "OPENING_BALANCE", label: "Opening balance" },
  { value: "PURCHASE", label: "Purchase received" },
  { value: "TRADE_IN", label: "Trade-in received" },
  { value: "SALE", label: "Sale" },
  { value: "REVERSAL", label: "Sale void reversal" },
  { value: "CUSTOMER_RETURN", label: "Customer return" },
  { value: "INSPECTION_PASSED", label: "Inspection passed" },
  { value: "ADJUSTMENT_IN", label: "Adjustment in" },
  { value: "ADJUSTMENT_OUT", label: "Adjustment out" },
];
const formatTime = (value) =>
  new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Colombo",
  }).format(new Date(value));
const signed = (value) => (value > 0 ? `+${value}` : String(value));

const MovementDescription = ({ row }) => (
  <div className="min-w-44">
    <div className="font-medium text-slate-900 dark:text-slate-100">
      {TYPE_LABELS[row.movement_type] ?? row.movement_type}
    </div>
    {row.reverses_movement_id && (
      <div className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
        <RotateCcw size={13} aria-hidden="true" /> Reverses{" "}
        {row.reverses_movement_id.slice(0, 8)}
      </div>
    )}
    {row.reason_code && (
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {row.reason_code}
      </div>
    )}
    {row.note && (
      <div className="mt-1 max-w-64 text-xs text-slate-500 dark:text-slate-400">
        {row.note}
      </div>
    )}
  </div>
);

const Reference = ({ row }) => (
  <div className="min-w-36">
    <div className="font-medium">{row.reference_type}</div>
    <div className="break-all font-mono text-xs text-slate-500 dark:text-slate-400">
      {row.reference_id}
    </div>
  </div>
);

export default function InventoryMovementHistory() {
  const { isAdmin } = usePermissions();
  const [branches, setBranches] = useState([]);
  const [branchStatus, setBranchStatus] = useState(
    isAdmin ? "loading" : "ready",
  );
  const [branchId, setBranchId] = useState("");
  const [movementType, setMovementType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [productLoading, setProductLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({
    status: "loading",
    rows: [],
    meta: null,
    error: "",
  });
  const requestRef = useRef(0);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    listBranches({ includeInactive: true })
      .then((items) => {
        if (!cancelled) {
          setBranches(items);
          setBranchStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setBranchStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    const search = productSearch.trim();
    if (selectedProduct || search.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProducts([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setProductLoading(true);
      listProducts({ search, limit: 50, includeInactive: true })
        .then(({ data }) => {
          if (!cancelled) setProducts(data);
        })
        .catch(() => {
          if (!cancelled) setProducts([]);
        })
        .finally(() => {
          if (!cancelled) setProductLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [productSearch, selectedProduct]);

  const load = useCallback(() => {
    const request = ++requestRef.current;
    setResult((current) => ({ ...current, status: "loading", error: "" }));
    const filters = {
      page,
      limit: PAGE_SIZE,
      ...(selectedProduct && { productId: selectedProduct.id }),
      ...(isAdmin && branchId && { branchId }),
      ...(movementType && { movementType }),
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
    };
    getStockMovements(filters)
      .then(({ data, meta }) => {
        if (request !== requestRef.current) return;
        setResult({ status: "ready", rows: data, meta, error: "" });
      })
      .catch((error) => {
        if (request !== requestRef.current) return;
        setResult({
          status: "error",
          rows: [],
          meta: null,
          error:
            error.response?.data?.message ||
            "Couldn’t load movement history. Try again.",
        });
      });
  }, [
    page,
    selectedProduct,
    isAdmin,
    branchId,
    movementType,
    startDate,
    endDate,
  ]);

  useEffect(() => {
    // Load is an async boundary to the API; it sets loading before the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  const updateFilter = (setter) => (value) => {
    setter(value);
    setPage(1);
  };
  const clearFilters = () => {
    setBranchId("");
    setMovementType("");
    setStartDate("");
    setEndDate("");
    setProductSearch("");
    setSelectedProduct(null);
    setProducts([]);
    setPage(1);
  };
  const columns = useMemo(
    () => [
      {
        key: "created_at",
        header: "When",
        primary: true,
        render: (row) => (
          <time
            dateTime={row.created_at}
            className="whitespace-nowrap text-slate-600 dark:text-slate-300"
          >
            {formatTime(row.created_at)}
          </time>
        ),
      },
      {
        key: "movement_type",
        header: "Movement",
        render: (row) => <MovementDescription row={row} />,
      },
      {
        key: "product",
        header: "Product / branch",
        render: (row) => (
          <div>
            <div className="font-medium">{row.product_name}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {row.branch_name}
            </div>
            {row.product_unit_code && (
              <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                Unit {row.product_unit_code}
              </div>
            )}
            {row.unit_status_to && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {row.unit_status_from ?? "New"} → {row.unit_status_to}
              </div>
            )}
          </div>
        ),
      },
      {
        key: "quantity",
        header: "Quantity",
        align: "right",
        render: (row) => (
          <div className="whitespace-nowrap text-right tabular-nums">
            <div className="font-semibold">{signed(row.quantity_delta)}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {row.quantity_before} → {row.quantity_after}
            </div>
            {!row.stock_managed && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Not stock managed
              </div>
            )}
          </div>
        ),
      },
      {
        key: "reference",
        header: "Reference",
        render: (row) => <Reference row={row} />,
      },
      {
        key: "performed_by",
        header: "Recorded by",
        render: (row) => (
          <div className="min-w-28">
            <div>{row.performed_by?.full_name ?? "System"}</div>
            {row.approved_by && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Approved by {row.approved_by.full_name}
              </div>
            )}
          </div>
        ),
      },
    ],
    [],
  );

  const hasFilters = !!(
    selectedProduct ||
    branchId ||
    movementType ||
    startDate ||
    endDate ||
    productSearch
  );
  const branchOptions = [
    { value: "", label: "All branches" },
    ...branches.map((branch) => ({
      value: branch.id,
      label: branch.is_active ? branch.name : `${branch.name} (inactive)`,
    })),
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to="/inventory"
            className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-cyan-700 hover:underline dark:text-cyan-300"
          >
            <ArrowLeft size={16} /> Inventory overview
          </Link>
          <h1 className="text-2xl font-semibold">Stock Movement History</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            A chronological record of stock quantity and identified-unit status
            changes.
          </p>
        </div>
      </header>

      <section
        className={`${panel} space-y-4 p-4`}
        aria-label="Movement filters"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative">
            {selectedProduct ? (
              <div className="flex h-11 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm dark:border-slate-600 dark:bg-slate-800">
                <span className="truncate">
                  {selectedProduct.name}{" "}
                  <span className="text-slate-500">
                    ({selectedProduct.sku})
                  </span>
                </span>
                <button
                  type="button"
                  aria-label="Clear product filter"
                  className="text-cyan-700 hover:underline dark:text-cyan-300"
                  onClick={() => {
                    setSelectedProduct(null);
                    setProductSearch("");
                    setPage(1);
                  }}
                >
                  Clear
                </button>
              </div>
            ) : (
              <InputField
                label="Product"
                name="product-search"
                type="search"
                placeholder="Search product name or SKU"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
              />
            )}
            {!selectedProduct && productSearch.trim().length >= 2 && (
              <div
                className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                role="listbox"
                aria-label="Product results"
              >
                {productLoading ? (
                  <p className="p-3 text-sm text-slate-500">Searching…</p>
                ) : products.length ? (
                  products.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      role="option"
                      aria-selected="false"
                      className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-cyan-50 dark:hover:bg-slate-800"
                      onClick={() => {
                        setSelectedProduct(product);
                        setProductSearch("");
                        setProducts([]);
                        setPage(1);
                      }}
                    >
                      <span className="font-medium">{product.name}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {product.sku}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="p-3 text-sm text-slate-500">
                    No products found.
                  </p>
                )}
              </div>
            )}
          </div>
          {isAdmin && (
            <Select
              name="branch"
              label="Branch"
              value={branchId}
              onChange={(event) =>
                updateFilter(setBranchId)(event.target.value)
              }
              options={branchOptions}
              placeholder={
                branchStatus === "failed"
                  ? "Branches unavailable"
                  : "All branches"
              }
              disabled={branchStatus !== "ready"}
            />
          )}
          <Select
            name="movementType"
            label="Movement type"
            value={movementType}
            onChange={(event) =>
              updateFilter(setMovementType)(event.target.value)
            }
            options={TYPE_OPTIONS}
            placeholder="All movement types"
          />
          <div className="grid grid-cols-2 gap-3">
            <InputField
              label="From date"
              type="date"
              name="start-date"
              value={startDate}
              onChange={(event) =>
                updateFilter(setStartDate)(event.target.value)
              }
            />
            <InputField
              label="To date"
              type="date"
              name="end-date"
              value={endDate}
              onChange={(event) => updateFilter(setEndDate)(event.target.value)}
            />
          </div>
        </div>
        {startDate && endDate && startDate > endDate && (
          <p role="alert" className="text-sm text-red-600">
            The start date must be on or before the end date.
          </p>
        )}
        {hasFilters && (
          <div>
            <Button
              size="sm"
              variant="secondary"
              label="Clear filters"
              onClick={clearFilters}
            />
          </div>
        )}
      </section>

      <section
        className={`${panel} overflow-hidden`}
        aria-label="Stock movement history"
      >
        {result.status === "error" ? (
          <div className="p-6 text-center">
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {result.error}
            </p>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              label="Try again"
              onClick={load}
            />
          </div>
        ) : (
          <Table
            columns={columns}
            data={result.rows}
            loading={result.status === "loading"}
            ariaLabel="Stock movement history"
            emptyMessage="No stock movements match these filters."
            dense
          />
        )}
        {result.status === "ready" && result.meta?.total > 0 && (
          <div className="flex flex-col items-center justify-between gap-2 border-t border-slate-200 p-3 sm:flex-row dark:border-slate-800">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {result.meta.total} movement{result.meta.total === 1 ? "" : "s"}
            </p>
            {result.meta.totalPages > 1 && (
              <nav
                aria-label="Movement history pages"
                className="flex items-center gap-3"
              >
                <Button
                  size="sm"
                  variant="secondary"
                  label="Previous"
                  disabled={!result.meta.hasPrev || result.status === "loading"}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                />
                <span className="text-sm tabular-nums">
                  Page {result.meta.page} of {result.meta.totalPages}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  label="Next"
                  disabled={!result.meta.hasNext || result.status === "loading"}
                  onClick={() => setPage((value) => value + 1)}
                />
              </nav>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
