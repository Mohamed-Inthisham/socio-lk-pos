import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AlertTriangle, Loader2, Lock, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { formatLKR } from "../../../utils/money";
import {
  removeLine,
  selectCartLines,
  selectStockErrors,
  selectStockWarnings,
  updateLineQty,
} from "../../../store/slices/posTerminalSlice";

/**
 * CartLines Component
 *
 * The draft sale's lines, straight from the server response (plus
 * optimistic pending rows from addLine). Prices and totals are the
 * server's — nothing is recomputed here.
 *
 * - Non-serialized: −/+ stepper and a direct qty input (commits on Enter
 *   or blur). With a row focused, `+` / `-` change its qty.
 * - Serialized (line has an IMEI): qty locked at 1, IMEI under the name.
 * - Stock warning (Q1 b): a yellow "Only N in stock" badge when the
 *   branch has fewer units than the cart needs. Warns only — the 409 at
 *   complete is the real guard.
 * - Pending rows (add in flight) and busy rows (qty edit / delete in
 *   flight) are dimmed with their controls disabled, so rapid clicks
 *   can't race the server.
 *
 * Focus (§6): qty Enter and delete hand focus back to the scan bar via
 * `onReturnFocus`; −/+ clicks and the row's +/- keys keep it, since
 * repeated presses are the point.
 *
 * Layout: a table-like grid at ≥ md, stacked cards below (Q6).
 */

// Enter commits and hands focus back to the scan bar (§6 home position);
// blur commits without moving focus (the cashier is already elsewhere).
const QtyInput = ({ line, disabled, onCommit, onDone }) => {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? String(line.quantity);

  const commit = () => {
    if (draft === null) return;
    const qty = Number(draft);
    setDraft(null);
    if (Number.isInteger(qty) && qty >= 1 && qty !== line.quantity) onCommit(qty);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={`Quantity for ${line.product_name_snapshot}`}
      value={shown}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          onDone?.();
        } else if (e.key === "Escape") {
          e.stopPropagation(); // revert only — don't trigger the terminal's Esc
          setDraft(null);
        }
      }}
      className="
        w-12 h-9 text-center rounded-lg text-sm font-semibold tabular-nums
        bg-white dark:bg-slate-950
        border border-slate-300 dark:border-slate-700
        focus:outline-none focus:ring-2 focus:ring-cyan-500
        disabled:opacity-60
      "
    />
  );
};

// `busy` (request in flight) uses aria-disabled, not `disabled`: browsers
// move focus off a disabled button, which would break repeated presses.
// `disabled` is kept for permanent states (− at qty 1).
const StepButton = ({ icon: Icon, label, busy, onClick, ...props }) => (
  <button
    type="button"
    aria-label={label}
    aria-disabled={busy || undefined}
    onClick={busy ? undefined : onClick}
    className="
      w-9 h-9 flex items-center justify-center rounded-lg
      text-slate-600 dark:text-slate-300
      hover:bg-slate-100 dark:hover:bg-slate-800
      disabled:opacity-40 disabled:hover:bg-transparent
      aria-disabled:cursor-wait
      focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
    "
    {...props}
  >
    <Icon size={16} aria-hidden="true" />
  </button>
);

const StockBadge = ({ warning }) => (
  <span
    role="status"
    title={`Cart needs ${warning.required}, branch stock shows ${warning.available}. The sale can still be rung up; completing it will fail if stock is really short.`}
    className="
      mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md
      text-[11px] font-semibold
      bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300
    "
  >
    <AlertTriangle size={11} aria-hidden="true" />
    Only {warning.available} in stock
  </span>
);

const StockUnknown = () => (
  <span
    role="status"
    aria-label="Stock unknown: stock lookup failed, try reloading"
    title="Stock lookup failed, try reloading"
    className="mt-1 inline-flex items-center justify-center w-5 h-5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
  >
    ?
  </span>
);

const CartLineRow = ({ line, index, stockWarning, stockUnknown, onReturnFocus }) => {
  const dispatch = useDispatch();
  const serialized = !!line.imei_snapshot;
  const locked = line.pending || line.busy;

  const setQty = (quantity) => {
    if (locked || serialized || quantity < 1) return;
    dispatch(updateLineQty({ lineId: line.id, quantity }));
  };

  const handleKeyDown = (event) => {
    if (event.target.tagName === "INPUT") return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setQty(line.quantity + 1);
    } else if (event.key === "-") {
      event.preventDefault();
      setQty(line.quantity - 1);
    }
  };

  return (
    <li
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={line.product_name_snapshot}
      aria-busy={locked}
      data-testid="cart-line"
      className={`
        grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1fr)_8.5rem_7rem_7.5rem_2.5rem]
        items-center gap-x-3 gap-y-2 px-4 py-3
        border-b border-slate-100 dark:border-slate-800 last:border-b-0
        focus:outline-none focus-visible:bg-cyan-50/60 dark:focus-visible:bg-cyan-900/20
        ${locked ? "opacity-60" : ""}
      `}
    >
      {/* Item */}
      <div className="min-w-0 row-start-1 col-start-1 md:row-start-auto md:col-start-auto flex items-start gap-3">
        <span className="hidden md:inline-block w-5 pt-0.5 text-xs tabular-nums text-slate-400 dark:text-slate-500">
          {index + 1}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
            {line.product_name_snapshot}
          </p>
          {serialized ? (
            <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
              IMEI {line.imei_snapshot}
            </p>
          ) : (
            line.product_sku_snapshot && (
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {line.product_sku_snapshot}
              </p>
            )
          )}
          {stockWarning ? <StockBadge warning={stockWarning} /> : stockUnknown && <StockUnknown />}
        </div>
      </div>

      {/* Qty */}
      <div className="row-start-2 col-start-1 md:row-start-auto md:col-start-auto flex items-center gap-1 md:justify-center">
        {serialized ? (
          <span
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold tabular-nums bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
            title="Serialized item — one unit per line"
            aria-label={`Quantity for ${line.product_name_snapshot}: 1, locked`}
          >
            <Lock size={12} aria-hidden="true" />1
          </span>
        ) : (
          <>
            <StepButton
              icon={Minus}
              label={`Decrease ${line.product_name_snapshot}`}
              busy={locked}
              disabled={line.quantity <= 1}
              onClick={() => setQty(line.quantity - 1)}
            />
            <QtyInput line={line} disabled={locked} onCommit={setQty} onDone={onReturnFocus} />
            <StepButton
              icon={Plus}
              label={`Increase ${line.product_name_snapshot}`}
              busy={locked}
              onClick={() => setQty(line.quantity + 1)}
            />
          </>
        )}
      </div>

      {/* Unit price (desktop column; folded into the mobile total line) */}
      <span className="hidden md:block text-right text-sm tabular-nums text-slate-600 dark:text-slate-300">
        {formatLKR(line.unit_price)}
      </span>

      {/* Line total */}
      <div className="row-start-2 col-start-2 md:row-start-auto md:col-start-auto text-right">
        <span className="block text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {line.pending ? (
            <Loader2 size={16} aria-label="Adding" className="inline animate-spin text-cyan-600" />
          ) : (
            formatLKR(line.line_total)
          )}
        </span>
        <span className="md:hidden block text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {line.quantity} × {formatLKR(line.unit_price)}
        </span>
      </div>

      {/* Remove */}
      <div className="row-start-1 col-start-2 md:row-start-auto md:col-start-auto flex justify-end">
        <button
          type="button"
          aria-label={`Remove ${line.product_name_snapshot}`}
          disabled={locked}
          onClick={() => {
            dispatch(removeLine({ lineId: line.id }));
            onReturnFocus?.();
          }}
          className="
            w-9 h-9 flex items-center justify-center rounded-lg
            text-slate-400 dark:text-slate-500
            hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/40
            disabled:opacity-40 disabled:hover:bg-transparent
            focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500
          "
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
};

const CartLines = ({ onReturnFocus }) => {
  const lines = useSelector(selectCartLines);
  const stockWarnings = useSelector(selectStockWarnings);
  const stockErrors = useSelector(selectStockErrors);

  if (lines.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div>
          <ShoppingCart
            size={28}
            aria-hidden="true"
            className="mx-auto mb-2 text-slate-300 dark:text-slate-600"
          />
          <p className="text-sm text-slate-500 dark:text-slate-400">Cart is empty</p>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            Scan a barcode or search to add items
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        className="
          hidden md:grid grid-cols-[minmax(0,1fr)_8.5rem_7rem_7.5rem_2.5rem] gap-x-3 px-4 py-2
          border-b border-slate-200 dark:border-slate-800
          text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400
        "
      >
        <span className="pl-8">Item</span>
        <span className="text-center">Qty</span>
        <span className="text-right">Price</span>
        <span className="text-right">Total</span>
        <span />
      </div>
      <ul aria-label="Cart" className="flex-1 min-h-0 overflow-y-auto">
        {lines.map((line, index) => (
          <CartLineRow
            key={line.id}
            line={line}
            index={index}
            stockWarning={stockWarnings[line.id]}
            stockUnknown={!line.pending && !!stockErrors[line.product_id]}
            onReturnFocus={onReturnFocus}
          />
        ))}
      </ul>
    </div>
  );
};

export default CartLines;
