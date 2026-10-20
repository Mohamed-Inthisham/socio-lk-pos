import { useEffect, useId, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Radio, RadioGroup } from "@headlessui/react";
import { AlertCircle } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import InputField from "../../common/InputField";
import CashFields from "./CashFields";
import ReferenceFields from "./ReferenceFields";
import { PAYMENT_METHODS, referenceHint } from "./methods";
import { formatLKR, fromCents } from "../../../utils/money";
import {
  CASH,
  TRADE_IN,
  buildPaymentPayload,
  buildPaymentSchema,
  computeChangeCents,
  paymentFormDefaults,
} from "../../../schemas/paymentSchema";
import {
  addPayment,
  clearPaymentError,
  selectBalanceDue,
  selectDraftSale,
  selectPaidTotal,
  selectPaymentError,
} from "../../../store/slices/posTerminalSlice";

/**
 * PaymentDialog Component
 *
 * Takes one tender per submission (P3-6; multi-tender = open it again).
 * Opened by the Totals panel's "Pay LKR X" button or F4.
 *
 * - Header: the server's total, already paid, and balance due.
 * - Method picker (radio group): Cash, Card, Bank transfer, Koko,
 *   Mintpay. It opens on Cash (§6) with the picker focused. Number keys
 *   1–5 (when focus isn't in a text field, P3-8) pick a method AND move
 *   focus to its primary field — Cash received, or Reference number — so
 *   a cash sale is F4 → 1 → type cash → Enter. Clicks and arrow keys
 *   change the method but leave focus on the picker. Shift+Tab from the
 *   primary field reaches Amount.
 * - Amount defaults to the balance due and is editable (a partial tender
 *   leaves a balance for the next one).
 * - CASH shows Cash received (CashFields) with a live "Change: LKR X"
 *   (cash received − amount, in cents). Short cash shows its error as
 *   soon as it's typed and disables Record payment. The other methods
 *   show a reference number (ReferenceFields).
 * - Enter in a text field submits. Handled here rather than left to the
 *   browser's implicit submission: the submit button sits in the dialog
 *   footer (joined by its `form` attribute), and an explicit handler
 *   also honours the short-cash block.
 *
 * Validation: react-hook-form + paymentSchema (zod), rebuilt against the
 * current balance. Submit dispatches addPayment; on success the dialog
 * closes and `afterLeave` hands focus back to the scan bar. On failure
 * it stays open and shows the slice's paymentError inline. It can't be
 * dismissed mid-request.
 *
 * PROPS:
 * - open, onClose
 * - afterLeave: runs once the close transition ends (focus hand-off to
 *   the scan bar)
 */

const Figure = ({ label, value, testId, strong = false }) => (
  <div className="min-w-0">
    <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
      {label}
    </dt>
    <dd
      data-testid={testId}
      className={`mt-0.5 tabular-nums truncate ${strong ? "text-lg font-bold text-slate-900 dark:text-white" : "text-sm font-medium text-slate-700 dark:text-slate-200"}`}
    >
      {value}
    </dd>
  </div>
);

const isTextField = (el) =>
  el?.tagName === "TEXTAREA" || (el?.tagName === "INPUT" && el.type !== "radio");

const primaryField = (method) => (method === CASH ? "cash_received" : "reference_number");

// P4 Step A (temporary): TRADE_IN is in methods.js, but its fields
// arrive in Step B, which removes this filter.
const PICKER_METHODS = PAYMENT_METHODS.filter((m) => m.value !== TRADE_IN);

const METHOD_FIELDS = [
  "cash_received",
  "reference_number",
  "trade_in_product_id",
  "trade_in_imei",
  "trade_in_buying_price",
  "trade_in_selling_price",
  "trade_in_notes",
];

const PaymentDialog = ({ open, onClose, afterLeave }) => {
  const dispatch = useDispatch();
  const formId = useId();
  const sale = useSelector(selectDraftSale);
  const paid = useSelector(selectPaidTotal);
  const balance = useSelector(selectBalanceDue);
  const error = useSelector(selectPaymentError);

  // The resolver reads the live balance, so the upper bound never goes
  // stale. Validation runs on submit (an event), after this effect.
  const balanceRef = useRef(balance);
  useEffect(() => {
    balanceRef.current = balance;
  }, [balance]);

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    setFocus,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: paymentFormDefaults(balance),
    resolver: (values, context, options) =>
      zodResolver(buildPaymentSchema(balanceRef.current))(values, context, options),
  });

  // Fresh form each time it opens: Cash, amount = the balance due now.
  useEffect(() => {
    if (!open) return;
    reset(paymentFormDefaults(balanceRef.current));
    dispatch(clearPaymentError());
  }, [open, reset, dispatch]);

  const method = useWatch({ control, name: "payment_method" });
  const [amountValue, cashValue] = useWatch({ control, name: ["amount", "cash_received"] });
  const changeCents = method === CASH ? computeChangeCents(amountValue, cashValue) : null;
  const cashShort = changeCents !== null && changeCents < 0;

  // A number key asks for its method's primary field to be focused. The
  // field may only mount on the next render (Cash ↔ reference swap), so
  // the focus happens in an effect. A fresh object re-triggers it even
  // when the same key is pressed twice.
  const [focusRequest, setFocusRequest] = useState(null);
  useEffect(() => {
    if (focusRequest) setFocus(focusRequest.field);
  }, [focusRequest, setFocus]);

  const pickMethod = (value) => {
    if (value === method) return;
    setValue("payment_method", value);
    clearErrors(METHOD_FIELDS);
    dispatch(clearPaymentError());
  };

  const handleKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTextField(event.target)) {
      if (event.key === "Enter" && event.target.tagName === "INPUT") {
        // Always cancel the browser's own implicit submission, so one
        // Enter can't submit twice; submitForm guards re-entry.
        event.preventDefault();
        if (!cashShort) event.currentTarget.requestSubmit();
      }
      return;
    }
    const picked = PICKER_METHODS.find((m) => m.key === event.key);
    if (picked && !isSubmitting) {
      event.preventDefault();
      pickMethod(picked.value);
      setFocusRequest({ field: primaryField(picked.value) });
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    dispatch(clearPaymentError());
    onClose();
  };

  const onSubmit = async (values) => {
    const result = await dispatch(addPayment(buildPaymentPayload(values)));
    if (addPayment.fulfilled.match(result)) onClose();
  };

  // One submission at a time. isSubmitting is render state, so a second
  // submit arriving before the re-render would still see false; the ref
  // flips synchronously. A payment POST is not idempotent (§5).
  const submittingRef = useRef(false);
  const submitForm = (event) => {
    if (submittingRef.current) {
      event.preventDefault();
      return;
    }
    submittingRef.current = true;
    return handleSubmit(onSubmit)(event).finally(() => {
      submittingRef.current = false;
    });
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Take payment"
      dismissible={!isSubmitting}
      afterLeave={afterLeave}
      footer={
        <>
          <Button variant="secondary" label="Cancel" onClick={handleClose} disabled={isSubmitting} />
          <Button
            type="submit"
            form={formId}
            variant="accent"
            label="Record payment"
            loading={isSubmitting}
            disabled={cashShort}
          />
        </>
      }
    >
      <dl className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-4 py-3">
        <Figure label="Total" value={formatLKR(sale?.total)} testId="payment-total" />
        <Figure label="Paid" value={formatLKR(paid)} testId="payment-paid" />
        <Figure label="Balance" value={formatLKR(balance)} testId="payment-balance" strong />
      </dl>

      <form
        id={formId}
        noValidate
        aria-label="Payment"
        onSubmit={submitForm}
        onKeyDown={handleKeyDown}
        className="mt-5 space-y-4"
      >
        <RadioGroup
          value={method}
          onChange={pickMethod}
          disabled={isSubmitting}
          aria-label="Payment method"
          className="grid grid-cols-3 sm:grid-cols-5 gap-2"
        >
          {PICKER_METHODS.map(({ value, label, icon: Icon, key }) => (
            <Radio
              key={value}
              value={value}
              aria-keyshortcuts={key}
              data-autofocus={value === method ? true : undefined}
              className="
                group relative flex flex-col items-center justify-center gap-1.5
                min-h-[4.5rem] rounded-xl border px-2 py-2.5 text-center cursor-pointer
                transition-colors outline-none
                border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800
                text-slate-600 dark:text-slate-300
                hover:border-slate-300 dark:hover:border-slate-600
                data-[checked]:border-cyan-500 data-[checked]:bg-cyan-50 data-[checked]:text-cyan-800
                dark:data-[checked]:border-cyan-400 dark:data-[checked]:bg-cyan-950/50 dark:data-[checked]:text-cyan-200
                data-[focus]:ring-2 data-[focus]:ring-cyan-500/40
                data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed
              "
            >
              <Icon size={20} aria-hidden="true" />
              <span className="text-xs font-semibold leading-tight">{label}</span>
              <kbd
                aria-hidden="true"
                className="
                  hidden [@media(hover:hover)_and_(pointer:fine)]:inline-flex
                  absolute top-1 right-1 items-center justify-center w-4 h-4 rounded
                  text-[10px] font-semibold font-sans text-slate-400 dark:text-slate-500
                  group-data-[checked]:text-cyan-700 dark:group-data-[checked]:text-cyan-300
                "
              >
                {key}
              </kbd>
            </Radio>
          ))}
        </RadioGroup>

        <InputField
          label="Amount"
          required
          inputMode="decimal"
          autoComplete="off"
          hint={`Balance due ${formatLKR(balance)}`}
          error={errors.amount?.message}
          disabled={isSubmitting}
          {...register("amount")}
          name="amount"
        />

        {method === CASH ? (
          <CashFields
            register={register}
            error={errors.cash_received?.message}
            change={changeCents !== null && !cashShort ? formatLKR(fromCents(changeCents)) : null}
            insufficient={cashShort}
            disabled={isSubmitting}
          />
        ) : (
          <ReferenceFields
            register={register}
            error={errors.reference_number?.message}
            hint={referenceHint(method)}
            disabled={isSubmitting}
          />
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle size={16} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
            {error.message}
          </p>
        )}
      </form>
    </Dialog>
  );
};

export default PaymentDialog;
