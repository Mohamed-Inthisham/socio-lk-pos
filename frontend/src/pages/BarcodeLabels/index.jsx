import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSelector } from "react-redux";
import {
  AlertCircle,
  AlertTriangle,
  Barcode,
  Building2,
  Check,
  CheckCircle2,
  Eye,
  Info,
  Loader2,
  Lock,
  Minus,
  Package,
  Plus,
  Printer,
  Search,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import usePermissions from "../../hooks/usePermissions";
import { listBranches } from "../../services/branchesService";
import {
  resolveLabelQueue,
  searchProductLabels,
  searchUnitLabels,
} from "../../services/barcodeLabelsService";
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
  previewEntries,
  productEntry,
  queueSignature,
  toResolveItems,
  unitEntry,
} from "./labelQueue";
import { loadLayouts, saveLayouts } from "./labelDesign";
import { LabelFace } from "./LabelFace";
import { LABEL_CSS, labelProblems, money } from "./labelRender";
import LabelDesigner from "./LabelDesigner";

const PAGE_SIZE = 10;
const MIN_SEARCH = 2;
const DEBOUNCE_MS = 300;
// Printed label sizes. The print sheet uses these exact dimensions; the
// screen preview only scales a copy of them (ZOOM_LEVELS).
const LABEL_SIZES = {
  "50x25": { width: "50mm", height: "25mm", widthMm: 50, heightMm: 25 },
  "40x20": { width: "40mm", height: "20mm", widthMm: 40, heightMm: 20 },
  "30x20": { width: "30mm", height: "20mm", widthMm: 30, heightMm: 20 },
};
const ZOOM_LEVELS = [1, 1.5, 2];

// Theme classes, as the other admin pages use them (light and dark).
const panel = "rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const fieldClass =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500";
const mutedText = "text-slate-500 dark:text-slate-400";
const subtleButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800";

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
  const clearText = () => {
    clearTimeout(timer.current);
    setText("");
    commit("");
  };
  const tooShort = text.trim().length > 0 && text.trim().length < MIN_SEARCH;

  return { text, changeText, clearText, query, page, setPage, result, tooShort };
};

/** The search box, results, states and pager shared by both tabs. */
const SearchResults = ({ search, label, placeholder, hint, emptyMessage, renderRow }) => {
  const { text, changeText, clearText, query, page, setPage, result, tooShort } = search;
  return (
    <div className="space-y-3">
      <div>
        <label className="relative block">
          <span className="sr-only">{label}</span>
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={text} onChange={(event) => changeText(event.target.value)} placeholder={placeholder} aria-label={label} className={`${fieldClass} pl-10 pr-10`} />
          {text && (
            <button type="button" onClick={clearText} aria-label={`Clear ${label.toLowerCase()}`} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200">
              <X size={16} />
            </button>
          )}
        </label>
        <p className={`mt-1.5 text-xs ${tooShort ? "text-amber-700 dark:text-amber-400" : mutedText}`}>
          {tooShort ? `Type at least ${MIN_SEARCH} characters to search.` : hint}
        </p>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className={mutedText}>
          {result.status === "ready" ? `${result.total} ${result.total === 1 ? "result" : "results"}${query ? ` for “${query}”` : ""}` : " "}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800" aria-busy={result.status === "loading"}>
        {result.status === "loading" && (
          <div className={`flex items-center justify-center gap-2 p-6 text-sm ${mutedText}`}><Loader2 size={16} className="animate-spin" />Loading…</div>
        )}
        {result.status === "error" && (
          <p role="alert" className="flex items-center gap-2 p-4 text-sm text-red-700 dark:text-red-300"><AlertCircle size={16} className="shrink-0" />{result.error}</p>
        )}
        {result.status === "ready" && result.rows.length === 0 && (
          <p className={`p-6 text-center text-sm ${mutedText}`}>{query ? `Nothing matches “${query}”.` : emptyMessage}</p>
        )}
        {result.status === "ready" && result.rows.length > 0 && (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">{result.rows.map(renderRow)}</ul>
        )}
      </div>

      {result.pages > 1 && (
        <nav aria-label={`${label} pages`} className="flex items-center justify-between gap-3 text-sm">
          <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1 || result.status === "loading"} className={subtleButton}>Previous</button>
          <span className={`tabular-nums ${mutedText}`}>Page {page} of {result.pages}</span>
          <button type="button" onClick={() => setPage(Math.min(result.pages, page + 1))} disabled={page >= result.pages || result.status === "loading"} className={subtleButton}>Next</button>
        </nav>
      )}
    </div>
  );
};

const AddButton = ({ queued, name, onAdd }) =>
  queued ? (
    <button type="button" disabled aria-label={`${name} is in the queue`} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
      <Check size={15} />Added
    </button>
  ) : (
    <button type="button" onClick={onAdd} aria-label={`Add ${name}`} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-cyan-600 px-3 py-1.5 text-sm font-medium text-cyan-700 hover:bg-cyan-50 dark:border-cyan-500 dark:text-cyan-300 dark:hover:bg-cyan-500/10">
      <Plus size={15} />Add
    </button>
  );

const KindBadge = ({ kind }) =>
  kind === "PRODUCT" ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30"><Package size={12} />Product</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30"><Smartphone size={12} />Unit</span>
  );

/**
 * A product's copies. The text can be cleared and retyped; only a whole
 * number reaches the queue, clamped to 1–500, and leaving the field shows
 * the queued value again. The − and + buttons step by one.
 */
const CopiesInput = ({ name, quantity, onChange }) => {
  const [draft, setDraft] = useState(String(quantity));
  const [editing, setEditing] = useState(false);
  const stepClass = "flex h-8 w-8 items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-700";
  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
      <button type="button" aria-label={`Fewer copies of ${name}`} disabled={quantity <= MIN_COPIES} onClick={() => onChange(String(quantity - 1))} className={stepClass}><Minus size={14} /></button>
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
        className="h-8 w-14 border-x border-slate-300 bg-white text-center text-sm tabular-nums text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />
      <button type="button" aria-label={`More copies of ${name}`} disabled={quantity >= MAX_COPIES} onClick={() => onChange(String(quantity + 1))} className={stepClass}><Plus size={14} /></button>
    </div>
  );
};

const StepHeading = ({ id, step, title, children }) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <h2 id={id} className="flex items-center gap-2.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
      <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-600 text-sm font-bold text-white">{step}</span>
      {title}
    </h2>
    {children}
  </div>
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
  const [zoom, setZoom] = useState(2);
  // The label design (order, text styles, rotation), remembered in this browser.
  // Label layouts edited in the designer, per size and kind, remembered in
  // this browser. Sizes and kinds never edited use the default layout.
  const [layouts, setLayouts] = useState(loadLayouts);
  useEffect(() => saveLayouts(layouts), [layouts]);
  // The last resolved queue: { rows, totalLabels, signature }.
  const [resolved, setResolved] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState(null);
  const previewRef = useRef(null);
  // The print sheet lives in its own <body> child: index.css hides every
  // other one when printing (receipts). It exists only while this page does.
  const [printRoot] = useState(() => {
    const element = document.createElement("div");
    element.id = "barcode-label-print-root";
    return element;
  });
  useEffect(() => {
    document.body.appendChild(printRoot);
    return () => printRoot.remove();
  }, [printRoot]);

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
  const entries = useMemo(() => (previewCurrent ? previewEntries(resolved.rows) : []), [previewCurrent, resolved]);

  // Preview labels with an item past the label's edge or a text cut short
  // (labelProblems: a long name is shortened by design and doesn't count).
  const [overflowing, setOverflowing] = useState(() => new Set());
  useLayoutEffect(() => {
    const keys = new Set();
    previewRef.current?.querySelectorAll("[data-entry-key]").forEach((item) => {
      const face = item.querySelector(".barcode-label");
      if (face && labelProblems(face).size > 0) keys.add(item.dataset.entryKey);
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOverflowing((current) => (current.size === keys.size && [...keys].every((key) => current.has(key)) ? current : keys));
  }, [entries, size, layouts]);
  const previewState = !queue.length ? "empty" : previewCurrent ? "current" : resolved ? "stale" : "none";

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
      // Bring the preview into view on screens where it sits below.
      requestAnimationFrame?.(() => previewRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
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

  const tabButton = (value, text, Icon, count) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      aria-controls={`labels-tab-${value}`}
      id={`labels-tab-button-${value}`}
      onClick={() => setTab(value)}
      className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold transition ${
        tab === value
          ? "bg-white text-cyan-700 shadow-sm ring-1 ring-slate-200 dark:bg-slate-700 dark:text-white dark:ring-slate-600"
          : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
      }`}
    >
      <Icon size={16} aria-hidden="true" />
      {text}
      {count > 0 && <span className="rounded-full bg-cyan-600 px-1.5 text-[11px] font-bold leading-5 text-white" aria-hidden="true">{count}</span>}
    </button>
  );
  const queuedProducts = queue.filter((item) => item.kind === "PRODUCT").length;
  const queuedUnits = queue.length - queuedProducts;

  return (
    // relative: an absolute child (Tailwind's sr-only) must be placed inside
    // the scrolling <main>. Without it, it was placed against the document
    // and stretched the whole window (a black band under the app).
    <div className="relative mx-auto max-w-screen-2xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="rounded-xl bg-cyan-500/10 p-3 text-cyan-600 dark:text-cyan-400"><Barcode size={22} /></div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Barcode Labels</h1>
          <p className={`text-sm ${mutedText}`}>Add products or individual items, check the preview, then print.</p>
        </div>
      </header>

      {branchError && <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"><AlertCircle size={16} />{branchError}<button className="ml-auto" onClick={() => setBranchError("")} aria-label="Dismiss"><X size={16} /></button></div>}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className={`${panel} min-w-0 space-y-4 p-4 sm:p-5`} aria-labelledby="add-labels-heading">
          <StepHeading id="add-labels-heading" step="1" title="Add labels" />
          <div role="tablist" aria-label="Label type" className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {tabButton("PRODUCT", "Products", Package, queuedProducts)}
            {tabButton("UNIT", "Individual items", Smartphone, queuedUnits)}
          </div>

          <div role="tabpanel" id="labels-tab-PRODUCT" aria-labelledby="labels-tab-button-PRODUCT" hidden={tab !== "PRODUCT"} className="space-y-3">
            <p className={`flex gap-2 text-sm ${mutedText}`}><Info size={16} className="mt-0.5 shrink-0" />Quantity-tracked products share one product label. Choose how many copies in the print queue.</p>
            <SearchResults
              search={productSearch}
              label="Search products"
              placeholder="Product name, SKU or barcode"
              hint="Matches part of the name, SKU or barcode."
              emptyMessage="No quantity-tracked products found."
              renderRow={(row) => (
                <li key={row.product_id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900 dark:text-slate-100">{row.name}</p>
                    <p className={`mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${mutedText}`}>
                      <span className="font-mono">{row.sku}</span>
                      <span className="font-mono">{row.barcode}</span>
                    </p>
                    <p className={`mt-0.5 text-xs sm:hidden ${row.selling_price ? "text-slate-700 dark:text-slate-200" : "italic text-slate-400"}`}>{money(row.selling_price) || "No price"}</p>
                  </div>
                  <span className={`hidden shrink-0 text-sm tabular-nums sm:block ${row.selling_price ? "text-slate-700 dark:text-slate-200" : "italic text-slate-400"}`}>{money(row.selling_price) || "No price"}</span>
                  <AddButton queued={queuedKeys.has(`PRODUCT:${row.product_id}`)} name={row.name} onAdd={() => add(productEntry(row))} />
                </li>
              )}
            />
          </div>

          <div role="tabpanel" id="labels-tab-UNIT" aria-labelledby="labels-tab-button-UNIT" hidden={tab !== "UNIT"} className="space-y-3">
            <p className={`flex gap-2 text-sm ${mutedText}`}><Info size={16} className="mt-0.5 shrink-0" />Phones and serial-number items get one label each. The barcode is the item’s unit code; its IMEI or serial number is printed as text.</p>
            {isAdmin ? (
              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"><Building2 size={13} />Branch</span>
                <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className={fieldClass}>
                  <option value="">All branches</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>
            ) : (
              <div>
                <label className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"><Lock size={13} />Branch</span>
                  <input value={ownBranchName} readOnly aria-describedby="labels-branch-hint" className={`${fieldClass} cursor-not-allowed bg-slate-50 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300`} />
                </label>
                <p id="labels-branch-hint" className={`mt-1 text-xs ${mutedText}`}>Managers print items from their own branch.</p>
              </div>
            )}
            <SearchResults
              search={unitSearch}
              label="Search items"
              placeholder="IMEI, serial number, unit code or product"
              hint="Only items in stock are listed."
              emptyMessage="No in-stock IMEI or serial-number items found."
              renderRow={(row) => (
                <li key={row.unit_id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900 dark:text-slate-100">{row.name}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-slate-700 dark:text-slate-300">{identifierLabel(row.identifier_type)} {row.identifier}</p>
                    <p className={`mt-0.5 flex flex-wrap gap-x-3 text-xs ${mutedText}`}>
                      <span className="font-mono">{row.unit_code}</span>
                      {(isAdmin && !branchId) && <span>{row.branch.name}</span>}
                      <span className={`sm:hidden ${row.selling_price ? "text-slate-700 dark:text-slate-200" : "italic text-slate-400"}`}>{money(row.selling_price) || "No price"}</span>
                    </p>
                  </div>
                  <span className={`hidden shrink-0 text-sm tabular-nums sm:block ${row.selling_price ? "text-slate-700 dark:text-slate-200" : "italic text-slate-400"}`}>{money(row.selling_price) || "No price"}</span>
                  <AddButton queued={queuedKeys.has(`UNIT:${row.unit_id}`)} name={`${row.name} ${row.unit_code}`} onAdd={() => add(unitEntry(row))} />
                </li>
              )}
            />
          </div>
        </section>

        <section className={`${panel} min-w-0 space-y-4 p-4 sm:p-5`} aria-labelledby="label-queue-heading">
          <StepHeading id="label-queue-heading" step="2" title="Print queue">
            <button type="button" onClick={clearAll} disabled={!queue.length} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:invisible dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-300">
              <Trash2 size={14} />Clear all
            </button>
          </StepHeading>

          <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${overLimit ? "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300" : "bg-slate-50 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300"}`}>
            <span role="status" aria-label="Queue total">
              {queue.length === 0
                ? "No labels yet"
                : <>{queue.length} {queue.length === 1 ? "entry" : "entries"} · <strong>{totalLabels} {totalLabels === 1 ? "label" : "labels"}</strong> {overLimit ? `— more than the ${MAX_LABELS}-label limit. Remove items or lower copies.` : `(up to ${MAX_LABELS})`}</>}
            </span>
          </div>

          {queue.length === 0 ? (
            <div className={`rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm dark:border-slate-700 ${mutedText}`}>
              Add products or individual items to start a label sheet.
            </div>
          ) : (
            <ol className="space-y-2" aria-label="Label queue">
              {queue.map((item, index) => {
                const itemError = resolveError?.itemErrors[item.key];
                const itemName = item.kind === "PRODUCT" ? item.name : `${item.name} ${item.unit_code}`;
                return (
                  <li key={item.key} className={`rounded-lg border p-3 ${itemError ? "border-red-300 bg-red-50/60 dark:border-red-700 dark:bg-red-950/30" : "border-slate-200 dark:border-slate-700"}`}>
                    <div className="flex items-center gap-3">
                      <span className={`w-5 shrink-0 text-right text-xs tabular-nums ${mutedText}`}>{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><KindBadge kind={item.kind} /><p title={item.name} className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{item.name}</p></div>
                        <p className={`mt-1 truncate font-mono text-xs ${mutedText}`}>
                          {item.kind === "PRODUCT"
                            ? `Product label · ${item.sku}`
                            : `${identifierLabel(item.identifier_type)} ${item.identifier} · ${item.unit_code}`}
                        </p>
                      </div>
                      {item.kind === "PRODUCT" ? (
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <CopiesInput name={item.name} quantity={item.quantity} onChange={(value) => updateCopies(item.key, value)} />
                          <span className={`text-[11px] ${mutedText}`}>copies</span>
                        </div>
                      ) : (
                        <span className={`shrink-0 text-xs ${mutedText}`}>1 label</span>
                      )}
                      <button type="button" onClick={() => remove(item.key)} aria-label={`Remove ${itemName}`} title="Remove from queue" className="shrink-0 rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"><Trash2 size={17} /></button>
                    </div>
                    {itemError && <p className="mt-2 flex items-start gap-1.5 pl-8 text-xs font-medium text-red-700 dark:text-red-300"><AlertCircle size={14} className="mt-px shrink-0" />{itemError}</p>}
                  </li>
                );
              })}
            </ol>
          )}

          {previewState === "stale" && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />The queue changed after the last preview. Preview again before printing.
            </p>
          )}
          {previewState === "current" && (
            <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />Preview is up to date. Ready to print.
            </p>
          )}
          {resolveError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{resolveError.message}</span></div>}

          <button type="button" onClick={preview} disabled={!queue.length || overLimit || resolving} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50">
            {resolving ? <Loader2 size={17} className="animate-spin" /> : <Eye size={17} />}Preview labels
          </button>
        </section>
      </div>

      <section className={`${panel} space-y-4 p-4 sm:p-5`} aria-labelledby="label-design-heading">
        <StepHeading id="label-design-heading" step="3" title="Design labels">
          <label className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Label size</span>
            <select value={size} onChange={(event) => setSize(event.target.value)} className={`${fieldClass} h-10 w-40`}>
              <option value="50x25">50 × 25 mm</option>
              <option value="40x20">40 × 20 mm</option>
              <option value="30x20">30 × 20 mm</option>
            </select>
          </label>
        </StepHeading>
        <LabelDesigner size={size} layouts={layouts} onChange={setLayouts} />
      </section>

      <section ref={previewRef} className={`${panel} scroll-mt-4`} aria-labelledby="label-preview-heading">
        <div className="space-y-4 border-b border-slate-200 p-5 dark:border-slate-800">
          <StepHeading id="label-preview-heading" step="4" title="Preview and print">
            <div className="flex items-center gap-3">
              <span className={`text-sm tabular-nums ${mutedText}`}>{labels.length} {labels.length === 1 ? "label" : "labels"} to print</span>
              <button type="button" onClick={printLabels} disabled={!previewCurrent || !labels.length} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-700 px-4 font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"><Printer size={17} />Print Labels</button>
            </div>
          </StepHeading>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div role="group" aria-label="Preview zoom">
              <span aria-hidden="true" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Zoom</span>
              <div className="flex h-10 overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
                {ZOOM_LEVELS.map((level) => (
                  <button key={level} type="button" aria-pressed={zoom === level} onClick={() => setZoom(level)} className={`px-3 text-sm tabular-nums ${zoom === level ? "bg-cyan-600 font-semibold text-white" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
                    {level * 100}%
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className={`text-xs ${mutedText}`}>
            Code 128 · labels show the selling price, never a cost price. The zoom only enlarges the preview: labels print at {LABEL_SIZES[size].widthMm} × {LABEL_SIZES[size].heightMm} mm.
          </p>
        </div>

        <div className="bg-slate-100 p-4 sm:p-6 dark:bg-slate-950/60">
          <div className="min-w-0">
          {entries.length === 0 ? (
            <p className={`py-12 text-center text-sm ${mutedText}`}>
              {previewState === "stale" ? "The queue has changed. Preview the labels again before printing." : queue.length ? "Preview the labels to check them before printing." : "Your labels will appear here."}
            </p>
          ) : (
            <>
            {overflowing.size > 0 && (
              <p role="status" className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                {overflowing.size} {overflowing.size === 1 ? "label doesn’t" : "labels don’t"} fit on {LABEL_SIZES[size].widthMm} × {LABEL_SIZES[size].heightMm} mm: an item goes past the label’s edge, overlaps another, or is cut short. Adjust the layout in Design labels, or choose a larger size.
              </p>
            )}
            <ol className="space-y-4" aria-label="Label preview">
              {entries.map((entry) => (
                <li key={entry.key} data-entry-key={entry.key} className={`flex min-w-0 flex-col gap-4 rounded-xl border bg-white p-4 sm:flex-row sm:items-center dark:bg-slate-900 ${overflowing.has(entry.key) ? "border-amber-300 dark:border-amber-500/50" : "border-slate-200 dark:border-slate-800"}`}>
                  {/* A phone at 200% is narrower than the label: it scrolls here, not the page. */}
                  <div className="max-w-full shrink-0 overflow-x-auto p-1">
                    <div className="overflow-hidden rounded-sm shadow-md ring-1 ring-slate-300" style={{ width: `${LABEL_SIZES[size].widthMm * zoom}mm`, height: `${LABEL_SIZES[size].heightMm * zoom}mm` }}>
                      <div className="barcode-zoom" style={{ transform: `scale(${zoom})` }}>
                        <LabelFace label={entry.label} size={size} layouts={layouts} />
                      </div>
                    </div>
                  </div>
                  <dl className="min-w-0 space-y-1.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <KindBadge kind={entry.kind} />
                      <span className={`tabular-nums ${mutedText}`}>{entry.copies > 1 ? `Labels ${entry.first}–${entry.last}` : `Label ${entry.first}`} of {labels.length}</span>
                      {entry.copies > 1 && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">× {entry.copies} copies</span>}
                      {overflowing.has(entry.key) && <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30"><AlertTriangle size={12} />Doesn’t fit</span>}
                    </div>
                    <dt className="sr-only">Name</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">{entry.label.name}</dd>
                    <dt className={`text-xs ${mutedText}`}>Scans as</dt>
                    <dd className="font-mono text-slate-800 dark:text-slate-200">{entry.label.code}</dd>
                    {entry.label.identifier && <>
                      <dt className={`text-xs ${mutedText}`}>{entry.label.identifier.label === "IMEI" ? "IMEI (text only)" : "Serial number (text only)"}</dt>
                      <dd className="font-mono text-slate-800 dark:text-slate-200">{entry.label.identifier.value}</dd>
                    </>}
                    <dt className={`text-xs ${mutedText}`}>Selling price</dt>
                    <dd className="text-slate-800 dark:text-slate-200">{money(entry.label.price) || "Not set: no price printed"}</dd>
                  </dl>
                </li>
              ))}
            </ol>
            </>
          )}
          </div>
        </div>
      </section>

      {/* The sheet that prints: every copy at its exact size. Hidden on screen. */}
      {createPortal(
        <div className="barcode-print-sheet" aria-hidden="true">
          <div className="barcode-grid">
            {labels.map((label) => <LabelFace key={label.key} label={label} size={size} layouts={layouts} />)}
          </div>
        </div>,
        printRoot,
      )}

      <style>{`
        ${LABEL_CSS}
        .barcode-zoom { transform-origin:top left; width:max-content; }
        .barcode-print-sheet { display:none; }
        @media print {
          /* One browser page must match one die-cut label. Otherwise the
             printer's USER page length advances across sticker boundaries. */
          @page { size:${LABEL_SIZES[size].width} ${LABEL_SIZES[size].height}; margin:0; }
          body * { visibility:hidden !important; }
          .barcode-print-sheet { display:block !important; }
          .barcode-print-sheet, .barcode-print-sheet * { visibility:visible !important; }
          .barcode-print-sheet { position:absolute !important; inset:0 auto auto 0 !important; width:100% !important; margin:0 !important; padding:0 !important; border:0 !important; background:white !important; overflow:visible !important; }
          .barcode-print-sheet .barcode-grid { display:block; width:${LABEL_SIZES[size].width}; margin:0 auto; }
          .barcode-print-sheet .barcode-label { box-sizing:border-box !important; display:block; width:${LABEL_SIZES[size].width} !important; height:${LABEL_SIZES[size].height} !important; min-height:${LABEL_SIZES[size].height} !important; padding:0 !important; border:0 !important; break-inside:avoid; break-after:page; page-break-after:always; }
          .barcode-print-sheet .barcode-svg { shape-rendering:crispEdges; }
          .barcode-print-sheet .barcode-label:last-child { break-after:auto; page-break-after:auto; }
        }
      `}</style>
    </div>
  );
};

export default BarcodeLabels;
