import { useEffect, useId, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AlertCircle, Loader2, ScanBarcode, Smartphone, X } from "lucide-react";
import ImeiPromptDialog from "../ImeiPromptDialog";
import { formatLKR } from "../../../utils/money";
import {
  addLine,
  clearLineError,
  clearScan,
  scanBarcode,
  searchProducts,
  selectLineError,
  selectScanError,
  selectScanQuery,
  selectScanResults,
  selectScanState,
} from "../../../store/slices/posTerminalSlice";

/**
 * ScanBar Component
 *
 * The terminal's home position: one input that takes scanner input and
 * typed searches (planning doc §6, hybrid catalog loading §5).
 *
 * - Barcode mode — all digits (8–20) or an "SLP-" SKU barcode: Enter runs
 *   an exact GET /products/by-barcode lookup. A miss shows inline; a
 *   15-digit miss gets the "looks like an IMEI" hint (Q9).
 * - Text mode — anything else, 2+ chars: a 250 ms debounced
 *   GET /products?search= (branch-scoped, 20 results) opens a result list;
 *   ↑/↓ move, Enter picks, Esc closes.
 *
 * A resolved product is added straight away (addLine, optimistic row), or
 * — when serialized — opens the IMEI prompt first, because the backend
 * requires the IMEI on the line.
 *
 * Scans are processed one at a time in arrival order, so two fast scans
 * can't resolve out of order. The input clears as soon as a scan is
 * submitted, ready for the next one.
 *
 * FOCUS: auto-focuses on mount, except on touch-only devices (coarse
 * pointer), where it would pop the on-screen keyboard (§6 "Touch").
 * `inputRef` lets the terminal re-focus it (F2).
 */

const DEBOUNCE_MS = 250;
const MIN_SEARCH = 2;

/** Scanner-shaped values skip the name search and go to by-barcode. */
const isBarcodeLike = (value) =>
  /^\d{8,20}$/.test(value) || /^SLP-/i.test(value);

const isTouchOnly = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(pointer: coarse)").matches;

const ScanBar = ({ branchId, disabled = false, inputRef }) => {
  const dispatch = useDispatch();
  const localRef = useRef(null);
  const ref = inputRef ?? localRef;
  const debounceRef = useRef(null);
  const scanChain = useRef(Promise.resolve());
  const listId = useId();

  const scanState = useSelector(selectScanState);
  const results = useSelector(selectScanResults);
  const resultsQuery = useSelector(selectScanQuery);
  const scanError = useSelector(selectScanError);
  const lineError = useSelector(selectLineError);

  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [imeiProduct, setImeiProduct] = useState(null);

  const query = value.trim();
  const textMode = query.length >= MIN_SEARCH && !isBarcodeLike(query);
  const resultsCurrent = resultsQuery === query;
  const showList = open && textMode && (resultsCurrent || scanState === "searching");

  // Auto-focus on mount (keyboard / scanner tills only)
  useEffect(() => {
    if (!isTouchOnly()) ref.current?.focus();
  }, [ref]);

  // Debounced name search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!textMode) return undefined;
    debounceRef.current = setTimeout(() => {
      dispatch(searchProducts({ query, branchId }));
      setOpen(true);
      setActive(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [dispatch, query, textMode, branchId]);

  const refocus = () => ref.current?.focus();

  const resetInput = () => {
    clearTimeout(debounceRef.current);
    setValue("");
    setOpen(false);
    setActive(0);
  };

  const addProduct = (product) => {
    resetInput();
    dispatch(clearScan());
    if (product.is_serialized) {
      setImeiProduct(product);
      return;
    }
    dispatch(addLine({ product }));
    refocus();
  };

  const submitBarcode = (barcode) => {
    resetInput();
    scanChain.current = scanChain.current.then(async () => {
      const result = await dispatch(scanBarcode({ barcode }));
      if (scanBarcode.fulfilled.match(result)) addProduct(result.payload);
    });
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown" && showList && results.length) {
      event.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp" && showList && results.length) {
      event.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (open) setOpen(false);
      else resetInput();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!query || disabled) return;
      if (isBarcodeLike(query)) {
        submitBarcode(query);
      } else if (resultsCurrent && results[active]) {
        addProduct(results[active]);
      } else if (textMode) {
        // Typed faster than the debounce — search now.
        clearTimeout(debounceRef.current);
        dispatch(searchProducts({ query, branchId }));
        setOpen(true);
        setActive(0);
      }
    }
  };

  const handleChange = (event) => {
    setValue(event.target.value);
    if (scanError) dispatch(clearScan());
    if (!open) setOpen(true);
  };

  const feedback = scanError || lineError;
  const activeId = showList && results[active] ? `${listId}-opt-${active}` : undefined;

  return (
    <div className="relative">
      <div className="relative">
        <ScanBarcode
          size={20}
          aria-hidden="true"
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
        />
        <input
          ref={ref}
          type="text"
          role="combobox"
          aria-label="Scan barcode or search products"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => setOpen(false)}
          onFocus={() => textMode && setOpen(true)}
          placeholder="Scan a barcode or type a product name"
          className="
            w-full h-12 pl-11 pr-11 rounded-xl text-base
            bg-white dark:bg-slate-900
            border border-slate-300 dark:border-slate-700
            text-slate-900 dark:text-slate-100
            placeholder:text-slate-400 dark:placeholder:text-slate-500
            shadow-sm
            focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500
            disabled:opacity-60
          "
        />
        {scanState !== "idle" && (
          <Loader2
            size={18}
            aria-label={scanState === "loading" ? "Looking up barcode" : "Searching"}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-cyan-600 dark:text-cyan-400"
          />
        )}
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching products"
          className="
            absolute z-20 left-0 right-0 mt-1.5 max-h-80 overflow-y-auto py-1
            rounded-xl border border-slate-200 dark:border-slate-700
            bg-white dark:bg-slate-900 shadow-xl shadow-slate-900/10 dark:shadow-black/40
          "
        >
          {resultsCurrent && results.length === 0 && (
            <li className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
              No products match &ldquo;{query}&rdquo;
            </li>
          )}
          {!resultsCurrent && (
            <li className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">Searching…</li>
          )}
          {resultsCurrent &&
            results.map((product, index) => (
              <li
                key={product.id}
                id={`${listId}-opt-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => addProduct(product)}
                className={`
                  flex items-center gap-3 px-4 py-2.5 cursor-pointer
                  ${index === active ? "bg-cyan-50 dark:bg-cyan-900/30" : ""}
                `}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {product.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {product.sku}
                    {product.barcode ? ` · ${product.barcode}` : ""}
                  </p>
                </div>
                {product.is_serialized && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                    <Smartphone size={11} aria-hidden="true" />
                    IMEI
                  </span>
                )}
                <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                  {formatLKR(product.selling_price)}
                </span>
              </li>
            ))}
        </ul>
      )}

      {feedback && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          <AlertCircle size={16} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{feedback.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              dispatch(scanError ? clearScan() : clearLineError());
              refocus();
            }}
            className="flex-shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      <ImeiPromptDialog
        product={imeiProduct}
        onClose={() => {
          setImeiProduct(null);
          refocus();
        }}
        onSubmit={async (imei) => {
          try {
            await dispatch(addLine({ product: imeiProduct, imei })).unwrap();
          } catch (err) {
            // Shown inside the dialog — don't repeat it under the scan bar.
            dispatch(clearLineError());
            throw err;
          }
        }}
      />
    </div>
  );
};

export default ScanBar;
