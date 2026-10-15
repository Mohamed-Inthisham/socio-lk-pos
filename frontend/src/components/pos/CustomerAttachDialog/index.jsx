import { useEffect, useId, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { AlertCircle, Loader2, Search, UserPlus } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import CustomerCreateForm from "./CustomerCreateForm";
import { listCustomers } from "../../../services/customersService";
import { formatSlPhone } from "../../../utils/phone";
import { attachCustomer } from "../../../store/slices/posTerminalSlice";

/**
 * CustomerAttachDialog Component
 *
 * Attach a customer to the draft sale: search existing customers, or
 * create one inline (CustomerCreateForm).
 *
 * SEARCH: 2+ chars, debounced 250 ms, GET /customers?search=&limit=10
 * (matches name, phone or NIC). ↑/↓ move the highlight, Enter or a click
 * picks. Picking dispatches attachCustomer and closes at once — the
 * attach is optimistic, and a failure shows (and rolls back) on the
 * CustomerCard.
 *
 * Results live in local state, not the slice: nothing else reads them,
 * and they're thrown away when the dialog closes. Stale responses are
 * dropped by request sequence.
 *
 * "Create new customer" switches to the form, prefilled from the query —
 * a phone-looking query fills Phone, anything else fills Name.
 *
 * Esc / backdrop close it (Headless UI Dialog), except mid-create. The
 * search input is auto-focused on open and on "Back to search"
 * (`data-autofocus` for Headless UI's initial focus, `autoFocus` for the
 * remount).
 *
 * PROPS:
 * - open, onClose
 * - afterLeave: runs once the close transition ends (focus hand-off)
 */

const DEBOUNCE_MS = 250;
const MIN_SEARCH = 2;
export const CUSTOMER_SEARCH_LIMIT = 10;

const isPhoneLike = (value) => /^\+?[\d\s-]+$/.test(value);

const CustomerAttachDialog = ({ open, onClose, afterLeave }) => {
  const dispatch = useDispatch();
  const listId = useId();
  const requestSeq = useRef(0);

  const [mode, setMode] = useState("search");
  const [value, setValue] = useState("");
  const [results, setResults] = useState([]);
  // The query `results` belong to
  const [resultsQuery, setResultsQuery] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);

  const query = value.trim();
  const canSearch = query.length >= MIN_SEARCH;
  const resultsCurrent = canSearch && resultsQuery === query;

  useEffect(() => {
    if (!canSearch) {
      // Drop any in-flight response; the spinner hides via `canSearch`.
      requestSeq.current += 1;
      return undefined;
    }
    const timer = setTimeout(async () => {
      const seq = ++requestSeq.current;
      setSearching(true);
      setSearchError(null);
      try {
        const page = await listCustomers({ search: query, limit: CUSTOMER_SEARCH_LIMIT });
        if (seq !== requestSeq.current) return;
        setResults(page.data);
        setResultsQuery(query);
        setActive(0);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setResults([]);
        setResultsQuery(null);
        setSearchError(err?.response?.data?.message || err?.message || "Search failed");
      } finally {
        if (seq === requestSeq.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, canSearch]);

  // Clear once the close transition has finished, so the panel doesn't
  // visibly reset while fading out.
  const reset = () => {
    requestSeq.current += 1;
    setMode("search");
    setValue("");
    setResults([]);
    setResultsQuery(null);
    setSearching(false);
    setSearchError(null);
    setActive(0);
  };

  const handleClose = () => {
    if (!busy) onClose();
  };

  const pick = (customer) => {
    dispatch(attachCustomer({ customer }));
    onClose();
  };

  const handleKeyDown = (event) => {
    const count = resultsCurrent ? results.length : 0;
    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      setActive((i) => (i + 1) % count);
    } else if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      setActive((i) => (i - 1 + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (resultsCurrent && results[active]) pick(results[active]);
    }
  };

  const createInitialValues = isPhoneLike(query) ? { phone: query } : { name: query };
  const activeId = resultsCurrent && results[active] ? `${listId}-opt-${active}` : undefined;

  let status = "Type at least 2 characters — name, phone or NIC.";
  if (searchError) status = null;
  else if (canSearch && !resultsCurrent) status = "Searching…";
  else if (resultsCurrent && !results.length) status = `No customers match “${query}”`;
  else if (resultsCurrent) status = null;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={mode === "search" ? "Attach customer" : "New customer"}
      description={
        mode === "search"
          ? "Find an existing customer, or create a new one."
          : "Saved to the customer list and attached to this sale."
      }
      size="md"
      dismissible={!busy}
      afterLeave={() => {
        reset();
        afterLeave?.();
      }}
    >
      {mode === "search" ? (
        <>
          <div className="relative">
            <Search
              size={18}
              aria-hidden="true"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
            />
            <input
              type="text"
              role="combobox"
              aria-label="Search customers"
              aria-expanded={resultsCurrent && results.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              data-autofocus
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Name, phone or NIC"
              className="
                w-full h-12 pl-11 pr-11 rounded-xl text-base
                bg-white dark:bg-slate-950
                border border-slate-300 dark:border-slate-700
                text-slate-900 dark:text-slate-100
                placeholder:text-slate-400 dark:placeholder:text-slate-500
                focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500
              "
            />
            {searching && canSearch && (
              <Loader2
                size={18}
                aria-label="Searching"
                className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-cyan-600 dark:text-cyan-400"
              />
            )}
          </div>

          <div className="mt-3 min-h-52">
            {searchError && (
              <p role="alert" className="flex items-start gap-2 px-1 py-2 text-sm text-red-600 dark:text-red-400">
                <AlertCircle size={16} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
                {searchError}
              </p>
            )}
            {status && (
              <p className="px-1 py-2 text-sm text-slate-500 dark:text-slate-400">{status}</p>
            )}
            {resultsCurrent && results.length > 0 && (
              <ul
                id={listId}
                role="listbox"
                aria-label="Matching customers"
                className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800"
              >
                {results.map((customer, index) => (
                  <li
                    key={customer.id}
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(customer)}
                    className={`
                      px-4 py-2.5 cursor-pointer
                      ${index === active ? "bg-cyan-50 dark:bg-cyan-900/40" : ""}
                    `}
                  >
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {customer.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate tabular-nums">
                      {formatSlPhone(customer.phone)}
                      {customer.nic ? ` · NIC ${customer.nic}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center gap-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">Not on file?</p>
            <Button
              variant="secondary"
              icon={UserPlus}
              label="Create new customer"
              onClick={() => setMode("create")}
            />
          </div>
        </>
      ) : (
        <CustomerCreateForm
          initialValues={createInitialValues}
          onBack={() => setMode("search")}
          onDone={onClose}
          onBusyChange={setBusy}
        />
      )}
    </Dialog>
  );
};

export default CustomerAttachDialog;
