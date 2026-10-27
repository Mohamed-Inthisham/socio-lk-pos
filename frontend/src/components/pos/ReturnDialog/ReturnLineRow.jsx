import { forwardRef } from "react";
import { Minus, Plus } from "lucide-react";
import { RETURN_CONDITIONS } from "../../../schemas/returnSchema";
import { formatAmount, formatLKR, fromCents } from "../../../utils/money";

/**
 * ReturnLineRow Component
 *
 * One sale line in the ReturnDialog's items step (planning doc P7-8,
 * P7-20, P7-22): what was sold, what is left to return, its warranty
 * status, a quantity stepper capped at what is left, and where it goes.
 *
 * The row itself is the keyboard stop (roving tabIndex, the dialog moves
 * between rows): ←/− and →/+ change the quantity, B and D pick Back to
 * stock / Damaged. The − / + buttons are for pointer and touch, so Tab
 * goes row → its condition (when shown) → the next row.
 *
 * PROPS:
 * - line: the sale line
 * - quantity, left: returning now, and the most that may be (0 = all back)
 * - disposition: lineDisposition's answer, or "pending" while stock
 *   tracking is being read
 * - condition, onCondition: RESALEABLE | DAMAGED | ""
 * - warranty: lineWarrantyStatus's answer
 * - shareCents: what this line adds to the refund due
 * - error: the row's problem after Next, or null
 * - active: this row holds the tab stop
 * - onQuantity: (n) => void; onMove: (delta) => void; onFocus
 */

const CONDITION_KEYS = { b: "RESALEABLE", d: "DAMAGED" };

const Tag = ({ tone = "slate", children }) => {
  const tones = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    cyan: "bg-cyan-50 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200",
    amber: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  };
  return <span className={`inline-block rounded-md px-2 py-1 text-xs leading-tight ${tones[tone]}`}>{children}</span>;
};

const StepButton = ({ icon: Icon, label, onClick, disabled }) => (
  <button
    type="button"
    tabIndex={-1}
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
    className="
      w-8 h-8 flex items-center justify-center rounded-lg
      border border-slate-300 dark:border-slate-600
      text-slate-700 dark:text-slate-200
      hover:bg-slate-100 dark:hover:bg-slate-800
      disabled:opacity-40 disabled:pointer-events-none
    "
  >
    <Icon size={14} aria-hidden="true" />
  </button>
);

const ReturnLineRow = forwardRef(function ReturnLineRow(
  { line, quantity, left, disposition, condition, onCondition, warranty, shareCents, error, active, onQuantity, onMove, onFocus },
  ref,
) {
  const name = line.product_name_snapshot;
  const done = left === 0;
  const returned = line.returned_quantity ?? 0;

  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      onMove(e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "ArrowLeft" || e.key === "-") {
      e.preventDefault();
      onQuantity(Math.max(0, quantity - 1));
    } else if (e.key === "ArrowRight" || e.key === "+" || e.key === "=") {
      e.preventDefault();
      onQuantity(Math.min(left, quantity + 1));
    } else if (CONDITION_KEYS[key] && disposition === null && quantity > 0) {
      e.preventDefault();
      onCondition(CONDITION_KEYS[key]);
    }
  };

  const where = () => {
    if (disposition === "pending") {
      return <span className="block h-7 w-36 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse" aria-hidden="true" />;
    }
    if (disposition === "INSPECTION") return <Tag tone="cyan">Goes to inspection</Tag>;
    if (disposition === "NOT_OUR_STOCK") return <Tag tone="amber">Not our stock. Return it to that shop yourself.</Tag>;
    if (disposition === "UNTRACKED") return <Tag>Not stock-tracked: no stock change</Tag>;
    if (quantity === 0) return null;
    return (
      <div role="radiogroup" aria-label={`${name}: where it goes`} className="flex gap-1">
        {RETURN_CONDITIONS.map((c) => (
          <label
            key={c.value}
            className={`
              flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer text-xs leading-tight border
              ${condition === c.value ? "border-cyan-500 bg-cyan-50 dark:bg-cyan-950/40 text-slate-900 dark:text-slate-100" : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"}
            `}
          >
            <input
              type="radio"
              name={`condition-${line.id}`}
              value={c.value}
              checked={condition === c.value}
              onChange={() => onCondition(c.value)}
              className="accent-cyan-600"
            />
            {c.label}
            <kbd aria-hidden="true" className="hidden [@media(hover:hover)_and_(pointer:fine)]:inline text-[10px] text-slate-400">
              {c.value === "RESALEABLE" ? "B" : "D"}
            </kbd>
          </label>
        ))}
      </div>
    );
  };

  return (
    <div
      ref={ref}
      role="group"
      aria-label={done ? `${name}: already returned` : `${name}: returning ${quantity} of ${left}`}
      aria-invalid={error ? "true" : undefined}
      tabIndex={done ? undefined : active ? 0 : -1}
      data-autofocus={active ? true : undefined}
      onKeyDown={done ? undefined : onKeyDown}
      onFocus={onFocus}
      // The details keep at least 18rem; when the controls don't fit beside
      // them (phone width, or wide controls) the controls wrap to their own
      // line underneath. The name is never truncated.
      className={`
        flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 rounded-lg border
        focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
        ${error ? "border-red-300 dark:border-red-800" : quantity > 0 ? "border-cyan-300 dark:border-cyan-800 bg-cyan-50/40 dark:bg-cyan-950/20" : "border-slate-200 dark:border-slate-800"}
        ${done ? "opacity-60" : ""}
      `}
    >
      <div className="min-w-0 grow basis-72">
        <p data-part="name" className="text-sm font-medium text-slate-900 dark:text-slate-100 wrap-break-word">
          {name}
        </p>
        {line.imei_snapshot && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{line.identifier_type_snapshot === "SERIAL_NUMBER" ? "Serial number" : "IMEI"} {line.imei_snapshot}</p>
        )}
        <p data-part="price" className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
          {line.quantity} × {formatAmount(line.unit_price)} · {formatLKR(line.line_total)}
          {returned > 0 && !done && <> · Returned {returned} of {line.quantity}</>}
        </p>
        <p
          className={`text-xs ${warranty.outside ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-400"}`}
        >
          {warranty.label}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:ml-auto sm:justify-end">
        {done ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">Already returned</span>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <StepButton icon={Minus} label={`Fewer ${name}`} onClick={() => onQuantity(quantity - 1)} disabled={quantity === 0} />
              <output
                aria-label={`${name} returning`}
                className="w-7 text-center text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100"
              >
                {quantity}
              </output>
              <StepButton icon={Plus} label={`More ${name}`} onClick={() => onQuantity(quantity + 1)} disabled={quantity >= left} />
              <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">of {left}</span>
            </div>
            {where()}
            {quantity > 0 && shareCents !== null && (
              <span className="text-xs font-medium tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">
                {formatLKR(fromCents(shareCents))}
              </span>
            )}
          </>
        )}
      </div>

      {error && <p className="basis-full text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
});

export default ReturnLineRow;
