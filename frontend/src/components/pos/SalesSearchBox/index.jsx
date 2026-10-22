import { Search, X } from "lucide-react";

/**
 * SalesSearchBox Component
 *
 * The recent-sales search (P6-3): sale number, customer name or phone,
 * or an exact IMEI, across all dates. Controlled; the page debounces and
 * decides when a query is long enough (2+ characters).
 *
 * KEYS: the page owns them (↑/↓ and Enter reach the list from here; Esc
 * clears a non-empty box first). `/` focuses it from the list.
 *
 * PROPS:
 * - value, onChange(value)
 * - inputRef: focus target for `/`
 * - onKeyDown: forwarded to the input
 *
 * The "2 or more characters" hint is the page's status line, not here.
 */

const SalesSearchBox = ({ value, onChange, inputRef, onKeyDown }) => (
  <div className="relative flex-1 min-w-0 sm:max-w-md">
    <Search
      size={18}
      aria-hidden="true"
      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
    />
    <input
      ref={inputRef}
      type="search"
      aria-label="Search sales"
      aria-describedby="sales-status"
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder="Sale number, customer, phone or IMEI"
      className="
        w-full h-10 pl-10 pr-10 rounded-lg text-sm
        bg-white dark:bg-slate-900
        border border-slate-300 dark:border-slate-700
        text-slate-900 dark:text-slate-100
        placeholder:text-slate-400 dark:placeholder:text-slate-500
        focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500
        [&::-webkit-search-cancel-button]:hidden
      "
    />
    {value ? (
      <button
        type="button"
        aria-label="Clear search"
        title="Clear search (Esc)"
        onClick={() => {
          onChange("");
          inputRef?.current?.focus();
        }}
        className="
          absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md
          text-slate-400 hover:text-slate-700 dark:hover:text-slate-200
          hover:bg-slate-100 dark:hover:bg-slate-800
          focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
        "
      >
        <X size={16} aria-hidden="true" />
      </button>
    ) : (
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
        /
      </kbd>
    )}
  </div>
);

export default SalesSearchBox;
