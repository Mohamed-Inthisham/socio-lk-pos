import { useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { Radio, RadioGroup } from "@headlessui/react";
import { AlertCircle, Percent, Tag } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import { formatAmount, formatLKR, fromCents, toCents } from "../../../utils/money";
import {
  DISCOUNT_PERCENT,
  DISCOUNT_UNIT_PRICE,
  hasDiscount,
  previewDiscount,
  trimNumber,
} from "../../../utils/discount";
import { updateLineDiscount } from "../../../store/slices/posTerminalSlice";
import useTerminalSessionStore from "../../../store/zustand/terminalSessionStore";

/**
 * LineDiscountDialog Component
 *
 * Sets one cart line's discount (planning doc P5-20). Opened by the line's
 * Discount button (or its badge) or D on a focused row (CartLines).
 *
 * - Two modes: % (percent off the line) and Price each (the final price
 *   per unit; follows qty changes). 1 / 2 pick a mode when focus is on
 *   the mode buttons (←/→ move between them too, and keep focus there);
 *   1 / 2 or a click then focuses the value field.
 * - One value field, focused on open and pre-filled with the line's
 *   current discount (a PERCENT or UNIT_PRICE line opens on its mode).
 *   A line without one opens on the mode last applied on this till
 *   (terminalSessionStore.lastDiscountMode, kept across reloads and
 *   logouts), else Percent.
 * - Live preview with the server's math (integer cents, half-up):
 *   "2 × 160.00 = 320.00 (−80.00)" / "2 × 200.00 − 20% = 320.00 (−80.00)".
 * - Apply (Enter) PATCHes the line (updateLineDiscount); the row dims
 *   until it lands, then the dialog closes. A value that takes nothing off
 *   (0%, or the unit price itself) removes the discount instead.
 * - Remove discount (only when the line has one); Esc / Cancel closes.
 * - Errors stay inline: the field's own checks, and the server's (e.g.
 *   #24 "… Remove or reduce payments first." when the total would drop
 *   below what's paid). A sale that's gone closes the dialog — the
 *   terminal shows that state.
 *
 * PROPS:
 * - line: the cart line (live from the store), or null when closed
 * - onClose
 */

const MODES = [
  { value: DISCOUNT_PERCENT, label: "Percent", name: "Percent off", icon: Percent, key: "1" },
  { value: DISCOUNT_UNIT_PRICE, label: "Price each", name: "Price each", icon: Tag, key: "2" },
];

const MODE_VALUES = [DISCOUNT_PERCENT, DISCOUNT_UNIT_PRICE];

// A line with a discount opens on its own mode; otherwise the mode last
// applied on this till, else Percent.
const initialMode = (line) => {
  if (hasDiscount(line) && MODE_VALUES.includes(line.discount_type)) return line.discount_type;
  const last = useTerminalSessionStore.getState().lastDiscountMode;
  return MODE_VALUES.includes(last) ? last : DISCOUNT_PERCENT;
};

const initialInput = (line) =>
  hasDiscount(line) && [DISCOUNT_PERCENT, DISCOUNT_UNIT_PRICE].includes(line.discount_type)
    ? trimNumber(line.discount_value)
    : "";

const amount = (cents) => formatAmount(fromCents(cents));

const previewText = (line, mode, preview) => {
  const qtyUnit = `${line.quantity} × ${amount(toCents(line.unit_price))}`;
  const total = amount(preview.totalCents);
  const off = preview.offCents > 0 ? ` (−${amount(preview.offCents)})` : "";
  if (mode === DISCOUNT_PERCENT) return `${qtyUnit} − ${trimNumber(preview.percent)}% = ${total}${off}`;
  return `${line.quantity} × ${amount(preview.priceCents)} = ${total}${off}`;
};

const LineDiscountDialog = ({ line, onClose }) => {
  const dispatch = useDispatch();
  // Keep the last line while the dialog fades out.
  const [shown, setShown] = useState(line);
  const [mode, setMode] = useState(initialMode(line));
  const [input, setInput] = useState(initialInput(line));
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const [openedFor, setOpenedFor] = useState(line?.id ?? null);

  // A new opening: start from that line's discount.
  if ((line?.id ?? null) !== openedFor) {
    setOpenedFor(line?.id ?? null);
    if (line) {
      setShown(line);
      setMode(initialMode(line));
      setInput(initialInput(line));
      setTouched(false);
      setServerError(null);
    }
  }
  if (line && line !== shown) setShown(line);

  const current = line ?? shown;
  const preview = current
    ? previewDiscount({ unitPrice: current.unit_price, quantity: current.quantity, mode, input })
    : { error: null };
  const fieldError = touched ? preview.error : null;

  // After the mode re-renders; the field selects its text on focus.
  const focusValue = () => setTimeout(() => inputRef.current?.focus(), 0);

  const pickMode = (value) => {
    if (value === mode) return;
    setMode(value);
    setInput("");
    setTouched(false);
    setServerError(null);
  };

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const send = async (discount) => {
    setSaving(true);
    setServerError(null);
    const result = await dispatch(updateLineDiscount({ lineId: current.id, ...discount }));
    setSaving(false);
    if (updateLineDiscount.fulfilled.match(result) || result.payload?.gone) {
      if (updateLineDiscount.fulfilled.match(result) && discount.discount_type) {
        useTerminalSessionStore.getState().setLastDiscountMode(discount.discount_type);
      }
      onClose();
    } else if (updateLineDiscount.rejected.match(result)) {
      setServerError(result.payload?.message || "Couldn't change the discount");
    } else {
      // Refused before sending (the sale is completing): nothing changed.
      onClose();
    }
  };

  const remove = () => send({ discount_type: null, discount_value: null });

  const apply = (event) => {
    event.preventDefault();
    if (saving) return;
    setTouched(true);
    if (preview.error) {
      inputRef.current?.focus();
      return;
    }
    if (preview.none) {
      if (hasDiscount(current)) remove();
      else onClose();
      return;
    }
    send({
      discount_type: mode,
      discount_value:
        mode === DISCOUNT_PERCENT ? preview.percent : Number(fromCents(preview.priceCents)),
    });
  };

  const handleKeyDown = (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.tagName === "INPUT") return;
    const picked = MODES.find((m) => m.key === event.key);
    if (picked && !saving) {
      event.preventDefault();
      pickMode(picked.value);
      focusValue();
    }
  };

  const modeInfo = MODES.find((m) => m.value === mode);

  return (
    <Dialog
      open={!!line}
      onClose={handleClose}
      title="Discount"
      description={current?.product_name_snapshot}
      size="sm"
      dismissible={!saving}
    >
      {current && (
        <form noValidate aria-label="Line discount" onSubmit={apply} onKeyDown={handleKeyDown}>
          <RadioGroup
            value={mode}
            onChange={pickMode}
            disabled={saving}
            aria-label="Discount type"
            className="grid grid-cols-2 gap-2"
          >
            {MODES.map(({ value, label, icon: Icon, key }) => (
              <Radio
                key={value}
                value={value}
                aria-keyshortcuts={key}
                // A click (or 1 / 2) goes on to the value; ←/→ stay on the modes.
                onClick={focusValue}
                className="
                  group relative flex items-center justify-center gap-1.5 h-10 rounded-xl border px-3
                  text-sm font-semibold cursor-pointer transition-colors outline-none
                  border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800
                  text-slate-600 dark:text-slate-300
                  hover:border-slate-300 dark:hover:border-slate-600
                  data-[checked]:border-cyan-500 data-[checked]:bg-cyan-50 data-[checked]:text-cyan-800
                  dark:data-[checked]:border-cyan-400 dark:data-[checked]:bg-cyan-950/50 dark:data-[checked]:text-cyan-200
                  data-[focus]:ring-2 data-[focus]:ring-cyan-500/40
                  data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed
                "
              >
                <Icon size={16} aria-hidden="true" />
                {label}
                <kbd
                  aria-hidden="true"
                  className="
                    hidden [@media(hover:hover)_and_(pointer:fine)]:inline-flex
                    absolute top-1 right-1.5 text-[10px] font-semibold font-sans
                    text-slate-400 dark:text-slate-500
                    group-data-[checked]:text-cyan-700 dark:group-data-[checked]:text-cyan-300
                  "
                >
                  {key}
                </kbd>
              </Radio>
            ))}
          </RadioGroup>

          <label
            htmlFor="line-discount-value"
            className="block mt-4 mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            {modeInfo.name}
          </label>
          <div className="relative">
            {mode === DISCOUNT_UNIT_PRICE && (
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 dark:text-slate-400">
                LKR
              </span>
            )}
            <input
              id="line-discount-value"
              ref={inputRef}
              data-autofocus
              value={input}
              disabled={saving}
              onChange={(e) => {
                setInput(e.target.value.replace(/[^\d.]/g, ""));
                setServerError(null);
              }}
              onFocus={(e) => e.target.select()}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={!!fieldError}
              aria-describedby="line-discount-preview"
              className={`
                w-full h-12 rounded-lg text-lg font-semibold tabular-nums
                ${mode === DISCOUNT_UNIT_PRICE ? "pl-12 pr-3" : "pl-3 pr-9"}
                bg-white dark:bg-slate-950
                border border-slate-300 dark:border-slate-700
                text-slate-900 dark:text-slate-100
                focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500
                disabled:opacity-60
              `}
            />
            {mode === DISCOUNT_PERCENT && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 dark:text-slate-400">
                %
              </span>
            )}
          </div>

          <p
            id="line-discount-preview"
            data-testid="discount-preview"
            aria-live="polite"
            className="mt-2 min-h-5 text-sm tabular-nums text-slate-600 dark:text-slate-300"
          >
            {fieldError ? (
              <span role="alert" className="text-red-600 dark:text-red-400">
                {fieldError}
              </span>
            ) : preview.error ? (
              <span className="text-slate-500 dark:text-slate-400">
                Unit price {formatLKR(current.unit_price)} × {current.quantity}
              </span>
            ) : preview.none ? (
              "No discount — the line stays at its full price."
            ) : (
              previewText(current, mode, preview)
            )}
          </p>

          {serverError && (
            <p
              role="alert"
              className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300"
            >
              <AlertCircle size={14} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
              {serverError}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            {hasDiscount(current) && (
              <Button
                variant="ghost"
                label="Remove discount"
                className="mr-auto"
                onClick={remove}
                disabled={saving}
              />
            )}
            <Button variant="secondary" label="Cancel" onClick={handleClose} disabled={saving} />
            <Button type="submit" variant="accent" label="Apply" loading={saving} aria-keyshortcuts="Enter" />
          </div>
        </form>
      )}
    </Dialog>
  );
};

export default LineDiscountDialog;
