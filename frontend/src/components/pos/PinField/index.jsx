import { useState } from "react";
import { filterPinInput } from "../../../utils/pin";

/**
 * PinField Component
 *
 * A 6-digit approval PIN input (planning doc P6-18, P6-20), shared by
 * ApprovalPinDialog (setting your own PIN) and ManagerApprovalFields
 * (approving a void; P7 returns next). Registered with react-hook-form.
 *
 * - type="password" (masked, P6-20), inputMode="numeric", maxLength 6
 * - autoComplete="one-time-code", not "off": Chrome's password manager
 *   ignores "off" and treated a password-type PIN next to a text field as
 *   a login form, filling the saved username into the text field (the
 *   void reason's Detail) and the saved password into the PIN. A
 *   one-time-code field is a code typed in by hand, which the password
 *   manager leaves out of login forms ("new-password" would also stop the
 *   fill, but makes Chrome offer to generate a password here). Checked in
 *   a real Chrome with a saved password.
 * - only user input is taken: typing, deleting, IME, drop (a paste has its
 *   own handler). An input event without a user input type (a browser or
 *   extension filling the field) is cleared and shows no hint, so a saved
 *   password can never sit in a PIN field
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

// InputEvent.inputType values a person produces: typing, IME composition,
// deleting, drag-and-drop. Autofill sends none (or insertReplacementText).
const USER_INPUT = /^(insertText|insertCompositionText|insertFromDrop|delete)/;

const PinField = ({ id, label, error, registration }) => {
  const [droppedHint, setDroppedHint] = useState(false);
  const describedBy = error ? `${id}-error` : droppedHint ? `${id}-hint` : undefined;

  const handleChange = (e) => {
    const inputType = e.nativeEvent?.inputType ?? "";
    const typed = USER_INPUT.test(inputType);
    if (!typed) {
      // Not the user: autofill or an extension. Never keep it, never hint.
      e.target.value = "";
      registration.onChange(e);
      return;
    }
    const { value, dropped } = filterPinInput(e.target.value);
    e.target.value = value;
    // Shown on a dropped key or paste; cleared by the next insert that
    // drops nothing (a digit typed or pasted). Deleting leaves it as it is.
    if (dropped) setDroppedHint(true);
    else if (inputType.startsWith("insert")) setDroppedHint(false);
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
        autoComplete="one-time-code"
        data-lpignore="true"
        data-1p-ignore=""
        data-form-type="other"
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
