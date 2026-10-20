import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, Loader2, Smartphone } from "lucide-react";
import { listProducts } from "../../../services/productsService";
import {
  NO_TRADE_IN_PRODUCT,
  TRADE_IN_PRODUCT_LIMIT,
  isUsedProduct as isUsed,
  tradeInCandidates,
} from "./tradeIn";

/**
 * TradeInProductPicker Component
 *
 * Combobox for the trade-in's catalogue product (planning doc P4-3).
 *
 * SEARCH: 2+ chars, debounced 250 ms,
 * GET /products?search=&branchId=&productType=PHONE&limit=20. The server
 * can't filter on is_serialized, so the client keeps serialized, active
 * products only, with USED SKUs (phone_condition === "USED") first and
 * a "Used" badge. No match: "No used-phone product for this model. Ask
 * an admin to add one." — products aren't created from the till.
 *
 * KEYS: ↑/↓ move the highlight, Enter or a click picks, Esc closes the
 * list (and only the list — it doesn't reach the dialog). Enter after a
 * pick (list closed) moves on to the IMEI, never submits: `onAdvance`.
 * Typing after a pick clears it.
 *
 * Results live in local state (dialog-local lookup, §7); stale responses
 * are dropped by request sequence. The list overlays the fields below
 * it, so it never changes the dialog's height.
 *
 * PROPS:
 * - branchId: the sale's branch (the product must be stocked there)
 * - product: the picked product row, or null
 * - onPick: (product | null) => void
 * - onAdvance: focus the next field (IMEI)
 * - error: field error message
 * - disabled
 * - name, ref: the input's (react-hook-form Controller: setFocus)
 */

const DEBOUNCE_MS = 250;
const MIN_SEARCH = 2;

const UsedBadge = () => (
  <span className="flex-shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
    Used
  </span>
);

const TradeInProductPicker = ({ branchId, product, onPick, onAdvance, error, disabled, name, ref }) => {
  const id = useId();
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const requestSeq = useRef(0);

  const [value, setValue] = useState(product?.name ?? "");
  const [results, setResults] = useState([]);
  const [resultsQuery, setResultsQuery] = useState(null);
  const [searchError, setSearchError] = useState(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  const query = value.trim();
  // A picked product's name in the box is not a search.
  const canSearch = !product && query.length >= MIN_SEARCH;
  const resultsCurrent = canSearch && resultsQuery === query;
  const searching = canSearch && !resultsCurrent && !searchError;

  useEffect(() => {
    if (!canSearch) {
      requestSeq.current += 1;
      return undefined;
    }
    const timer = setTimeout(async () => {
      const seq = ++requestSeq.current;
      setSearchError(null);
      try {
        const page = await listProducts({
          search: query,
          branchId,
          productType: "PHONE",
          limit: TRADE_IN_PRODUCT_LIMIT,
        });
        if (seq !== requestSeq.current) return;
        setResults(tradeInCandidates(page.data ?? []));
        setResultsQuery(query);
        setActive(0);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setResults([]);
        setResultsQuery(null);
        setSearchError(err?.response?.data?.message || err?.message || "Search failed");
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, canSearch, branchId]);

  const showList = open && canSearch;
  const options = resultsCurrent ? results : [];

  const pick = (picked) => {
    onPick(picked);
    setValue(picked.name);
    setOpen(false);
    onAdvance?.();
  };

  const handleChange = (event) => {
    setValue(event.target.value);
    setSearchError(null);
    setOpen(true);
    if (product) onPick(null);
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown" && options.length) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % options.length);
    } else if (event.key === "ArrowUp" && options.length) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (event.key === "Enter") {
      // Never submits from here (the dialog skips prevented Enters).
      event.preventDefault();
      if (showList && options[active]) pick(options[active]);
      else if (product) onAdvance?.();
    } else if (event.key === "Escape" && showList) {
      // Close the list only; the dialog stays open.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  const activeId = showList && options[active] ? `${id}-opt-${active}` : undefined;

  let status = null;
  if (searchError) status = null;
  else if (searching) status = "Searching…";
  else if (resultsCurrent && !results.length) status = NO_TRADE_IN_PRODUCT;

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <label
        htmlFor={id}
        className="text-xs uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400"
      >
        Product<span className="text-red-500 ml-1">*</span>
      </label>
      <div className="relative">
        <div
          className={`
            flex items-center gap-3 px-3.5 h-11 rounded-lg border transition-all
            bg-slate-50 dark:bg-slate-800
            ${error ? "border-red-400 dark:border-red-500" : "border-slate-300 dark:border-slate-600 focus-within:border-cyan-500 dark:focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-500/20 dark:focus-within:ring-cyan-400/20"}
            ${disabled ? "opacity-60 cursor-not-allowed" : ""}
          `}
        >
          <Smartphone size={16} aria-hidden="true" className="text-slate-400 dark:text-slate-500" />
          <input
            ref={ref}
            id={id}
            name={name}
            type="text"
            role="combobox"
            aria-expanded={showList && options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search used-phone models"
            value={value}
            disabled={disabled}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            className="flex-1 min-w-0 bg-transparent text-sm outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
          {product && isUsed(product) && <UsedBadge />}
          {searching && (
            <Loader2
              size={16}
              aria-label="Searching"
              className="animate-spin text-cyan-600 dark:text-cyan-400"
            />
          )}
        </div>

        {showList && (status || searchError || options.length > 0) && (
          <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden">
            {searchError && (
              <p role="alert" className="flex items-start gap-2 px-4 py-2.5 text-sm text-red-600 dark:text-red-400">
                <AlertCircle size={16} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
                {searchError}
              </p>
            )}
            {status && (
              <p className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">{status}</p>
            )}
            {options.length > 0 && (
              <ul
                id={listId}
                role="listbox"
                aria-label="Trade-in products"
                className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800"
              >
                {options.map((option, index) => (
                  <li
                    key={option.id}
                    id={`${id}-opt-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(option)}
                    className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer ${index === active ? "bg-cyan-50 dark:bg-cyan-900/40" : ""}`}
                  >
                    <span className="flex-1 min-w-0 text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {option.name}
                    </span>
                    {isUsed(option) && <UsedBadge />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {error && (
        <p id={errorId} className="text-xs text-red-500 dark:text-red-400 mt-0.5">
          {error}
        </p>
      )}
    </div>
  );
};

export default TradeInProductPicker;
