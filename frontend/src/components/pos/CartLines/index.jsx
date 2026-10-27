import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AlertCircle, AlertTriangle, Loader2, Lock, Minus, Plus, ShieldCheck, ShoppingCart, Tag, Trash2 } from "lucide-react";
import LineDiscountDialog from "../LineDiscountDialog";
import usePermissions from "../../../hooks/usePermissions";
import { PERMISSIONS } from "../../../constants/rolePermissions";
import { formatAmount, formatLKR } from "../../../utils/money";
import { discountShortLabel, discountedUnitPrice } from "../../../utils/discount";
import { DEFAULT_WARRANTY, WARRANTY_PERIODS } from "../../../constants/warranty";
import {
  removeLine,
  selectCartLines,
  selectCompleteIssue,
  selectStockErrors,
  selectStockWarnings,
  updateLineQty,
  updateLineWarranty,
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
 * - Warranty (P5-18): a compact select after the SKU / IMEI, starting on
 *   the product's default; a change PATCHes the line (updateLineWarranty,
 *   row busy until it lands).
 * - Discount (P5-20, APPLY_DISCOUNT: every role): a "Discount" button
 *   under the unit price (in the card on mobile), or D on a focused row,
 *   opens LineDiscountDialog. A discounted line shows the original unit
 *   price struck through and the new one in the price column, and a
 *   "−20%" / "160.00 each" badge that reopens the dialog under the line
 *   total (in the card on mobile) — so its row is no taller.
 * - Stock warning (Q1 b): a yellow "Only N in stock" badge when the
 *   branch has fewer units than the cart needs. Warns only — the 409 at
 *   complete is the real guard.
 * - Pending rows (add in flight) and busy rows (qty edit / delete in
 *   flight) are dimmed with their controls disabled, so rapid clicks
 *   can't race the server.
 * - Complete refused because of a line (P5-8: not enough stock, or its
 *   phone sold elsewhere): the row gets a red ring and a label until the
 *   cashier changes the sale (selectCompleteIssue).
 *
 * Focus (§6): qty Enter and delete hand focus back to the scan bar via
 * `onReturnFocus`; −/+ clicks and the row's +/- keys keep it, since
 * repeated presses are the point. The discount dialog hands focus back to
 * what opened it (the row or its button).
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

const IssueBadge = ({ label }) => (
  <span
    className="
      mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md
      text-[11px] font-semibold
      bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300
    "
  >
    <AlertCircle size={11} aria-hidden="true" />
    {label}
  </span>
);

/** Quiet time before a warranty change is saved (arrow keys on a closed select change it per press). */
const WARRANTY_SAVE_DELAY_MS = 400;

/**
 * The line's warranty period (P5-18): a native select (Tab, arrow keys and
 * type-ahead work as usual), defaulting to the product's. A pending row
 * shows that default, disabled.
 *
 * Debounced: on Windows, ↑/↓ on a closed select change the value on every
 * press, so the choice shows at once but is only saved after
 * WARRANTY_SAVE_DELAY_MS of quiet — one PATCH with the final value. The
 * row dims once that save starts; the choice stays on screen until it
 * settles (and snaps back if it fails). While the line is busy the select
 * keeps focus but ignores changes.
 */
const WarrantySelect = ({ line }) => {
  const dispatch = useDispatch();
  const busy = line.pending || line.busy;
  const [choice, setChoice] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const choose = (warranty) => {
    if (busy) return;
    setChoice(warranty);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (warranty === line.warranty) {
        setChoice(null);
        return;
      }
      dispatch(updateLineWarranty({ lineId: line.id, warranty })).finally(() => setChoice(null));
    }, WARRANTY_SAVE_DELAY_MS);
  };

  return (
    <span className="flex-shrink-0 inline-flex items-center gap-1 text-slate-400 dark:text-slate-500">
      <ShieldCheck size={12} aria-hidden="true" />
      <select
        aria-label={`Warranty for ${line.product_name_snapshot}`}
        value={choice ?? line.warranty ?? DEFAULT_WARRANTY}
        disabled={line.pending}
        aria-disabled={line.busy || undefined}
        onChange={(event) => choose(event.target.value)}
        className="
          h-6 pl-1.5 pr-1 rounded-md text-xs
          border border-slate-200 dark:border-slate-700
          bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200
          [color-scheme:light] dark:[color-scheme:dark]
          disabled:opacity-60
          focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
        "
      >
        {WARRANTY_PERIODS.map((period) => (
          <option key={period.value} value={period.value}>
            {period.label}
          </option>
        ))}
      </select>
    </span>
  );
};

/**
 * "Discount" on an undiscounted line; on a discounted one the badge
 * ("−20%" / "160.00 each") is the button that reopens the dialog.
 */
const DiscountButton = ({ line, disabled, onOpen }) => {
  const discounted = !!discountedUnitPrice(line);
  const short = discountShortLabel(line, formatAmount);
  const badge = short ? (short.endsWith("%") ? `−${short}` : short) : "Discount";
  return (
    <button
      type="button"
      aria-label={
        discounted
          ? `Change discount for ${line.product_name_snapshot}${short ? ` (${short})` : ""}`
          : `Discount ${line.product_name_snapshot}`
      }
      aria-keyshortcuts="D"
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onOpen}
      className={`
        inline-flex items-center gap-1 h-5 px-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap
        focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
        aria-disabled:opacity-50 aria-disabled:cursor-wait
        ${
          discounted
            ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:hover:bg-emerald-900/70"
            : "text-cyan-700 hover:bg-cyan-50 dark:text-cyan-400 dark:hover:bg-cyan-950/40"
        }
      `}
    >
      <Tag size={11} aria-hidden="true" />
      {discounted ? badge : "Discount"}
    </button>
  );
};

/** The unit price; a discounted line shows the original struck through, then the new one. */
const UnitPrice = ({ line }) => {
  const discounted = discountedUnitPrice(line);
  if (!discounted) return <span>{formatLKR(line.unit_price)}</span>;
  return (
    <>
      <s data-testid="original-price" className="block text-xs text-slate-400 dark:text-slate-500">
        {formatLKR(line.unit_price)}
      </s>
      <span data-testid="discounted-price" className="block font-semibold text-emerald-700 dark:text-emerald-400">
        {formatLKR(discounted)}
      </span>
    </>
  );
};

const CartLineRow = ({ line, index, stockWarning, stockUnknown, issue, onReturnFocus, onDiscount }) => {
  const dispatch = useDispatch();
  const serialized = !!line.identifier_type_snapshot || !!line.imei_snapshot;
  const identifierLabel = line.identifier_type_snapshot === "SERIAL_NUMBER" ? "Serial number" : "IMEI";
  const locked = line.pending || line.busy;
  const discounted = !!discountedUnitPrice(line);

  const setQty = (quantity) => {
    if (locked || serialized || quantity < 1) return;
    dispatch(updateLineQty({ lineId: line.id, quantity }));
  };

  const handleKeyDown = (event) => {
    // +/- belong to the qty input and the warranty select while they have focus
    if (event.target.tagName === "INPUT" || event.target.tagName === "SELECT") return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setQty(line.quantity + 1);
    } else if (event.key === "-") {
      event.preventDefault();
      setQty(line.quantity - 1);
    } else if ((event.key === "d" || event.key === "D") && onDiscount && !line.pending) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      if (!line.busy) onDiscount();
    }
  };

  return (
    <li
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={line.product_name_snapshot}
      aria-busy={locked}
      aria-invalid={issue ? true : undefined}
      data-testid="cart-line"
      className={`
        grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1fr)_8.5rem_7rem_7.5rem_2.5rem]
        items-center gap-x-3 gap-y-2 px-4 py-3
        border-b border-slate-100 dark:border-slate-800 last:border-b-0
        focus:outline-none focus-visible:bg-cyan-50/60 dark:focus-visible:bg-cyan-900/20
        ${issue ? "ring-2 ring-inset ring-red-500 bg-red-50/60 dark:bg-red-950/30" : ""}
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
          {/* Second line: the IMEI or SKU, then the line's warranty (P5-18) */}
          <div className="mt-0.5 flex items-center gap-2 min-w-0">
            {line.imei_snapshot ? (
              <p className="min-w-0 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                {identifierLabel} {line.imei_snapshot}
              </p>
            ) : serialized ? (
              <p className="min-w-0 text-xs text-slate-500 dark:text-slate-400 truncate">
                No serial number entered
              </p>
            ) : (
              line.product_sku_snapshot && (
                <p className="min-w-0 text-xs text-slate-500 dark:text-slate-400 truncate">
                  {line.product_sku_snapshot}
                </p>
              )
            )}
            <WarrantySelect line={line} />
          </div>
          {stockWarning ? <StockBadge warning={stockWarning} /> : stockUnknown && <StockUnknown />}
          {issue && (
            <>
              {" "}
              <IssueBadge label={issue} />
            </>
          )}
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
        {onDiscount && !line.pending && (
          <span className="md:hidden ml-1">
            <DiscountButton line={line} disabled={locked} onOpen={onDiscount} />
          </span>
        )}
      </div>

      {/* Unit price + Discount (desktop column; folded into the mobile total line) */}
      <div className="hidden md:flex flex-col items-end text-right text-sm tabular-nums text-slate-600 dark:text-slate-300">
        <UnitPrice line={line} />
        {onDiscount && !line.pending && !discounted && (
          <span className="mt-0.5">
            <DiscountButton line={line} disabled={locked} onOpen={onDiscount} />
          </span>
        )}
      </div>

      {/* Line total */}
      <div className="row-start-2 col-start-2 md:row-start-auto md:col-start-auto text-right">
        <span className="block text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {line.pending ? (
            <Loader2 size={16} aria-label="Adding" className="inline animate-spin text-cyan-600" />
          ) : (
            formatLKR(line.line_total)
          )}
        </span>
        {/* A discounted line's badge sits under its total (desktop): the price column keeps two lines, the IMEI its room */}
        {onDiscount && discounted && (
          <span className="hidden md:block mt-0.5">
            <DiscountButton line={line} disabled={locked} onOpen={onDiscount} />
          </span>
        )}
        <span className="md:hidden block text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {line.quantity} ×{" "}
          {discountedUnitPrice(line) ? (
            <>
              <s>{formatAmount(line.unit_price)}</s> {formatLKR(discountedUnitPrice(line))}
            </>
          ) : (
            formatLKR(line.unit_price)
          )}
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
  const completeIssue = useSelector(selectCompleteIssue);
  const { can } = usePermissions();
  const canDiscount = can(PERMISSIONS.APPLY_DISCOUNT);
  const [discountLineId, setDiscountLineId] = useState(null);
  const discountLine = lines.find((l) => l.id === discountLineId && !l.pending) ?? null;

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
            issue={completeIssue.lineIds.includes(line.id) ? completeIssue.label : null}
            onReturnFocus={onReturnFocus}
            onDiscount={canDiscount ? () => setDiscountLineId(line.id) : undefined}
          />
        ))}
      </ul>
      <LineDiscountDialog line={discountLine} onClose={() => setDiscountLineId(null)} />
    </div>
  );
};

export default CartLines;
