import { useRef } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Loader2, Plus, X } from "lucide-react";
import ManagerApprovalFields from "../ManagerApprovalFields";
import { methodLabel } from "../PaymentDialog/methods";
import { OTHER, RETURN_REASONS } from "../../../schemas/returnSchema";
import { CASH } from "../../../schemas/paymentSchema";
import { formatLKR, fromCents } from "../../../utils/money";
import { paidLine } from "./returnText";

/**
 * RefundStep Component
 *
 * The ReturnDialog's second step (planning doc P7-3 – P7-5, P7-9, P7-23):
 * the refund rows, the reason, the override reason when a line is outside
 * warranty, and the manager's approval. How the sale was paid and any
 * refusal show above it, out of the scroll (RefundNotices, below).
 *
 * REFUND ROWS: Cash, and one row per card / bank / Koko / Mintpay payment
 * of this sale that has money left (TRADE_IN never). Adding a payment row
 * takes its amount out of the cash row, so the total stays at the refund
 * due (ReturnDialog addPaymentRow). The total may be lowered, never
 * raised; lower needs the reason detail to say why.
 *
 * Messages: a field's own message shows once it has been touched (or
 * after Enter on an incomplete form); the total's messages always show.
 * The server's refusals come in `serverErrors` and show where they belong.
 *
 * PROPS:
 * - sale, context: the sale and returnContext
 * - register, rows (useFieldArray fields), values (watched)
 * - issues: { "refunds.0.amount": message, … } from the full schema
 * - touched: Set of touched paths; touch(path)
 * - totalCents, dueCents, tradeInCents, outsideLines ([{ line, label }])
 * - onAddPayment(payment), onAddCash(), onRemoveRow(index)
 * - serverErrors: { refund, override_reason, approver_id, pin }
 * - approval: { sessionUser, setApprover, onStatus }
 * - busy: sending or checking
 */

const inputClass = (invalid) => `
  h-9 w-full px-2.5 rounded-lg text-sm
  bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100
  border ${invalid ? "border-red-400 dark:border-red-500" : "border-slate-300 dark:border-slate-600"}
  focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500
`;

// Opt out of password managers (as VoidSaleDialog's Detail).
const NO_AUTOFILL = { autoComplete: "off", "data-lpignore": "true", "data-1p-ignore": "", "data-form-type": "other" };

const Heading = ({ children, id }) => (
  <h3 id={id} className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
    {children}
  </h3>
);

const Message = ({ children, tone = "error" }) =>
  children ? (
    <p className={`text-xs ${tone === "error" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300"}`}>
      {children}
    </p>
  ) : null;

const RefundStep = ({
  sale,
  context,
  register,
  rows,
  values,
  issues,
  touched,
  touch,
  totalCents,
  dueCents,
  tradeInCents,
  outsideLines,
  onAddPayment,
  onAddCash,
  onRemoveRow,
  serverErrors,
  approval,
  busy,
  salesPath = "/pos/sales",
}) => {
  const reasonGroup = useRef(null);
  const seen = (path) => touched.has(path) || touched.has("*");
  const shown = (path) => (seen(path) ? issues[path] : undefined);
  const preset = values.reason_preset;
  const lower = totalCents < dueCents;
  const detailRequired = preset === OTHER || lower;
  const inRows = new Set(values.refunds.map((r) => r.payment_id).filter(Boolean));
  const hasCash = values.refunds.some((r) => r.method === CASH);
  const overTotal = issues.refunds;

  // 1–5 pick a preset while the reason group has focus.
  const onReasonKey = (e) => {
    if (e.target.type !== "radio") return;
    const match = RETURN_REASONS.find((r) => r.key === e.key);
    if (!match) return;
    e.preventDefault();
    reasonGroup.current?.querySelector(`input[value="${match.value}"]`)?.click();
  };

  const presetRegistration = register("reason_preset", { onChange: () => touch("reason_preset") });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4">
        {/* Refund */}
        <section aria-labelledby="return-refund-heading" className="min-w-0 flex flex-col gap-2">
          <Heading id="return-refund-heading">Refund</Heading>
          <fieldset disabled={busy} className="flex flex-col gap-2 min-w-0">
            {rows.map((row, i) => {
              const value = values.refunds[i] ?? row;
              const payment = context.payments.find((p) => p.id === value.payment_id);
              const cash = value.method === CASH;
              const amountPath = `refunds.${i}.amount`;
              const referencePath = `refunds.${i}.reference`;
              return (
                <div
                  key={row.id}
                  data-testid={`refund-row-${cash ? "cash" : value.payment_id}`}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {cash ? "Cash" : methodLabel(value.method)}
                        {!cash && payment?.reference_number && (
                          <span className="font-normal text-slate-500 dark:text-slate-400"> · ref {payment.reference_number}</span>
                        )}
                      </p>
                      {!cash && payment && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Up to {formatLKR(fromCents(payment.refundableCents))}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveRow(i)}
                      aria-label={`Remove the ${cash ? "cash" : methodLabel(value.method)} refund`}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <div className={`grid gap-2 ${cash ? "grid-cols-1" : "grid-cols-2"}`}>
                    <div className="flex flex-col gap-1 min-w-0">
                      <label htmlFor={`refund-amount-${i}`} className="text-xs text-slate-500 dark:text-slate-400">
                        Amount (LKR)
                      </label>
                      <input
                        id={`refund-amount-${i}`}
                        type="text"
                        inputMode="decimal"
                        {...NO_AUTOFILL}
                        {...register(amountPath, { onChange: () => touch(amountPath) })}
                        aria-invalid={shown(amountPath) ? "true" : undefined}
                        className={inputClass(!!shown(amountPath))}
                      />
                    </div>
                    {!cash && (
                      <div className="flex flex-col gap-1 min-w-0">
                        <label htmlFor={`refund-reference-${i}`} className="text-xs text-slate-500 dark:text-slate-400">
                          Reversal reference
                        </label>
                        <input
                          id={`refund-reference-${i}`}
                          type="text"
                          maxLength={100}
                          placeholder="From the card machine or portal"
                          {...NO_AUTOFILL}
                          {...register(referencePath, { onBlur: () => touch(referencePath) })}
                          aria-invalid={shown(referencePath) ? "true" : undefined}
                          className={inputClass(!!shown(referencePath))}
                        />
                      </div>
                    )}
                  </div>
                  <Message>{shown(amountPath)}</Message>
                  <Message>{shown(referencePath)}</Message>
                </div>
              );
            })}

            <div className="flex flex-wrap gap-1.5">
              {!hasCash && (
                <AddButton label="Cash" onClick={onAddCash} />
              )}
              {context.payments
                .filter((p) => !inRows.has(p.id))
                .map((p) => (
                  <AddButton
                    key={p.id}
                    label={`${methodLabel(p.method)}${p.reference_number ? ` (ref ${p.reference_number})` : ""}`}
                    hint={p.refundableCents > 0 ? `up to ${formatLKR(fromCents(p.refundableCents))}` : "nothing left to refund"}
                    disabled={p.refundableCents <= 0}
                    onClick={() => onAddPayment(p)}
                  />
                ))}
            </div>
          </fieldset>

          <div data-testid="return-refund-total" className="text-sm flex flex-col gap-0.5">
            <p className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              Refunding {formatLKR(fromCents(totalCents))} of {formatLKR(fromCents(dueCents))} due
            </p>
            {overTotal ? (
              <Message>{overTotal}</Message>
            ) : (
              lower && (
                <Message tone="warn">
                  {formatLKR(fromCents(dueCents - totalCents))} less than due: say why in the reason detail.
                </Message>
              )
            )}
            {tradeInCents > 0 && (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Includes {formatLKR(fromCents(tradeInCents))} from a trade-in. The trade-in phone stays with the shop.
              </p>
            )}
            <Message>{serverErrors.refund}</Message>
          </div>
        </section>

        {/* Reason and override */}
        <div className="min-w-0 flex flex-col gap-4">
          <fieldset ref={reasonGroup} onKeyDown={onReasonKey} disabled={busy} className="min-w-0">
            <legend className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              Reason <span className="normal-case tracking-normal font-normal">(keys 1–5)</span>
            </legend>
            <div role="radiogroup" aria-label="Reason" className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {RETURN_REASONS.map((r) => (
                <label
                  key={r.value}
                  className={`
                    flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm leading-tight
                    border ${preset === r.value ? "border-cyan-500 bg-cyan-50 dark:bg-cyan-950/40" : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800"}
                  `}
                >
                  <input
                    type="radio"
                    value={r.value}
                    {...presetRegistration}
                    aria-label={r.label}
                    aria-keyshortcuts={r.key}
                    className="accent-cyan-600"
                  />
                  <kbd
                    aria-hidden="true"
                    className="hidden [@media(hover:hover)_and_(pointer:fine)]:inline-flex w-5 h-5 items-center justify-center rounded border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-500 dark:text-slate-400"
                  >
                    {r.key}
                  </kbd>
                  <span className="text-slate-800 dark:text-slate-100">{r.label}</span>
                </label>
              ))}
            </div>
            <Message>{shown("reason_preset")}</Message>
            <div className="mt-2 flex flex-col gap-1">
              <label htmlFor="return-detail" className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Detail {detailRequired ? "(required)" : "(optional)"}
              </label>
              <input
                id="return-detail"
                type="text"
                maxLength={500}
                {...NO_AUTOFILL}
                {...register("reason_detail", { onBlur: () => touch("reason_detail") })}
                aria-invalid={shown("reason_detail") ? "true" : undefined}
                placeholder={lower ? "Why the refund is lower" : preset === OTHER ? "What happened?" : "e.g. screen flickers"}
                className={inputClass(!!shown("reason_detail"))}
              />
              <Message>{shown("reason_detail")}</Message>
            </div>
          </fieldset>

          {outsideLines.length > 0 && (
            <fieldset disabled={busy} className="min-w-0 flex flex-col gap-1" data-testid="return-override">
              <legend className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-1">
                Outside warranty
              </legend>
              <ul className="text-xs text-slate-700 dark:text-slate-200">
                {outsideLines.map(({ line, label }) => (
                  <li key={line.id}>
                    {line.product_name_snapshot} ({label})
                  </li>
                ))}
              </ul>
              <label htmlFor="return-override" className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Manager&apos;s override reason (required)
              </label>
              <input
                id="return-override"
                type="text"
                maxLength={500}
                {...NO_AUTOFILL}
                {...register("override_reason", { onBlur: () => touch("override_reason") })}
                aria-invalid={shown("override_reason") || serverErrors.override_reason ? "true" : undefined}
                className={inputClass(!!(shown("override_reason") || serverErrors.override_reason))}
              />
              <Message>{serverErrors.override_reason ?? shown("override_reason")}</Message>
            </fieldset>
          )}
        </div>
      </div>

      <ManagerApprovalFields
        branchId={sale.branch_id}
        sessionUser={approval.sessionUser}
        approverRegistration={register("approver_id")}
        pinRegistration={register("pin")}
        // Only the server's refusals show under these: Return stays
        // disabled until the form is valid.
        approverError={serverErrors.approver_id}
        pinError={serverErrors.pin}
        setApprover={approval.setApprover}
        onStatus={approval.onStatus}
        disabled={busy}
      />
    </div>
  );
};

/**
 * What must stay in view above the refund step's scrolling part: how the
 * sale was paid (a card payment is seen before cash is handed over), the
 * server's refusal or the lost-response status. The dialog renders it
 * outside the scroll area, so an error is never scrolled away.
 *
 * PROPS: sale; alert ({ message, laterSale, lead, tail } | null);
 * onLeave (close the dialog, for the link); checking
 */
export const RefundNotices = ({ sale, alert, onLeave, checking }) => (
  <>
    <p className="text-xs text-slate-600 dark:text-slate-300" data-testid="return-paid">
      {paidLine(sale)}
    </p>
    {alert && (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-700 dark:text-red-300"
      >
        <AlertCircle size={16} aria-hidden="true" className="shrink-0 mt-px" />
        <p>
          {alert.laterSale ? (
            <>
              {alert.lead}
              <Link
                to={`${salesPath}/${alert.laterSale.id}`}
                onClick={onLeave}
                className="font-semibold underline underline-offset-2"
              >
                {alert.laterSale.sale_number}
              </Link>
              {alert.tail}
            </>
          ) : (
            alert.message
          )}
        </p>
      </div>
    )}
    {checking && (
      <p role="status" className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <Loader2 size={14} aria-hidden="true" className="animate-spin" />
        No answer from the server. Checking whether the return went through…
      </p>
    )}
  </>
);

const AddButton = ({ label, hint, disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="
      inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs
      border border-dashed border-slate-300 dark:border-slate-600
      text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800
      disabled:opacity-50 disabled:pointer-events-none
    "
  >
    <Plus size={12} aria-hidden="true" />
    <span>
      {label}
      {hint && <span className="text-slate-500 dark:text-slate-400">, {hint}</span>}
    </span>
  </button>
);

export default RefundStep;
