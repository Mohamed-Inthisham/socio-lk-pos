import { useEffect, useId, useRef, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { AlertCircle, Loader2, ScanBarcode, Smartphone, X } from "lucide-react";
import ImeiPromptDialog from "../ImeiPromptDialog";
import { formatLKR } from "../../../utils/money";
import { isTouchOnly } from "../../../utils/device";
import {
  addLine,
  clearLineError,
  clearScan,
  scanBarcode,
  scanUnitIdentifier,
  searchProducts,
  selectLineError,
  selectScanError,
  selectScanQuery,
  selectScanResults,
  selectScanState,
  startNextSale,
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
 * SALE COMPLETE (P5-10): the bar stays live under the Sale complete panel.
 * A resolved product first starts the next sale (startNextSale: waits for
 * the background draft) and is then added to it; Enter on the empty bar
 * just starts the next sale. Outside that panel, adding stays immediate.
 *
 * FOCUS: auto-focuses on mount, except on touch-only devices (coarse
 * pointer), where it would pop the on-screen keyboard (§6 "Touch").
 * `inputRef` lets the terminal re-focus it (F2, focus hand-offs). An "F2"
 * key chip shows on fine-pointer devices while the bar is empty.
 */

const DEBOUNCE_MS = 250;
const MIN_SEARCH = 2;

/** Scanner-shaped values skip the name search and go to by-barcode. */
const isBarcodeLike = (value) =>
  /^\d{8,20}$/.test(value) || /^SLP-/i.test(value);
const isUnitIdentifierLike = (value) =>
  /^[A-Z0-9][A-Z0-9._/-]{0,99}$/i.test(value);

const ScanBar = ({ branchId, disabled = false, inputRef }) => {
  const dispatch = useDispatch();
  const store = useStore();
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

  const saleCompleteShowing = () => store.getState().posTerminal.status === "completed";

  const add = (product) => {
    if (product.is_serialized) {
      setImeiProduct(product);
      return;
    }
    dispatch(addLine({ product }));
    refocus();
  };

  // Returns a promise only while the Sale complete panel shows (the next
  // sale has to open first); otherwise adds at once, as before P5.
  const addProduct = (product) => {
    resetInput();
    dispatch(clearScan());
    if (!saleCompleteShowing()) return add(product);
    return dispatch(startNextSale()).then((started) => {
      if (started) add(product);
    });
  };

  const addScannedUnit = (unit) => {
    resetInput();
    dispatch(clearScan());
    const addUnit = () =>
      dispatch(addLine({ product: unit.product, identifier: unit.identifier }));
    if (!saleCompleteShowing()) return addUnit();
    return dispatch(startNextSale()).then((started) => {
      if (started) return addUnit();
      return undefined;
    });
  };

  const submitScan = (barcode) => {
    resetInput();
    scanChain.current = scanChain.current.then(async () => {
      if (isUnitIdentifierLike(barcode) && branchId) {
        const unitResult = await dispatch(scanUnitIdentifier({ identifier: barcode, branchId }));
        if (scanUnitIdentifier.fulfilled.match(unitResult) && unitResult.payload) {
          await addScannedUnit(unitResult.payload);
          return;
        }
        if (scanUnitIdentifier.rejected.match(unitResult)) return;
      }
      if (!isBarcodeLike(barcode)) {
        if (resultsCurrent && results[active]) addProduct(results[active]);
        else if (textMode) {
          setValue(barcode);
          setOpen(true);
          dispatch(searchProducts({ query: barcode, branchId }));
          setActive(0);
        }
        return;
      }
      const result = await dispatch(scanBarcode({ barcode }));
      if (scanBarcode.fulfilled.match(result)) await addProduct(result.payload);
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
      if (!query && !disabled && saleCompleteShowing()) {
        dispatch(startNextSale());
        return;
      }
      if (!query || disabled) return;
      if (isBarcodeLike(query) || isUnitIdentifierLike(query)) {
        submitScan(query);
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
        {scanState === "idle" && !value && (
          <kbd
            aria-hidden="true"
            className="
              hidden [@media(hover:hover)_and_(pointer:fine)]:inline-flex
              absolute right-3 top-1/2 -translate-y-1/2 items-center px-1.5 h-6 rounded-md
              text-[11px] font-semibold font-sans text-slate-500 dark:text-slate-400
              border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800
              pointer-events-none
            "
          >
            F2
          </kbd>
        )}
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
          // Raised surface (lighter than the cart card in dark mode, ring +
          // heavy shadow) so the cart rows it covers don't read as missing.
          className="
            absolute z-20 left-0 right-0 mt-1.5 max-h-80 overflow-y-auto pb-1
            rounded-xl border border-slate-300 dark:border-slate-600
            ring-1 ring-cyan-500/20
            bg-white dark:bg-slate-800
            shadow-2xl shadow-slate-900/20 dark:shadow-black/70
          "
        >
          <li
            role="presentation"
            className="sticky top-0 px-4 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700"
          >
            {!resultsCurrent
              ? "Searching…"
              : results.length === 0
                ? `No products match “${query}”`
                : `${results.length} ${results.length === 1 ? "match" : "matches"} for “${query}”`}
          </li>
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
                  ${index === active ? "bg-cyan-50 dark:bg-cyan-900/40" : ""}
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
                    {product.tracking_method === "SERIAL_NUMBER" ? "Serial" : "IMEI"}
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
        onSubmit={async (identifier) => {
          try {
            await dispatch(addLine({ product: imeiProduct, identifier })).unwrap();
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
