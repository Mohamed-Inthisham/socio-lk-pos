import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDispatch, useSelector } from "react-redux";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import InputField from "../../common/InputField";
import {
  approvalPinDefaults,
  approvalPinSchema,
  buildApprovalPinPayload,
} from "../../../schemas/approvalPinSchema";
import { setApprovalPin } from "../../../services/approvalsService";
import { approvalPinSet } from "../../../store/slices/authSlice";
import { filterPinInput } from "../../../utils/pin";
import { requestPosFocus } from "../../../utils/posFocus";
import { receiptDateTime } from "../../../utils/receipt";

/**
 * ApprovalPinDialog Component
 *
 * Set or change your own manager approval PIN (planning doc P6-18), from
 * the user menu (admins and managers). Current password, new PIN, confirm
 * PIN; "Set on <date>" or "Not set" in the description. PUT
 * /auth/me/approval-pin; on success the session user's has_approval_pin /
 * approval_pin_set_at update from the response (authSlice.approvalPinSet)
 * and the dialog says so, with Done.
 *
 * ERRORS stay in the dialog. They are answers about the form, not login or
 * permission failures (the axios layer only acts on 401):
 * - 403 WRONG_PASSWORD: under the password, which is cleared and focused
 * - 400 (weak or malformed PIN): under New PIN
 * - 403 without a code (not a manager): an alert
 * - no response or 5xx: "Couldn't save the PIN. Try again."
 *
 * SECRETS: the password and PIN live only in this form while it is open;
 * cleared on close and after saving; never in Redux, storage or logs. The
 * axios error carries the request body, so only its status, code and
 * message are read: the error object itself is never kept or logged.
 *
 * PIN FIELDS: digits only, other scripts' digits converted to 0–9
 * (utils/pin.js filterPinInput); a dropped key or paste shows "Digits
 * only" under that field until the next accepted digit. A paste is
 * filtered before it's cut to 6 ("12a3456" → "123456").
 *
 * FOCUS: Current password on open; Done on success. Esc / Cancel close it
 * (not while saving). After it has gone, `pos:return-focus` lets the
 * terminal take focus back to the scan bar (utils/posFocus.js).
 *
 * PROPS:
 * - open, onClose
 */

const FORM_ID = "approval-pin-form";
const firstMessage = (data) => (Array.isArray(data?.message) ? data.message[0] : data?.message);

// Digits only, other scripts' digits converted (utils/pin.js). A dropped
// keystroke or paste shows "Digits only" under the field until the next
// accepted digit, so the field never silently ignores a key.
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

  // A browser cuts a paste to maxLength before filtering ("12a3456" would
  // keep "12a345" → "12345"), so a paste is filtered first, then cut to 6.
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

const ApprovalPinDialog = ({ open, onClose }) => {
  const dispatch = useDispatch();
  const user = useSelector((state) => state.auth.user);
  const [savedAt, setSavedAt] = useState(null);
  const [apiError, setApiError] = useState(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(approvalPinSchema),
    defaultValues: approvalPinDefaults,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const clearAll = () => {
    reset(approvalPinDefaults);
    setApiError(null);
  };

  const close = () => {
    if (isSubmitting) return;
    clearAll();
    onClose();
  };

  const afterLeave = () => {
    clearAll();
    setSavedAt(null);
    // Deferred: Headless UI restores focus to the opener after afterLeave.
    setTimeout(requestPosFocus, 0);
  };

  const onSubmit = async (values) => {
    setApiError(null);
    try {
      const result = await setApprovalPin(buildApprovalPinPayload(values));
      dispatch(approvalPinSet(result));
      reset(approvalPinDefaults);
      setSavedAt(result.approval_pin_set_at);
    } catch (err) {
      const status = err?.response?.status ?? null;
      const data = err?.response?.data;
      const message = firstMessage(data);
      if (status === 403 && data?.code === "WRONG_PASSWORD") {
        setValue("current_password", "");
        setError("current_password", { type: "server", message }, { shouldFocus: true });
        return;
      }
      if (status === 400) {
        setError("pin", { type: "server", message: message || "That PIN wasn't accepted." }, { shouldFocus: true });
        return;
      }
      if (status === 403) {
        setApiError(message || "Only managers and admins can set an approval PIN.");
        return;
      }
      setApiError("Couldn't save the PIN. Try again.");
    }
  };

  const hasPin = !!user?.has_approval_pin;
  const done = savedAt !== null;
  const doneRef = useRef(null);

  // The focused field is gone once the form becomes the success view.
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);
  const description = hasPin
    ? `Set on ${receiptDateTime(user.approval_pin_set_at)}. Managers and admins enter this PIN to approve voids at the till.`
    : "Not set. Managers and admins enter this PIN to approve voids at the till.";

  return (
    <Dialog
      open={open}
      onClose={close}
      afterLeave={afterLeave}
      title={done ? "Approval PIN set" : hasPin ? "Change approval PIN" : "Set approval PIN"}
      description={done ? undefined : description}
      size="sm"
      dismissible={!isSubmitting}
      footer={
        done ? (
          <Button type="button" variant="accent" label="Done" onClick={close} ref={doneRef} />
        ) : (
          <>
            <Button type="button" variant="secondary" label="Cancel" onClick={close} disabled={isSubmitting} />
            <Button type="submit" variant="accent" form={FORM_ID} label="Save PIN" loading={isSubmitting} />
          </>
        )
      }
    >
      {done ? (
        <div role="status" className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
          <CheckCircle2 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p>
            PIN set on {receiptDateTime(savedAt)}. You can now approve voids with it.
          </p>
        </div>
      ) : (
        <>
          {apiError && (
            <div
              role="alert"
              className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-3 mb-4 flex items-start gap-2"
            >
              <AlertCircle size={16} aria-hidden="true" className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 dark:text-red-300">{apiError}</p>
            </div>
          )}
          <form
            id={FORM_ID}
            onSubmit={handleSubmit(onSubmit)}
            // Save sits in the dialog footer, outside this form: browsers
            // differ on Enter submitting through form=…, so Enter is handled
            // here (and the browser's own submit cancelled: no double send).
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
              e.preventDefault();
              if (!isSubmitting) handleSubmit(onSubmit)();
            }}
            noValidate
            className="flex flex-col gap-4"
          >
            <InputField
              label="Current password"
              type="password"
              autoComplete="current-password"
              error={errors.current_password?.message}
              data-autofocus
              {...register("current_password")}
            />
            <div className="grid grid-cols-2 gap-3">
              <PinField id="approval-pin" label="New PIN" error={errors.pin?.message} registration={register("pin")} />
              <PinField
                id="approval-pin-confirm"
                label="Confirm PIN"
                error={errors.confirm_pin?.message}
                registration={register("confirm_pin")}
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              6 digits. Not one repeated digit or a straight run like 123456.
            </p>
          </form>
        </>
      )}
    </Dialog>
  );
};

export default ApprovalPinDialog;
