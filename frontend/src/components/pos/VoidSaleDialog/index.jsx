import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import ScrollFade from "../../common/ScrollFade";
import ManagerApprovalFields from "../ManagerApprovalFields";
import { methodLabel } from "../PaymentDialog/methods";
import { OTHER, VOID_REASONS, buildVoidPayload, voidFormDefaults, voidSchema } from "../../../schemas/voidSchema";
import { getSale, voidSale } from "../../../services/salesService";
import { recheckCashDay } from "../../../store/slices/cashDaySlice";
import { whenDayRechecked } from "../../../utils/posFocus";
import { formatLKR } from "../../../utils/money";
import { classifyVoidError, voidErrorView } from "../../../utils/voidErrors";
import { voidSummary } from "../../../utils/voidSummary";

/**
 * VoidSaleDialog Component
 *
 * Void a COMPLETED sale with a manager's or admin's approval PIN, on every
 * session (planning doc P6-8 – P6-13, P6-17 – P6-20).
 *
 * - Reason: six presets (keys 1–6 while the group has focus), detail
 *   required for Other (voidSchema). Focus opens on the reason; Void is
 *   never focused on open and is enabled only once the form is valid.
 * - What the void does and what to hand back outside the system
 *   (utils/voidSummary.js); a void records no refund (returns do, P7), so
 *   it points a customer returning items to Return items.
 * - Manager approval: ManagerApprovalFields (approver list fetched fresh
 *   on every open; the PIN field shared with D1).
 *
 * SENDING: one POST /sales/:id/void per click or Enter. A second click or
 * Enter while it's in flight is ignored (a ref, not just the disabled
 * button), so a double press can't spend two PIN attempts.
 *
 * ERRORS (utils/voidErrors.js voidErrorView): PIN and approver refusals
 * under their fields; everything else as an alert, with a link to the
 * later sale for the 409s that name one. A lost response, a timeout, a
 * 5xx or "not COMPLETED" never resends: the sale is re-read (GET
 * /sales/:id); VOIDED counts as done, COMPLETED says nothing was voided,
 * and if the re-read fails too, "Check again" re-reads only.
 *
 * TODAY NOT OPEN (409 DAY_NOT_OPEN / DAY_CLOSED, P9-9): checked before the
 * PIN, so nothing changed and no attempt was spent. The reason shows as
 * the alert and the footer is only Close, focused; never resent. Closing
 * re-reads the day gate (recheckCashDay): on a closed day the page stays
 * without Void and Return items; a day not opened shows the opening.
 *
 * THE PIN is cleared after every attempt and when the dialog closes; it
 * lives only in this form (never Redux, storage or logs), and the axios
 * error is never kept (it carries the request body).
 *
 * PROPS:
 * - open, onClose
 * - sale: the COMPLETED sale (hydrated)
 * - onVoided: (voidedSale) => void
 * - afterLeave: ({ dayRecheck }) => void, once the dialog has gone (the
 *   page hands focus on); dayRecheck, after a day refusal, is the gate's
 *   re-read (utils/posFocus.js whenDayRechecked: true when the gate took
 *   the focus), else null
 */

const FORM_ID = "void-sale-form";

const Section = ({ title, children }) => (
  <section className="min-w-0">
    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">{title}</h3>
    {children}
  </section>
);

const VoidSaleDialog = ({ open, onClose, sale, onVoided, afterLeave }) => {
  const dispatch = useDispatch();
  const sessionUser = useSelector((state) => state.auth.user);
  const [phase, setPhase] = useState("form"); // form | voiding | checking | unknown
  const [alert, setAlert] = useState(null); // { message, laterSale, lead, tail }
  const [blocked, setBlocked] = useState(false);
  const [dayRefused, setDayRefused] = useState(false);
  const [approvers, setApprovers] = useState({ status: "loading", count: 0 });
  const sending = useRef(false);
  const reasonGroup = useRef(null);
  const closeRef = useRef(null);
  const dayRecheck = useRef(null);

  // A day refusal leaves only Close: it takes the focus.
  useEffect(() => {
    if (dayRefused) closeRef.current?.focus();
  }, [dayRefused]);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    trigger,
    control,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(voidSchema),
    defaultValues: voidFormDefaults(),
    mode: "onChange",
  });

  const preset = useWatch({ control, name: "reason_preset" });
  const busy = phase === "voiding" || phase === "checking";
  const summary = voidSummary(sale);

  const clearAll = () => {
    reset(voidFormDefaults());
    setAlert(null);
    setBlocked(false);
    setPhase("form");
    sending.current = false;
  };

  const close = () => {
    if (busy) return;
    // P9-9: the cashier has read why; now the gate re-reads and moves on.
    if (dayRefused && !dayRecheck.current) dayRecheck.current = whenDayRechecked(dispatch(recheckCashDay()));
    clearAll();
    onClose();
  };

  // dayRefused is reset only here, so the footer stays Close while it fades.
  const onAfterLeave = () => {
    const recheck = dayRecheck.current;
    dayRecheck.current = null;
    setDayRefused(false);
    afterLeave?.({ dayRecheck: recheck });
  };

  const finishVoided = (voided) => {
    clearAll();
    onVoided(voided);
  };

  // Lost response, timeout, 5xx, not COMPLETED: read the sale, never resend.
  const reconcile = async () => {
    setPhase("checking");
    setAlert(null);
    try {
      const fresh = await getSale(sale.id);
      if (fresh.status === "VOIDED") {
        finishVoided(fresh);
        return;
      }
      setPhase("form");
      setAlert({ message: "Couldn't void: no answer from the server. Nothing was voided; try again." });
    } catch {
      setPhase("unknown");
      setAlert({ message: "Couldn't confirm whether the sale was voided. Check again before trying again." });
    }
  };

  const onSubmit = async (values) => {
    if (sending.current) return;
    sending.current = true;
    setPhase("voiding");
    setAlert(null);
    try {
      const voided = await voidSale(sale.id, buildVoidPayload(values));
      finishVoided(voided);
    } catch (err) {
      // Read what's needed, never keep the error (its config holds the PIN).
      const view = voidErrorView(classifyVoidError(err), { approverIsSelf: values.approver_id === sessionUser?.id });
      // The PIN goes after every attempt. Not validated here: a client
      // check finishing later would overwrite the server's message.
      setValue("pin", "");
      if (view.field === "pin") {
        setError("pin", { type: "server", message: view.message }, { shouldFocus: true });
      } else {
        await trigger("pin"); // the form is invalid again until a PIN is typed (no message shown)
      }
      if (view.reconcile) {
        await reconcile();
      } else {
        setPhase("form");
        if (view.blocksVoid) setBlocked(true);
        if (view.dayRefused) setDayRefused(true);
        if (view.field === "approver") setError("approver_id", { type: "server", message: view.message }, { shouldFocus: true });
        else if (view.field !== "pin") setAlert({ message: view.message, laterSale: view.laterSale, lead: view.lead, tail: view.tail });
      }
    } finally {
      sending.current = false;
    }
  };

  const canVoid = isValid && !busy && !blocked && phase !== "unknown" && approvers.status === "ready" && approvers.count > 0;
  const submit = () => {
    if (canVoid && !sending.current) handleSubmit(onSubmit)();
  };

  // 1–6 pick a preset while the reason group has focus.
  const onReasonKey = (e) => {
    if (e.target.type !== "radio") return; // typing digits in Detail is just typing
    const match = VOID_REASONS.find((r) => r.key === e.key);
    if (!match) return;
    e.preventDefault();
    setValue("reason_preset", match.value, { shouldValidate: true });
    reasonGroup.current?.querySelector(`input[value="${match.value}"]`)?.focus();
  };

  const presetRegistration = register("reason_preset");

  return (
    <Dialog
      open={open}
      onClose={close}
      afterLeave={onAfterLeave}
      title={`Void ${sale.sale_number}`}
      description={`Total ${formatLKR(sale.total)}. A void can't be undone.`}
      size="lg"
      dismissible={!busy}
      footer={
        dayRefused ? (
          <Button ref={closeRef} type="button" variant="accent" label="Close" onClick={close} />
        ) : (
          <>
            <Button type="button" variant="secondary" label="Cancel" onClick={close} disabled={busy} />
            {phase === "unknown" ? (
              <Button type="button" variant="accent" label="Check again" onClick={reconcile} />
            ) : (
              <Button
                type="button"
                variant="danger"
                label={phase === "checking" ? "Checking…" : "Void sale"}
                loading={busy}
                disabled={!canVoid}
                onClick={submit}
              />
            )}
          </>
        )
      }
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          // Enter voids only when everything is valid, and never twice.
          if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-4"
      >
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
                    to={`/pos/sales/${alert.laterSale.id}`}
                    onClick={close}
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
        {phase === "checking" && (
          <p role="status" className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <Loader2 size={14} aria-hidden="true" className="animate-spin" />
            No answer from the server. Checking whether the sale was voided…
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <fieldset ref={reasonGroup} onKeyDown={onReasonKey} disabled={busy} className="min-w-0">
            <legend className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              Reason <span className="normal-case tracking-normal font-normal">(keys 1–6)</span>
            </legend>
            <div role="radiogroup" aria-label="Reason" className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {VOID_REASONS.map((r, i) => (
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
                    data-autofocus={i === 0 ? true : undefined}
                    className="accent-cyan-600"
                  />
                  <kbd aria-hidden="true" className="hidden [@media(hover:hover)_and_(pointer:fine)]:inline-flex w-5 h-5 items-center justify-center rounded border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    {r.key}
                  </kbd>
                  <span className="text-slate-800 dark:text-slate-100">{r.label}</span>
                </label>
              ))}
            </div>
            {errors.reason_preset && preset === "" && (
              <p className="text-xs text-red-500 dark:text-red-400 mt-1">{errors.reason_preset.message}</p>
            )}
            <div className="mt-2 flex flex-col gap-1.5">
              <label htmlFor="void-detail" className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Detail {preset === OTHER ? "(required)" : "(optional)"}
              </label>
              {/* Never a username: Chrome ignores autocomplete="off" here,
                  so the real guard is the PIN field not being a saved-
                  password field (PinField's one-time-code). The data-*
                  attributes opt out of other password managers. */}
              <input
                id="void-detail"
                type="text"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore=""
                data-form-type="other"
                maxLength={500}
                {...register("reason_detail")}
                aria-invalid={errors.reason_detail ? "true" : undefined}
                placeholder={preset === OTHER ? "What happened?" : "e.g. rang 1,500, was 1,200"}
                className={`
                  h-10 w-full px-3 rounded-lg text-sm
                  bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100
                  border ${errors.reason_detail ? "border-red-400 dark:border-red-500" : "border-slate-300 dark:border-slate-600"}
                  focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500
                `}
              />
              {errors.reason_detail && (
                <p className="text-xs text-red-500 dark:text-red-400">{errors.reason_detail.message}</p>
              )}
            </div>
          </fieldset>

          {/* ≥ md this column scrolls inside (with the "more below" fade)
              so a long sale never pushes Void off a ~640px screen. Hand
              back comes first: the money is what the cashier must see
              without scrolling. */}
          <ScrollFade
            className="min-w-0 md:max-h-56 md:flex md:flex-col"
            scrollClassName="flex flex-col gap-4 md:flex-1 md:min-h-0 md:overflow-y-auto md:pr-1"
            testId="void-summary"
          >
            <Section title="Hand back, outside the system">
              <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200" data-testid="void-give-back">
                {summary.cashBack && <li>{formatLKR(summary.cashBack)} cash.</li>}
                {summary.referenced.map((p, i) => (
                  <li key={`${p.method}-${i}`}>
                    Reverse the {methodLabel(p.method)} payment of {formatLKR(p.amount)}
                    {p.reference ? ` (ref ${p.reference})` : ""}.
                  </li>
                ))}
                {!summary.cashBack && summary.referenced.length === 0 && <li>No money to hand back.</li>}
              </ul>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                A void doesn&apos;t record a refund. Give the money back as listed. If the customer is returning
                items, close this and use Return items instead.
              </p>
            </Section>

            <Section title="What the void does">
              <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200" data-testid="void-effects">
                {summary.restockCount > 0 && (
                  <li>
                    {summary.restockCount} {summary.restockCount === 1 ? "item goes" : "items go"} back to stock.
                  </li>
                )}
                {summary.phonesBack.length > 0 && <li>Phones back in stock: IMEI {summary.phonesBack.join(", ")}.</li>}
                {summary.otherShopCount > 0 && (
                  <li>
                    {summary.otherShopCount} {summary.otherShopCount === 1 ? "item" : "items"} from another shop: not
                    added to our stock. Return {summary.otherShopCount === 1 ? "it" : "them"} to that shop yourself.
                  </li>
                )}
                {summary.tradeInsOut.map((t) => (
                  <li key={t.imei ?? t.name} className="font-medium text-amber-800 dark:text-amber-300">
                    Trade-in phone goes back to the customer: {[t.name, t.imei && `IMEI ${t.imei}`].filter(Boolean).join(" · ")}.
                    Take it off the shelf.
                  </li>
                ))}
              </ul>
            </Section>
          </ScrollFade>
        </div>

        <ManagerApprovalFields
          branchId={sale.branch_id}
          sessionUser={sessionUser}
          approverRegistration={register("approver_id")}
          pinRegistration={register("pin")}
          // Only the server's refusals show under these fields: Void stays
          // disabled until the form is valid, so client errors need no text.
          approverError={errors.approver_id?.type === "server" ? errors.approver_id.message : undefined}
          pinError={errors.pin?.type === "server" ? errors.pin.message : undefined}
          setApprover={(id) => setValue("approver_id", id, { shouldValidate: true })}
          onStatus={setApprovers}
          disabled={busy}
        />
      </form>
    </Dialog>
  );
};

export default VoidSaleDialog;
