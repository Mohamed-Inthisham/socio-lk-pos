import { useState } from "react";
import { filterPinInput } from "../../../utils/pin";

/**
 * PinField Component
 *
 * A 6-digit approval PIN input (planning doc P6-18, P6-20), shared by
 * ApprovalPinDialog (setting your own PIN) and ManagerApprovalFields
 * (approving a void; P7 returns next). Registered with react-hook-form.
 *
 * - type="password", inputMode="numeric", autoComplete="off", maxLength 6
 * - digits only: other scripts' digits are converted to 0–9, anything else
 *   is dropped (utils/pin.js filterPinInput)
 * - a dropped key or paste shows "Digits only" under the field until the
 *   next accepted digit, so the field never silently ignores a key
 * - a paste is filtered before it's cut to 6 ("12a3456" → "123456"): a
 *   browser would otherwise cut it to maxLength first
 * - an error replaces the hint, and the border stays red while focused
 *
 * The value lives only in the form; nothing here stores or logs it.
 *
 * PROPS:
 * - id, label
 * - error: message, or undefined
 * - registration: register("…") from react-hook-form
 */

const PinField = ({ id, label, error, registration }) => {
  const [droppedHint, setDroppedHint] = useState(false);
  const describedBy = error ? `${id}-error` : droppedHint ? `${id}-hint` : undefined;

  const handleChange = (e) => {
    const { value, dropped } = filterPinInput(e.target.value);
    e.target.value = value;
    // Shown on a dropped key or paste; cleared by the next insert that
    // drops nothing (a digit typed or pasted). Deleting leaves it as it is.
    const inserted = (e.nativeEvent?.inputType ?? "insert").startsWith("insert");
    if (dropped) setDroppedHint(true);
    else if (inserted) setDroppedHint(false);
    registration.onChange(e);
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const el = e.target;
    const pasted = e.clipboardData?.getData("text") ?? "";
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const { value, dropped } = filterPinInput(el.value.slice(0, start) + pasted + el.value.slice(end));
    el.value = value;
    setDroppedHint(dropped);
    registration.onChange({ target: el, type: "change" });
  };

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label
        htmlFor={id}
        className="text-xs uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400"
      >
        {label}
      </label>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        spellCheck={false}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
        {...registration}
        onChange={handleChange}
        onPaste={handlePaste}
        className={`
          h-11 w-full px-3.5 rounded-lg text-base tracking-[0.4em] tabular-nums
          bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100
          border focus:outline-none focus:ring-2
          ${
            // As InputField: an error stays red while focused.
            error
              ? "border-red-400 dark:border-red-500 focus:ring-red-500/20"
              : "border-slate-300 dark:border-slate-600 focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-cyan-500/20"
          }
        `}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-500 dark:text-red-400 mt-0.5">
          {error}
        </p>
      ) : (
        droppedHint && (
          <p id={`${id}-hint`} aria-live="polite" className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            Digits only
          </p>
        )
      )}
    </div>
  );
};

export default PinField;
