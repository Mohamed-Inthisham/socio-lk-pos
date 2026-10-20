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
import TradeInCustomerPanel from "./TradeInCustomerPanel";
import TradeInFields from "./TradeInFields";
import { tradeInBlocker, tradeInImeiConflict } from "./tradeIn";
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
  selectAttachedCustomer,
  selectBalanceDue,
  selectDraftSale,
  selectPaidTotal,
  selectPaymentError,
  selectTradeInImeis,
} from "../../../store/slices/posTerminalSlice";

/**
 * PaymentDialog Component
 *
 * Takes one tender per submission (P3-6; multi-tender = open it again).
 * Opened by the Totals panel's "Pay LKR X" button or F4.
 *
 * - Header: the server's total, already paid, and balance due.
 * - Method picker (radio group, 3×2 below `sm`, one row above): Cash,
 *   Card, Bank transfer, Koko, Mintpay, Trade-in. It opens on Cash (§6)
 *   with the picker focused. Number keys 1–6 (when focus isn't in a text
 *   field, P3-8, P4-1) pick a method AND move focus to its primary
 *   field — Cash received, Reference number, or the trade-in Product — so
 *   a cash sale is F4 → 1 → type cash → Enter. Clicks and arrow keys
 *   change the method but leave focus on the picker. Shift+Tab from the
 *   primary field reaches Amount.
 * - Amount defaults to the balance due and is editable (a partial tender
 *   leaves a balance for the next one).
 * - CASH shows Cash received (CashFields) with a live "Change: LKR X"
 *   (cash received − amount, in cents). Short cash shows its error as
 *   soon as it's typed and disables Record payment. The other methods
 *   show a reference number (ReferenceFields).
 * - TRADE_IN (P4) swaps Amount for TradeInFields: product, IMEI,
 *   Trade-in value (sent as the amount), resale price, notes. The picked
 *   product row is kept here so the pending payment row can name it. A
 *   409 on the IMEI shows on that field (by existing_unit.status).
 * - TRADE_IN without a customer (P4-2), or with a customer who has no
 *   NIC (P4-13), shows TradeInCustomerPanel instead, and Record payment
 *   is disabled until it's resolved.
 * - Enter in a text field submits, unless a field already handled it
 *   (the trade-in IMEI and product move focus on, P4-7; the NIC field
 *   saves the NIC). Handled here rather than left to the browser's
 *   implicit submission: the submit button sits in the dialog footer
 *   (joined by its `form` attribute), and an explicit handler also
 *   honours the short-cash and trade-in blocks.
 *
 * Validation: react-hook-form + paymentSchema (zod), rebuilt against the
 * current balance and this sale's trade-in IMEIs. Submit dispatches
 * addPayment; on success the dialog closes and `afterLeave` hands focus
 * back to the scan bar. On failure it stays open and shows the slice's
 * paymentError inline. It can't be dismissed mid-request.
 *
 * PROPS:
 * - open, onClose
 * - initialMethod: the method it opens on (default CASH; F6 and the
 *   return from attaching a customer open it on TRADE_IN, with that
 *   method's primary control focused)
 * - onAttachCustomer: the no-customer panel's Attach customer — the
 *   terminal closes this dialog, attaches, then reopens it on TRADE_IN
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

const PRIMARY_FIELDS = { [CASH]: "cash_received", [TRADE_IN]: "trade_in_product_id" };
const primaryField = (method) => PRIMARY_FIELDS[method] ?? "reference_number";

// In on-screen order.
const METHOD_FIELDS = [
  "cash_received",
  "reference_number",
  "trade_in_product_id",
  "trade_in_imei",
  "trade_in_buying_price",
  "trade_in_selling_price",
  "trade_in_notes",
];
const FIELD_ORDER = ["amount", ...METHOD_FIELDS];

const PaymentDialog = ({ open, onClose, initialMethod = CASH, onAttachCustomer, afterLeave }) => {
  const dispatch = useDispatch();
  const formId = useId();
  const sale = useSelector(selectDraftSale);
  const customer = useSelector(selectAttachedCustomer);
  // The trade-in panel's primary control (Attach customer / NIC field).
  const panelActionRef = useRef(null);
  const paid = useSelector(selectPaidTotal);
  const balance = useSelector(selectBalanceDue);
  const error = useSelector(selectPaymentError);
  const tradeInImeis = useSelector(selectTradeInImeis);
  // The picked trade-in product row (the form only holds its id).
  const [tradeInProduct, setTradeInProduct] = useState(null);

  // The resolver reads the live balance and trade-in IMEIs, so they never
  // go stale. Validation runs on submit (an event), after this effect.
  const balanceRef = useRef(balance);
  const tradeInImeisRef = useRef(tradeInImeis);
  useEffect(() => {
    balanceRef.current = balance;
    tradeInImeisRef.current = tradeInImeis;
  }, [balance, tradeInImeis]);

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
    // react-hook-form focuses by registration order, and the trade-in
    // product (a Controller) registers after the IMEI; focusFirstError
    // uses the on-screen order instead.
    shouldFocusError: false,
    resolver: (values, context, options) =>
      zodResolver(
        buildPaymentSchema(balanceRef.current, { tradeInImeis: tradeInImeisRef.current }),
      )(values, context, options),
  });

  // A number key (or opening on a method other than Cash) asks for that
  // method's primary control to be focused. It may only mount on the
  // next render (method swap, trade-in panel), so the focus happens in
  // an effect. A fresh object re-triggers it even when the same key is
  // pressed twice.
  const [focusRequest, setFocusRequest] = useState(null);
  useEffect(() => {
    if (!focusRequest) return;
    // The trade-in panel, when shown, stands in for the trade-in fields.
    if (focusRequest.method === TRADE_IN && panelActionRef.current) panelActionRef.current.focus();
    else setFocus(primaryField(focusRequest.method));
  }, [focusRequest, setFocus]);

  // Fresh form each time it opens: initialMethod (Cash unless told
  // otherwise), amount = the balance due now.
  useEffect(() => {
    if (!open) return undefined;
    reset({ ...paymentFormDefaults(balanceRef.current), payment_method: initialMethod });
    dispatch(clearPaymentError());
    if (initialMethod === CASH) return undefined;
    // After the Dialog's own initial focus (the picker).
    const timer = setTimeout(() => setFocusRequest({ method: initialMethod }), 0);
    return () => clearTimeout(timer);
  }, [open, initialMethod, reset, dispatch]);

  const method = useWatch({ control, name: "payment_method" });
  const [amountValue, cashValue] = useWatch({ control, name: ["amount", "cash_received"] });
  const changeCents = method === CASH ? computeChangeCents(amountValue, cashValue) : null;
  const cashShort = changeCents !== null && changeCents < 0;
  const imeiConflict = method === TRADE_IN ? tradeInImeiConflict(error) : null;
  const tradeInBlocked = method === TRADE_IN ? tradeInBlocker(customer) : null;
  const submitBlocked = cashShort || !!tradeInBlocked;

  const pickMethod = (value) => {
    if (value === method) return;
    setValue("payment_method", value);
    clearErrors(METHOD_FIELDS);
    dispatch(clearPaymentError());
  };

  const handleKeyDown = (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTextField(event.target)) {
      if (event.key === "Enter" && event.target.tagName === "INPUT") {
        // Always cancel the browser's own implicit submission, so one
        // Enter can't submit twice; submitForm guards re-entry.
        event.preventDefault();
        if (!submitBlocked) event.currentTarget.requestSubmit();
      }
      return;
    }
    const picked = PAYMENT_METHODS.find((m) => m.key === event.key);
    if (picked && !isSubmitting) {
      event.preventDefault();
      pickMethod(picked.value);
      setFocusRequest({ method: picked.value });
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    dispatch(clearPaymentError());
    onClose();
  };

  const onSubmit = async (values) => {
    const payload = buildPaymentPayload(values);
    if (payload.payment_method === TRADE_IN) payload.trade_in_product = tradeInProduct;
    const result = await dispatch(addPayment(payload));
    if (addPayment.fulfilled.match(result)) onClose();
  };

  const focusFirstError = (fieldErrors) => {
    const first = FIELD_ORDER.find((name) => fieldErrors[name]);
    if (first) setFocus(first);
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
    return handleSubmit(onSubmit, focusFirstError)(event).finally(() => {
      submittingRef.current = false;
    });
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Take payment"
      dismissible={!isSubmitting}
      afterLeave={() => {
        // Cleared once closed, so the next open starts without a product.
        setTradeInProduct(null);
        afterLeave?.();
      }}
      footer={
        <>
          <Button variant="secondary" label="Cancel" onClick={handleClose} disabled={isSubmitting} />
          <Button
            type="submit"
            form={formId}
            variant="accent"
            label="Record payment"
            loading={isSubmitting}
            disabled={submitBlocked}
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
          className="grid grid-cols-3 sm:grid-cols-6 gap-2"
        >
          {PAYMENT_METHODS.map(({ value, label, icon: Icon, key }) => (
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

        {method !== TRADE_IN && (
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
        )}

        {tradeInBlocked ? (
          <TradeInCustomerPanel
            customer={customer}
            onAttachCustomer={() => {
              dispatch(clearPaymentError());
              onAttachCustomer?.();
            }}
            onNicSaved={() => setFocusRequest({ method: TRADE_IN })}
            actionRef={panelActionRef}
            disabled={isSubmitting}
          />
        ) : method === TRADE_IN ? (
          <TradeInFields
            control={control}
            register={register}
            errors={errors}
            setFocus={setFocus}
            branchId={sale?.branch_id}
            product={tradeInProduct}
            onPickProduct={setTradeInProduct}
            balance={balance}
            imeiConflict={imeiConflict}
            onImeiEdit={() => {
              if (imeiConflict) dispatch(clearPaymentError());
            }}
            disabled={isSubmitting}
          />
        ) : method === CASH ? (
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

        {error && !imeiConflict && (
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
