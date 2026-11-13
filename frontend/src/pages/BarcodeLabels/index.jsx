import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { AlertCircle, Barcode, Eye, Loader2, Plus, Printer, Search, X } from "lucide-react";
import usePermissions from "../../hooks/usePermissions";
import { listBranches } from "../../services/branchesService";
import {
  resolveLabelQueue,
  searchProductLabels,
  searchUnitLabels,
} from "../../services/barcodeLabelsService";
import { code128Bars } from "../../utils/code128";
import {
  MAX_COPIES,
  MAX_LABELS,
  MIN_COPIES,
  addEntry,
  clampCopies,
  countLabels,
  describeResolveError,
  expandLabels,
  identifierLabel,
  productEntry,
  queueSignature,
  toResolveItems,
  unitEntry,
} from "./labelQueue";

const PAGE_SIZE = 20;
const MIN_SEARCH = 2;
const DEBOUNCE_MS = 300;
const LABEL_SIZES = {
  "50x25": { width: "50mm", height: "25mm" },
  "40x20": { width: "40mm", height: "20mm" },
  "30x20": { width: "30mm", height: "20mm" },
};
const money = (value) =>
  value === null || value === undefined || value === ""
    ? ""
    : new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 2 }).format(Number(value));

const BarcodeSvg = ({ value }) => {
  const encoded = code128Bars(value);
  if (!encoded) return <div className="text-xs text-red-600">Code cannot be printed</div>;
  const quiet = 10;
  return (
    <svg viewBox={`0 0 ${encoded.width + quiet * 2} 48`} className="barcode-svg" role="img" aria-label={`Barcode ${value}`}>
      <rect width="100%" height="100%" fill="white" />
      {encoded.bars.map((bar, index) => (
        <rect key={index} x={bar.x + quiet} y="0" width={bar.width} height="48" fill="black" />
      ))}
    </svg>
  );
};

/**
 * One server-side, paginated, debounced search. A search shorter than 2
 * characters isn't sent (the server would refuse it); an older answer
 * can't overwrite a newer one.
 */
const useLabelSearch = (fetchPage, filters) => {
  const filtersKey = JSON.stringify(filters);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const committedQuery = useRef("");
  // The page belongs to one set of filters and one search: anything else
  // reads as page 1, so a new filter or search costs one request, not two.
  const [paging, setPaging] = useState({ scope: `${filtersKey}|`, page: 1 });
  const scope = `${filtersKey}|${query}`;
  const page = paging.scope === scope ? paging.page : 1;
  const setPage = (next) => setPaging({ scope, page: next });
  const [result, setResult] = useState({ status: "loading", rows: [], total: 0, pages: 1, error: "" });
  const timer = useRef(null);
  const requestId = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    const id = ++requestId.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult((current) => ({ ...current, status: "loading", error: "" }));
    fetchPage({ ...JSON.parse(filtersKey), ...(query ? { search: query } : {}), page, limit: PAGE_SIZE })
      .then(({ data, meta }) => {
        if (id !== requestId.current) return;
        setResult({ status: "ready", rows: data, total: meta.total, pages: Math.max(1, meta.totalPages), error: "" });
      })
      .catch((error) => {
        if (id !== requestId.current) return;
        const message = error?.response?.data?.message;
        setResult((current) => ({
          ...current,
          status: "error",
          rows: [],
          error: (Array.isArray(message) ? message.join("; ") : message) || "Couldn't load results. Try again.",
        }));
      });
  }, [fetchPage, filtersKey, query, page]);

  const commit = (value) => {
    const trimmed = value.trim();
    const next = trimmed.length >= MIN_SEARCH ? trimmed : "";
    if (next === committedQuery.current) return;
    committedQuery.current = next;
    setQuery(next);
  };
  const changeText = (value) => {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(value), DEBOUNCE_MS);
  };
  const tooShort = text.trim().length > 0 && text.trim().length < MIN_SEARCH;

  return { text, changeText, query, page, setPage, result, tooShort };
};

const panelClass = "rounded-xl border border-slate-800 bg-slate-900 p-5";
const selectClass = "h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-slate-100";

/** The search box, list, states and pager shared by both tabs. */
const SearchResults = ({ search, label, placeholder, emptyMessage, renderRow }) => {
  const { text, changeText, query, page, setPage, result, tooShort } = search;
  return (
    <div className="space-y-3">
      <label className="relative block">
        <span className="sr-only">{label}</span>
        <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={text} onChange={(event) => changeText(event.target.value)} placeholder={placeholder} aria-label={label} className="h-11 w-full rounded-lg border border-slate-700 bg-slate-800 pl-10 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none" />
      </label>
      {tooShort && <p className="text-xs text-slate-400">Type at least {MIN_SEARCH} characters to search.</p>}
      <div className="max-h-80 divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800" aria-busy={result.status === "loading"}>
        {result.status === "loading" && <div className="flex items-center gap-2 p-4 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" />Loading…</div>}
        {result.status === "error" && <p role="alert" className="p-4 text-sm text-red-300">{result.error}</p>}
        {result.status === "ready" && result.rows.length === 0 && <p className="p-4 text-sm text-slate-400">{query ? `Nothing matches “${query}”.` : emptyMessage}</p>}
        {result.status === "ready" && result.rows.map(renderRow)}
      </div>
      {result.pages > 1 && (
        <nav aria-label={`${label} pages`} className="flex items-center justify-between gap-3 text-sm text-slate-400">
          <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1 || result.status === "loading"} className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 hover:bg-slate-800 disabled:opacity-40">Previous</button>
          <span className="tabular-nums">Page {page} of {result.pages}</span>
          <button type="button" onClick={() => setPage(Math.min(result.pages, page + 1))} disabled={page >= result.pages || result.status === "loading"} className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 hover:bg-slate-800 disabled:opacity-40">Next</button>
        </nav>
      )}
    </div>
  );
};

/**
 * A product's copies. The text can be cleared and retyped; only a whole
 * number reaches the queue, clamped to 1–500, and leaving the field shows
 * the queued value again.
 */
const CopiesInput = ({ name, quantity, onChange }) => {
  const [draft, setDraft] = useState(String(quantity));
  const [editing, setEditing] = useState(false);
  return (
    <input
      aria-label={`Copies of ${name}`}
      type="number"
      inputMode="numeric"
      min={MIN_COPIES}
      max={MAX_COPIES}
      value={editing ? draft : String(quantity)}
      onFocus={() => {
        setDraft(String(quantity));
        setEditing(true);
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        setEditing(true);
        if (/^\d+$/.test(event.target.value)) onChange(event.target.value);
      }}
      onBlur={() => setEditing(false)}
      className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-center text-sm text-slate-100"
    />
  );
};

const AddButton = ({ queued, name, onAdd }) => (
  <button type="button" onClick={onAdd} disabled={queued} aria-label={queued ? `${name} is in the queue` : `Add ${name}`} className="rounded-lg bg-slate-800 p-2 text-cyan-400 hover:bg-cyan-900/40 disabled:cursor-not-allowed disabled:text-slate-500 disabled:hover:bg-slate-800">
    {queued ? <span className="px-1 text-xs">Added</span> : <Plus size={18} />}
  </button>
);

const BarcodeLabels = () => {
  const { isAdmin } = usePermissions();
  const user = useSelector((state) => state.auth.user);
  const [branches, setBranches] = useState([]);
  const [branchError, setBranchError] = useState("");
  const [tab, setTab] = useState("PRODUCT");
  const [branchId, setBranchId] = useState("");
  const [queue, setQueue] = useState([]);
  const [size, setSize] = useState("50x25");
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showCode, setShowCode] = useState(true);
  // The last resolved queue: { rows, totalLabels, signature }.
  const [resolved, setResolved] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState(null);

  // Admins may search any branch, or all of them. A manager's units come
  // from their own branch: the server holds them to it whatever is sent.
  const unitBranchId = isAdmin ? branchId : user?.branch_id ?? "";
  const ownBranchName =
    user?.branch?.name || branches.find((branch) => branch.id === user?.branch_id)?.name || "Your branch";

  useEffect(() => {
    let active = true;
    listBranches()
      .then((rows) => active && setBranches(rows ?? []))
      .catch(() => active && setBranchError("Couldn't load branches."));
    return () => { active = false; };
  }, []);

  const productFilters = useMemo(() => ({}), []);
  const unitFilters = useMemo(() => (unitBranchId ? { branchId: unitBranchId } : {}), [unitBranchId]);
  const fetchProducts = useCallback((params) => searchProductLabels(params), []);
  const fetchUnits = useCallback((params) => searchUnitLabels(params), []);
  const productSearch = useLabelSearch(fetchProducts, productFilters);
  const unitSearch = useLabelSearch(fetchUnits, unitFilters);

  const queuedKeys = useMemo(() => new Set(queue.map((item) => item.key)), [queue]);
  const totalLabels = countLabels(queue);
  const overLimit = totalLabels > MAX_LABELS;
  const signature = queueSignature(queue);
  const previewCurrent = resolved !== null && resolved.signature === signature;
  const labels = useMemo(() => (previewCurrent ? expandLabels(resolved.rows) : []), [previewCurrent, resolved]);

  const add = (entry) => setQueue((current) => addEntry(current, entry));
  const clearItemError = (key) =>
    setResolveError((current) => {
      if (!current?.itemErrors[key]) return current;
      const itemErrors = { ...current.itemErrors };
      delete itemErrors[key];
      return { ...current, itemErrors };
    });
  const updateCopies = (key, value) => {
    setQueue((current) => current.map((item) => (item.key === key ? { ...item, quantity: clampCopies(value) } : item)));
    clearItemError(key);
  };
  const remove = (key) => {
    setQueue((current) => current.filter((item) => item.key !== key));
    clearItemError(key);
  };
  const clearAll = () => {
    setQueue([]);
    setResolveError(null);
  };

  const preview = async () => {
    if (!queue.length || overLimit) return;
    const sent = queue;
    const sentSignature = signature;
    setResolving(true);
    setResolveError(null);
    try {
      const result = await resolveLabelQueue({ items: toResolveItems(sent) });
      setResolved({ rows: result.data, totalLabels: result.total_labels, signature: sentSignature });
    } catch (error) {
      setResolved(null);
      setResolveError(describeResolveError(error, sent));
    } finally {
      setResolving(false);
    }
  };

  const printLabels = () => {
    if (previewCurrent && labels.length) window.print();
  };

  const tabButton = (value, text) => (
    <button type="button" role="tab" aria-selected={tab === value} aria-controls={`labels-tab-${value}`} id={`labels-tab-button-${value}`} onClick={() => setTab(value)} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${tab === value ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
      {text}
    </button>
  );

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      <header className="flex items-center gap-3">
        <div className="rounded-xl bg-cyan-500/10 p-3 text-cyan-500"><Barcode size={22} /></div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Barcode Labels</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Build a sheet of scannable labels for products and individual items, then print it.</p>
        </div>
      </header>

      {branchError && <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300"><AlertCircle size={16} />{branchError}<button className="ml-auto" onClick={() => setBranchError("")} aria-label="Dismiss"><X size={16} /></button></div>}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.25fr)]">
        <div className="space-y-5">
          <section className={panelClass} aria-labelledby="add-labels-heading">
            <h2 id="add-labels-heading" className="mb-4 text-lg font-semibold text-slate-100">Add Labels</h2>
            <div role="tablist" aria-label="Label type" className="mb-4 flex gap-1 rounded-lg bg-slate-800 p-1">
              {tabButton("PRODUCT", "Products")}
              {tabButton("UNIT", "Individual items")}
            </div>

            <div role="tabpanel" id="labels-tab-PRODUCT" aria-labelledby="labels-tab-button-PRODUCT" hidden={tab !== "PRODUCT"}>
              <p className="mb-3 text-xs text-slate-400">Quantity-tracked products get one shared product label. Set the number of copies in the queue.</p>
              <SearchResults
                search={productSearch}
                label="Search products"
                placeholder="Search product name / SKU / barcode..."
                emptyMessage="No quantity-tracked products found."
                renderRow={(row) => (
                  <div key={row.product_id} className="flex items-center gap-3 p-3 hover:bg-slate-800/70">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-100">{row.name}</p>
                      <p className="truncate text-xs text-slate-400">{row.sku} · {money(row.selling_price) || "Price not set"}</p>
                    </div>
                    <AddButton queued={queuedKeys.has(`PRODUCT:${row.product_id}`)} name={row.name} onAdd={() => add(productEntry(row))} />
                  </div>
                )}
              />
            </div>

            <div role="tabpanel" id="labels-tab-UNIT" aria-labelledby="labels-tab-button-UNIT" hidden={tab !== "UNIT"}>
              <p className="mb-3 text-xs text-slate-400">IMEI and serial-number items get one label each. The barcode is the item’s unit code; its IMEI or serial number is printed as text.</p>
              <div className="mb-3">
                {isAdmin ? (
                  <label className="space-y-1 text-xs text-slate-400">Branch
                    <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className={selectClass}>
                      <option value="">All branches</option>
                      {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <label className="space-y-1 text-xs text-slate-400">Branch
                    <input value={ownBranchName} readOnly className={`${selectClass} cursor-not-allowed opacity-60`} />
                  </label>
                )}
              </div>
              <SearchResults
                search={unitSearch}
                label="Search items"
                placeholder="Search IMEI / serial / unit code / product..."
                emptyMessage="No in-stock IMEI or serial-number items found."
                renderRow={(row) => (
                  <div key={row.unit_id} className="flex items-center gap-3 p-3 hover:bg-slate-800/70">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-100">{row.name}</p>
                      <p className="truncate text-xs text-slate-400">{identifierLabel(row.identifier_type)} {row.identifier} · {row.unit_code}</p>
                      <p className="truncate text-xs text-slate-500">{row.branch.name} · {money(row.selling_price) || "Price not set"}</p>
                    </div>
                    <AddButton queued={queuedKeys.has(`UNIT:${row.unit_id}`)} name={`${row.name} ${row.unit_code}`} onAdd={() => add(unitEntry(row))} />
                  </div>
                )}
              />
            </div>
          </section>

          <section className={panelClass} aria-labelledby="label-queue-heading">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="label-queue-heading" className="text-lg font-semibold text-slate-100">Label Queue</h2>
              <button type="button" onClick={clearAll} disabled={!queue.length} className="text-sm text-red-400 hover:text-red-300 disabled:opacity-40">Clear all</button>
            </div>
            {queue.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">Add products or individual items to start a label sheet.</p>
            ) : (
              <ol className="space-y-2" aria-label="Label queue">
                {queue.map((item, index) => {
                  const itemError = resolveError?.itemErrors[item.key];
                  return (
                    <li key={item.key} className={`rounded-lg border bg-slate-800/60 p-3 ${itemError ? "border-red-700" : "border-slate-700"}`}>
                      <div className="flex items-center gap-3">
                        <span className="w-5 text-right text-xs tabular-nums text-slate-500">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-slate-100">{item.name}</p>
                          <p className="truncate text-xs text-slate-400">
                            {item.kind === "PRODUCT"
                              ? `Product label · ${item.sku}`
                              : `${identifierLabel(item.identifier_type)} ${item.identifier} · ${item.unit_code}`}
                          </p>
                        </div>
                        {item.kind === "PRODUCT" ? (
                          <label className="flex items-center gap-2 text-xs text-slate-400">Copies
                            <CopiesInput name={item.name} quantity={item.quantity} onChange={(value) => updateCopies(item.key, value)} />
                          </label>
                        ) : (
                          <span className="text-xs text-slate-400">1 label</span>
                        )}
                        <button type="button" onClick={() => remove(item.key)} aria-label={`Remove ${item.kind === "PRODUCT" ? item.name : `${item.name} ${item.unit_code}`}`} className="text-slate-500 hover:text-red-400"><X size={18} /></button>
                      </div>
                      {itemError && <p className="mt-2 text-xs text-red-300">{itemError}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
            {queue.length > 0 && (
              <p className={`mt-3 text-xs ${overLimit ? "text-red-300" : "text-slate-400"}`}>
                {totalLabels} {totalLabels === 1 ? "label" : "labels"}{overLimit ? ` — more than the ${MAX_LABELS}-label limit. Remove items or lower copies.` : ` (up to ${MAX_LABELS})`}
              </p>
            )}
          </section>

          <section className={panelClass} aria-labelledby="label-options-heading">
            <h2 id="label-options-heading" className="mb-4 text-lg font-semibold text-slate-100">Label Options</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-slate-400">Label size<select value={size} onChange={(event) => setSize(event.target.value)} className={selectClass}><option value="50x25">50 × 25 mm</option><option value="40x20">40 × 20 mm</option><option value="30x20">30 × 20 mm</option></select></label>
              <label className="space-y-1 text-xs text-slate-400">Symbology<select value="CODE128" disabled className={selectClass}><option value="CODE128">CODE 128</option></select></label>
            </div>
            <p className="mt-3 text-xs text-slate-400">Labels show the selling price. Cost prices are never printed.</p>
            <div className="my-4 flex flex-wrap gap-2">{[[showName, setShowName, "Name"], [showPrice, setShowPrice, "Selling price"], [showCode, setShowCode, "Code text"]].map(([checked, setter, label]) => <label key={label} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300"><input type="checkbox" checked={checked} onChange={(event) => setter(event.target.checked)} />{label}</label>)}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={preview} disabled={!queue.length || overLimit || resolving} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-cyan-700 font-semibold text-cyan-300 hover:bg-cyan-900/30 disabled:cursor-not-allowed disabled:opacity-50">
                {resolving ? <Loader2 size={17} className="animate-spin" /> : <Eye size={17} />}Preview labels
              </button>
              <button type="button" onClick={printLabels} disabled={!previewCurrent || !labels.length} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"><Printer size={17} />Print Labels</button>
            </div>
            {resolveError && <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{resolveError.message}</span></div>}
          </section>
        </div>

        <section className="min-w-0 space-y-3" aria-labelledby="label-preview-heading">
          <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3"><h2 id="label-preview-heading" className="font-semibold text-slate-100">Preview</h2><span className="text-xs text-slate-400">{labels.length} labels</span></div>
          <div className="barcode-preview rounded-xl border border-slate-800 bg-slate-900 p-4">
            {labels.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">
                {resolved && !previewCurrent ? "The queue has changed. Preview the labels again before printing." : queue.length ? "Preview the labels to check them before printing." : "Your labels will appear here."}
              </p>
            ) : (
              <div className="barcode-grid">{labels.map(({ key, name, code, identifier, price }) => (
                <article key={key} className="barcode-label" style={{ width: LABEL_SIZES[size].width, height: LABEL_SIZES[size].height }}>
                  <div className="barcode-brand">SOCIO.LK</div>
                  {showName && <div className="barcode-name">{name}</div>}
                  <BarcodeSvg value={code} />
                  {showCode && <div className="barcode-code">{code}</div>}
                  {identifier && <div className="barcode-identifier">{identifier.label} {identifier.value}</div>}
                  {showPrice && price && <div className="barcode-price">{money(price)}</div>}
                </article>
              ))}</div>
            )}
          </div>
        </section>
      </div>
      <style>{`
        .barcode-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:8px; align-content:start; }
        .barcode-label { display:flex; flex-direction:column; justify-content:center; align-items:center; overflow:hidden; gap:1px; padding:2mm; border:1px dashed #475569; background:#fff; color:#111827; text-align:center; }
        .barcode-brand { font:800 6pt Arial,sans-serif; letter-spacing:.6px; line-height:1; }
        .barcode-name { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 7pt Arial,sans-serif; line-height:1.1; }
        .barcode-svg { display:block; width:100%; flex:1 1 auto; min-height:5mm; max-height:12mm; }
        .barcode-code, .barcode-identifier { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:6pt Arial,sans-serif; letter-spacing:.2px; line-height:1.1; }
        .barcode-price { font:700 8pt Arial,sans-serif; line-height:1.1; }
        @media print {
          @page { margin:5mm; }
          body * { visibility:hidden !important; }
          .barcode-preview, .barcode-preview * { visibility:visible !important; }
          .barcode-preview { position:absolute !important; inset:0 auto auto 0 !important; width:100% !important; margin:0 !important; padding:0 !important; border:0 !important; background:white !important; overflow:visible !important; }
          .barcode-preview .barcode-grid { display:grid; grid-template-columns:repeat(auto-fill,${LABEL_SIZES[size].width}); gap:0; }
          .barcode-preview .barcode-label { width:${LABEL_SIZES[size].width} !important; height:${LABEL_SIZES[size].height} !important; min-height:${LABEL_SIZES[size].height} !important; padding:1.5mm !important; border:0.15mm dashed #aaa !important; break-inside:avoid; }
        }
      `}</style>
    </main>
  );
};

export default BarcodeLabels;
