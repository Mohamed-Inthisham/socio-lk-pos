import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { useDispatch, useSelector } from "react-redux";
import { AlertCircle } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import ScrollFade from "../../common/ScrollFade";
import ReturnLineRow from "./ReturnLineRow";
import RefundStep, { RefundNotices } from "./RefundStep";
import ReturnRecorded from "./ReturnRecorded";
import {
  amountCents,
  buildReturnPayload,
  buildReturnSchema,
  defaultRefundRows,
  itemsIssues,
  refundTotalCents,
  returnContext,
  returnFormDefaults,
} from "../../../schemas/returnSchema";
import { CASH } from "../../../schemas/paymentSchema";
import { createReturn, getSale } from "../../../services/salesService";
import { listStock } from "../../../services/stockService";
import { recheckCashDay } from "../../../store/slices/cashDaySlice";
import { whenDayRechecked } from "../../../utils/posFocus";
import { printReturnSlip } from "../../../utils/printReceipt";
import { announceInspectionChange } from "../../../hooks/useInspectionCount";
import { colomboToday } from "../../../utils/colomboDay";
import { formatLKR, fromCents, toCents } from "../../../utils/money";
import { formatSlPhone } from "../../../utils/phone";
import { receiptDate } from "../../../utils/receipt";
import { newClientRequestId } from "../../../utils/requestId";
import { RETURN_ERROR, classifyReturnError, findReturnByRequestId, returnErrorView } from "../../../utils/returnErrors";
import {
  daysSinceSale,
  lineDisposition,
  lineWarrantyStatus,
  refundShareCents,
  returnableQuantity,
  saleTradeInShareCents,
} from "../../../utils/returnMath";

/**
 * ReturnDialog Component
 *
 * Return items from a COMPLETED sale (planning doc P7-3 – P7-5, P7-9,
 * P7-15, P7-16, P7-20, P7-23). Two steps in one form, then the recorded
 * return.
 *
 * 1 ITEMS: every line, in line order, with what is left to return
 * (ReturnLineRow): a quantity stepper capped at it; Back to stock /
 * Damaged where the cashier decides; "Goes to inspection" for our
 * phones, "Not our stock" for another shop's lines, "Not stock-tracked"
 * for untracked products (lineDisposition, P7-8); each line's warranty
 * status (P7-22). The header says how long ago it was sold (information
 * only, no time limit). Next checks the items alone (itemsIssues);
 * Back keeps them.
 *
 * 2 REFUND (RefundStep): how the sale was paid; refund rows that start the
 * way it was paid (defaultRefundRows: its card / bank / Koko / Mintpay
 * payments first, the rest in Cash); adding a payment row moves its
 * amount out of the cash row, removing one gives it back; the reason; the
 * override reason
 * when a line is outside warranty; the manager's approval. Return is
 * enabled once the whole schema passes (buildReturnSchema).
 *
 * SENDING: one POST /sales/:id/returns per press (a ref, not just the
 * disabled button), with the request id made when the dialog opened
 * (P7-15). The PIN is cleared after every attempt. Errors by code
 * (utils/returnErrors.js): the PIN and approver under their fields, the
 * override reason on its field (with the server's lines), refund errors
 * under Refund; another return or a stock-tracking change meanwhile
 * re-reads the sale (onSaleChanged) and goes back to the items; anything
 * that can't be fixed here blocks Return.
 *
 * LOST RESPONSE (a timeout, no response, a 5xx): re-read the sale and look
 * for a return with this request id. Found: it went through. None: Try
 * again, which resends the same id (the PIN typed again); a request the
 * server had recorded after all comes back 200 and shows as recorded.
 * If the re-read fails too: Check again, which only re-reads.
 *
 * TODAY NOT OPEN (409 DAY_NOT_OPEN / DAY_CLOSED, P9-9): checked before the
 * PIN, so nothing was recorded under the request id and no attempt was
 * spent; nothing is resent. The reason shows as the alert and the footer
 * is only Close, focused. Closing drops the request id (the next opening
 * makes a new one) and re-reads the day gate (recheckCashDay).
 *
 * 3 RECORDED (ReturnRecorded): what to hand over and where the items go,
 * read from the sale the server answered with; Done is focused. The
 * return slip prints on its own, two copies (printReturnSlip, P7-17);
 * Print again prints them again, unmarked.
 *
 * STOCK TRACKING decides whether a line takes a condition, and sale lines
 * don't carry it: one GET /stock?branchId= when the dialog opens, only
 * when a line could need it (FOLLOWUPS). Until it answers Next waits; if
 * it fails, Try again.
 *
 * KEYS: items — each row is a stop; ↑/↓ move between rows, ←/→ (or −/+)
 * change the quantity, B / D pick Back to stock / Damaged, Enter is
 * Next. Refund — 1–5 pick a reason while the group has focus, Enter in
 * a field sends. Esc closes, except while sending or checking. Page
 * hotkeys stay off while a dialog is open.
 *
 * PROPS:
 * - open, onClose
 * - sale: the COMPLETED sale (hydrated, with returned_quantity and returns[])
 * - onReturned: (sale) => void — the sale the server answered with
 * - onSaleChanged: (sale) => void — a re-read after a refusal
 * - afterLeave: ({ dayRecheck }) => void, once the dialog has gone (the
 *   page hands focus on); dayRecheck, after a day refusal, is the gate's
 *   re-read (utils/posFocus.js whenDayRechecked: true when the gate took
 *   the focus), else null
 */

const STEP_ITEMS = "items";
const STEP_REFUND = "refund";

/** Refusals that mean the dialog's copy of the sale is out of date. */
const BACK_TO_ITEMS = [RETURN_ERROR.QTY_EXCEEDED, RETURN_ERROR.CONDITION_INVALID, RETURN_ERROR.LINE_NOT_ON_SALE];

// ManagerApprovalFields' approver select and PinField
const PIN_FIELD_ID = "void-approval-pin";
const APPROVER_FIELD_ID = "void-approver";

/** Whether any line still to return needs the stock-tracking read. */
const needsStockRead = (sale) =>
  sale.lines.some((l) => !l.external_supplier_id && !l.product_unit_id && returnableQuantity(l) > 0);

const soldLine = (sale, today) => {
  const days = daysSinceSale(sale, today);
  const when = receiptDate(colomboToday(new Date(sale.completed_at)));
  if (days === 0) return `Sold today · ${when}`;
  return `Sold ${days} ${days === 1 ? "day" : "days"} ago · ${when}`;
};

const customerLine = (sale) =>
  sale.customer
    ? `${sale.customer.name}${sale.customer.phone ? ` · ${formatSlPhone(sale.customer.phone)}` : ""}`
    : "Walk-in customer";

const OUTSIDE_LABEL = {
  expired: "warranty expired",
  checking: "Checking only",
  none: "No warranty",
  within: "outside warranty by the shop's date",
};

const cashRow = (cents) => ({ method: CASH, payment_id: "", reference: "", amount: cents > 0 ? fromCents(cents) : "" });

/** Issues by path ("refunds.0.amount"), the first message for each. */
const issuesByPath = (result) => {
  if (result.success) return {};
  const out = {};
  for (const i of result.error.issues) out[i.path.join(".")] ??= i.message;
  return out;
};

const focusById = (id) => setTimeout(() => document.getElementById(id)?.focus(), 0);

/**
 * Focus a field of the approval block, then scroll the refund step to its
 * end: the approval block is last, so its message (under the field) is
 * seen too. Focus alone scrolls only the field partly in. After the
 * message has rendered (the timeout, then a frame for layout).
 */
const focusApproval = (id) =>
  setTimeout(() => {
    document.getElementById(id)?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      const area = document.querySelector('[data-testid="return-refund-scroll"]');
      if (area) area.scrollTop = area.scrollHeight;
    });
  }, 0);

const ReturnDialog = ({ open, onClose, sale, onReturned, onSaleChanged, afterLeave }) => {
  const dispatch = useDispatch();
  const sessionUser = useSelector((state) => state.auth.user);
  const [step, setStep] = useState(STEP_ITEMS);
  const [stock, setStock] = useState({ status: "loading", tracked: {} });
  const [stockAttempt, setStockAttempt] = useState(0);
  const [rowErrors, setRowErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [active, setActive] = useState(0);
  // Refund step
  const [phase, setPhase] = useState("form"); // form | sending | checking | unknown | done
  const [alert, setAlert] = useState(null); // { message, laterSale, lead, tail }
  const [blocked, setBlocked] = useState(false);
  const [dayRefused, setDayRefused] = useState(false);
  const [notRecorded, setNotRecorded] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const [serverOutsideIds, setServerOutsideIds] = useState([]);
  const [approvers, setApprovers] = useState({ status: "loading", count: 0 });
  const [touched, setTouched] = useState(() => new Set());
  const [recorded, setRecorded] = useState(null); // { ret, sale, resent }
  const [slip, setSlip] = useState("idle"); // idle | printing | printed | failed
  const requestId = useRef(null);
  const rowRefs = useRef({});
  const sending = useRef(false);
  const refundBasis = useRef(null);
  const doneRef = useRef(null);
  const closeRef = useRef(null);
  const dayRecheck = useRef(null);

  const { register, reset, setValue, getValues, control } = useForm({ defaultValues: returnFormDefaults(sale) });
  const { fields: refundRows, append, remove, replace } = useFieldArray({ control, name: "refunds" });
  const values = useWatch({ control });
  const quantities = values.quantities ?? {};
  const conditions = values.conditions ?? {};

  const today = colomboToday();
  const openLines = sale.lines.filter((l) => returnableQuantity(l) > 0);
  const readNeeded = needsStockRead(sale);
  const stockReady = !readNeeded || stock.status === "ready";
  const busy = phase === "sending" || phase === "checking";

  // One request id per opening (P7-15): made when the dialog opens, kept
  // until it closes (clearAll).
  useEffect(() => {
    if (open && !requestId.current) requestId.current = newClientRequestId();
  }, [open]);

  // The stock-tracking read, on open and on Try again. clearAll puts it
  // back to "loading" when the dialog closes.
  useEffect(() => {
    if (!open || !readNeeded) return;
    let live = true;
    listStock({ branchId: sale.branch_id })
      .then((rows) => {
        if (!live) return;
        setStock({
          status: "ready",
          tracked: Object.fromEntries(rows.map((row) => [row.product_id, row.manage_stock])),
        });
      })
      .catch(() => {
        if (live) setStock({ status: "error", tracked: {} });
      });
    return () => {
      live = false;
    };
    // The branch and the need for it don't change while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stockAttempt]);

  // Done takes the focus once the return is recorded.
  useEffect(() => {
    if (phase === "done") doneRef.current?.focus();
  }, [phase]);

  // A day refusal leaves only Close: it takes the focus.
  useEffect(() => {
    if (dayRefused) closeRef.current?.focus();
  }, [dayRefused]);

  const retryStock = () => {
    setStock({ status: "loading", tracked: {} });
    setStockAttempt((n) => n + 1);
  };

  const context = useMemo(
    () => returnContext(sale, { stockTracked: stock.tracked, serverOutsideIds, today }),
    [sale, stock.tracked, serverOutsideIds, today],
  );

  const dispositionOf = (line) => {
    const fixed = lineDisposition(line, { stockTracked: true });
    if (fixed) return fixed; // another shop's line or a phone: no read needed
    if (!stockReady) return "pending";
    return lineDisposition(line, { stockTracked: stock.tracked[line.product_id] !== false });
  };

  const selectedLines = sale.lines.filter((l) => (quantities[l.id] ?? 0) > 0);
  const itemCount = selectedLines.reduce((sum, l) => sum + quantities[l.id], 0);
  const dueCents = context.refundDueCents(quantities);
  const outsideIds = context.outsideIds(quantities);
  const lineName = (id) => sale.lines.find((l) => l.id === id)?.product_name_snapshot ?? null;

  // Refund step figures
  const issues = step === STEP_REFUND ? issuesByPath(buildReturnSchema(context).safeParse(values)) : {};
  const totalCents = refundTotalCents(values.refunds ?? []);
  const tradeInCents = saleTradeInShareCents(sale, totalCents);
  const outsideLines = outsideIds.map((id) => {
    const line = sale.lines.find((l) => l.id === id);
    return { line, label: OUTSIDE_LABEL[lineWarrantyStatus(line, today).kind] };
  });

  const clearRowError = (lineId) => {
    if (rowErrors[lineId]) setRowErrors((all) => ({ ...all, [lineId]: null }));
  };

  const setQuantity = (line, n) => {
    const q = Math.max(0, Math.min(returnableQuantity(line), n));
    setValue(`quantities.${line.id}`, q);
    if (q === 0) setValue(`conditions.${line.id}`, "");
    clearRowError(line.id);
    if (q > 0) setFormError(null);
  };

  const setCondition = (line, value) => {
    setValue(`conditions.${line.id}`, value);
    clearRowError(line.id);
  };

  const focusRow = (index) => {
    const line = openLines[index];
    if (!line) return;
    setActive(index);
    rowRefs.current[line.id]?.focus();
  };

  const touch = useCallback((path) => {
    setTouched((prev) => (prev.has(path) ? prev : new Set(prev).add(path)));
  }, []);

  const setApprover = useCallback((id) => setValue("approver_id", id), [setValue]);

  // Everything back to a fresh return, ready for the next opening.
  const clearAll = () => {
    reset(returnFormDefaults(sale));
    setStep(STEP_ITEMS);
    setRowErrors({});
    setFormError(null);
    setActive(0);
    setStock({ status: "loading", tracked: {} });
    setPhase("form");
    setAlert(null);
    setBlocked(false);
    setNotRecorded(false);
    setServerErrors({});
    setServerOutsideIds([]);
    setApprovers({ status: "loading", count: 0 });
    setTouched(new Set());
    setRecorded(null);
    setSlip("idle");
    requestId.current = null;
    refundBasis.current = null;
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

  const next = () => {
    if (!stockReady) return;
    const current = getValues();
    const found = itemsIssues(current, context);
    const byLine = {};
    let top = null;
    for (const { path, message } of found) {
      if (path.length === 1) top = message;
      else byLine[path[1]] ??= message;
    }
    setRowErrors(byLine);
    setFormError(top);
    if (found.length > 0) {
      const first = openLines.findIndex((l) => byLine[l.id]);
      focusRow(first === -1 ? 0 : first);
      return;
    }
    // Refund rows start the way the sale was paid (defaultRefundRows); kept
    // while the due is unchanged (Back and Next again), reset when the
    // items changed it. A first row going back to a payment needs its
    // reversal reference: focus it.
    if (refundBasis.current !== dueCents) {
      const rows = defaultRefundRows(context, dueCents);
      replace(rows);
      refundBasis.current = dueCents;
      setTouched(new Set());
      if (rows[0] && rows[0].method !== CASH) focusById("refund-reference-0");
    }
    setStep(STEP_REFUND);
  };

  const back = () => {
    setStep(STEP_ITEMS);
    const first = openLines.findIndex((l) => (quantities[l.id] ?? 0) > 0);
    setTimeout(() => focusRow(first === -1 ? 0 : first), 0);
  };

  // A payment row takes its amount out of the cash row, so the total stays
  // where it was (normally the refund due).
  const addPaymentRow = (payment) => {
    const rows = getValues("refunds");
    const cashIndex = rows.findIndex((r) => r.method === CASH);
    const cashCents = cashIndex === -1 ? 0 : amountCents(rows[cashIndex].amount) || 0;
    const take = Math.min(payment.refundableCents, Math.max(0, cashCents));
    let index = rows.length;
    if (cashIndex !== -1 && take > 0) {
      if (cashCents - take <= 0) {
        remove(cashIndex);
        index -= 1;
      } else {
        setValue(`refunds.${cashIndex}.amount`, fromCents(cashCents - take));
      }
    }
    append({ method: payment.method, payment_id: payment.id, reference: "", amount: take > 0 ? fromCents(take) : "" });
    setServerErrors((e) => ({ ...e, refund: undefined }));
    focusById(`refund-reference-${index}`);
  };

  const addCashRow = () => {
    append(cashRow(dueCents - totalCents));
    focusById(`refund-amount-${getValues("refunds").length - 1}`);
  };

  // Removing a payment row gives its amount back to cash (a Cash row is
  // added if there is none), so the total stays where it was. Removing the
  // Cash row lowers the refund (the detail then says why).
  const removeRow = (index) => {
    const rows = getValues("refunds");
    const row = rows[index];
    const back = row.method === CASH ? 0 : amountCents(row.amount) || 0;
    const cashIndex = rows.findIndex((r) => r.method === CASH);
    if (back > 0 && cashIndex !== -1) {
      const cashCents = amountCents(rows[cashIndex].amount) || 0;
      setValue(`refunds.${cashIndex}.amount`, fromCents(cashCents + back));
    }
    remove(index);
    if (back > 0 && cashIndex === -1) append(cashRow(back));
    setServerErrors((e) => ({ ...e, refund: undefined }));
  };

  // The return slip, two copies (P7-17): printed on its own once the return
  // is recorded, and again (unmarked) from Print again.
  const printSlip = async (fresh, returnId) => {
    setSlip("printing");
    try {
      await printReturnSlip(fresh, returnId);
      setSlip("printed");
    } catch {
      setSlip("failed");
    }
  };

  const succeed = (fresh, returnId, resent) => {
    const ret = fresh.returns.find((r) => r.id === returnId) ?? fresh.returns[fresh.returns.length - 1];
    setValue("pin", "");
    setRecorded({ ret, sale: fresh, resent });
    setAlert(null);
    setPhase("done");
    onReturned?.(fresh);
    // Every way to a recorded return prints: a 201, a resend answered 200,
    // a lost response found on re-read (nothing was printed for those).
    printSlip(fresh, ret.id);
    // A phone went to inspection: the header's Phones to check count reads again (P7-7).
    if (ret.lines.some((l) => l.disposition === "INSPECTION")) announceInspectionChange();
  };

  // Lost response, timeout, 5xx: re-read and look for this request id.
  const reconcile = async () => {
    setPhase("checking");
    setAlert(null);
    try {
      const fresh = await getSale(sale.id);
      const found = findReturnByRequestId(fresh, requestId.current);
      if (found) {
        succeed(fresh, found.id, false);
        return;
      }
      setPhase("form");
      setNotRecorded(true);
      setAlert({ message: "The return wasn't recorded. Enter the PIN again and press Try again." });
    } catch {
      setPhase("unknown");
      setAlert({ message: "Couldn't confirm whether the return went through. Check again before trying again." });
    }
  };

  // Another return, a void or a stock-tracking change meanwhile: re-read
  // the sale and hand it up; the items step shows what changed.
  const refresh = async (error, view) => {
    try {
      const fresh = await getSale(sale.id);
      onSaleChanged?.(fresh);
      for (const line of fresh.lines) {
        const q = getValues(`quantities.${line.id}`) ?? 0;
        if (q > returnableQuantity(line)) setValue(`quantities.${line.id}`, returnableQuantity(line));
      }
      if (error.kind === RETURN_ERROR.CONDITION_INVALID) retryStock();
      if (BACK_TO_ITEMS.includes(error.kind)) {
        setStep(STEP_ITEMS);
        if (error.sale_line_id && fresh.lines.some((l) => l.id === error.sale_line_id)) {
          setRowErrors({ [error.sale_line_id]: view.message });
        } else {
          setFormError(view.message);
        }
        refundBasis.current = null; // the refund due may have moved
      } else {
        setAlert({ message: view.message });
      }
    } catch {
      setAlert({ message: `${view.message} Couldn't re-read the sale: close this and open the sale again.` });
      setBlocked(true);
    }
  };

  const send = async () => {
    if (sending.current) return;
    sending.current = true;
    const current = getValues();
    setPhase("sending");
    setAlert(null);
    setServerErrors({});
    try {
      const result = await createReturn(
        sale.id,
        buildReturnPayload(current, { clientRequestId: requestId.current, context }),
      );
      succeed(result.sale, result.return_id, result.resent);
    } catch (err) {
      // Read what's needed, never keep the error (its config holds the PIN).
      const error = classifyReturnError(err);
      const view = returnErrorView(error, { approverIsSelf: current.approver_id === sessionUser?.id, lineName });
      setValue("pin", "");
      if (view.reconcile) {
        await reconcile();
        return;
      }
      setPhase("form");
      setNotRecorded(false);
      if (view.blocks) setBlocked(true);
      if (view.dayRefused) setDayRefused(true);
      if (view.refresh) {
        await refresh(error, view);
      } else if (view.field === "pin") {
        setServerErrors({ pin: view.message });
        focusApproval(PIN_FIELD_ID);
      } else if (view.field === "approver") {
        setServerErrors({ approver_id: view.message });
        focusApproval(APPROVER_FIELD_ID);
      } else if (view.field === "override_reason") {
        setServerOutsideIds(error.sale_line_ids ?? []);
        setServerErrors({ override_reason: view.message });
        focusById("return-override");
      } else if (view.field === "refund" || view.field === "refunds") {
        setServerErrors({ refund: view.message });
      } else {
        setAlert({ message: view.message, laterSale: view.laterSale, lead: view.lead, tail: view.tail });
      }
    } finally {
      sending.current = false;
    }
  };

  const valid = Object.keys(issues).length === 0;
  const canSend =
    phase === "form" && !blocked && valid && approvers.status === "ready" && approvers.count > 0;

  const submit = () => {
    if (canSend) {
      send();
    } else if (phase === "form") {
      setTouched(new Set(["*"])); // show every field's message
    }
  };

  const summary = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm" data-testid="return-summary">
      <span className="text-slate-600 dark:text-slate-300">
        {itemCount === 0 ? "No items picked yet" : `${itemCount} ${itemCount === 1 ? "item" : "items"}`}
      </span>
      <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        Refund due {formatLKR(fromCents(dueCents))}
      </span>
      {step === STEP_ITEMS && outsideIds.length > 0 && (
        <p className="basis-full text-xs text-amber-700 dark:text-amber-300">
          Outside warranty: a manager&apos;s override reason is needed.
        </p>
      )}
    </div>
  );

  // The body is capped at what the screen leaves after the dialog's title,
  // footer and margins; only the scrolling part gives up height (min-h-0),
  // so an alert or a note never pushes the buttons off a ~640px screen
  // (Q23). The title wraps at phone width, hence the larger allowance there.
  const BODY = "flex flex-col gap-3 min-h-0 max-h-[calc(100dvh-16.5rem)] sm:max-h-[calc(100dvh-13.5rem)]";

  const footer = () => {
    if (phase === "done") {
      return <Button ref={doneRef} type="button" variant="accent" label="Done" onClick={close} />;
    }
    if (dayRefused) {
      return <Button ref={closeRef} type="button" variant="accent" label="Close" onClick={close} />;
    }
    if (step === STEP_ITEMS) {
      return (
        <>
          <Button type="button" variant="secondary" label="Cancel" onClick={close} />
          <Button type="button" variant="accent" label="Next: refund" disabled={!stockReady} onClick={next} />
        </>
      );
    }
    return (
      <>
        <Button type="button" variant="secondary" label="Back" onClick={back} disabled={busy} />
        {phase === "unknown" ? (
          <Button type="button" variant="accent" label="Check again" onClick={reconcile} />
        ) : (
          <Button
            type="button"
            variant="accent"
            label={phase === "checking" ? "Checking…" : notRecorded ? "Try again" : "Return items"}
            loading={busy}
            disabled={!canSend}
            onClick={submit}
          />
        )}
      </>
    );
  };

  const body = () => {
    if (phase === "done" && recorded) {
      return (
        <ScrollFade className={BODY} scrollClassName="min-h-0 overflow-y-auto pr-1" testId="return-recorded-scroll">
          <ReturnRecorded
            ret={recorded.ret}
            sale={recorded.sale}
            resent={recorded.resent}
            slip={slip}
            onPrintAgain={() => printSlip(recorded.sale, recorded.ret.id)}
          />
        </ScrollFade>
      );
    }
    if (step === STEP_ITEMS) {
      return (
        <div
          className={BODY}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.target.tagName === "BUTTON") return;
            e.preventDefault();
            next();
          }}
        >
          {readNeeded && stock.status === "error" && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-2.5 text-xs text-amber-800 dark:text-amber-200"
            >
              <AlertCircle size={16} aria-hidden="true" className="shrink-0" />
              <span className="flex-1">Couldn&apos;t check which items are stock-tracked.</span>
              <Button size="sm" variant="secondary" label="Try again" onClick={retryStock} />
            </div>
          )}

          <ScrollFade
            className="min-h-0 flex flex-col"
            scrollClassName="min-h-0 flex flex-col gap-2 overflow-y-auto pr-1"
            testId="return-lines"
          >
            {sale.lines.map((line) => {
              const left = returnableQuantity(line);
              const index = openLines.indexOf(line);
              const q = quantities[line.id] ?? 0;
              return (
                <ReturnLineRow
                  key={line.id}
                  ref={(el) => {
                    rowRefs.current[line.id] = el;
                  }}
                  line={line}
                  quantity={q}
                  left={left}
                  disposition={dispositionOf(line)}
                  condition={conditions[line.id] ?? ""}
                  onCondition={(v) => setCondition(line, v)}
                  warranty={lineWarrantyStatus(line, today)}
                  shareCents={
                    q > 0 ? refundShareCents(toCents(line.line_total), line.quantity, line.returned_quantity ?? 0, q) : null
                  }
                  error={rowErrors[line.id] ?? null}
                  active={index === active}
                  onQuantity={(n) => setQuantity(line, n)}
                  onMove={(delta) => focusRow(Math.max(0, Math.min(openLines.length - 1, index + delta)))}
                  onFocus={() => index !== -1 && setActive(index)}
                />
              );
            })}
          </ScrollFade>

          {formError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
          {summary}
        </div>
      );
    }
    return (
      <form
        noValidate
        className={BODY}
        data-testid="return-refund-step"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          // Enter in a field sends, only when everything is valid, never twice.
          if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
          e.preventDefault();
          submit();
        }}
      >
        {summary}
        <RefundNotices sale={sale} alert={alert} onLeave={close} checking={phase === "checking"} />
        <ScrollFade className="min-h-0 flex flex-col" scrollClassName="min-h-0 overflow-y-auto pr-1" testId="return-refund-scroll">
          <RefundStep
            sale={sale}
            context={context}
            register={register}
            rows={refundRows}
            values={{ ...values, refunds: values.refunds ?? [] }}
            issues={issues}
            touched={touched}
            touch={touch}
            totalCents={totalCents}
            dueCents={dueCents}
            tradeInCents={tradeInCents}
            outsideLines={outsideLines}
            onAddPayment={addPaymentRow}
            onAddCash={addCashRow}
            onRemoveRow={removeRow}
            serverErrors={serverErrors}
            approval={{ sessionUser, setApprover, onStatus: setApprovers }}
            busy={busy || phase === "unknown"}
          />
        </ScrollFade>
      </form>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      afterLeave={onAfterLeave}
      title={`Return items · ${sale.sale_number}`}
      description={`${customerLine(sale)} · ${soldLine(sale, today)}`}
      // xl: a picked line's controls sit beside its full name (ReturnLineRow)
      size="xl"
      dismissible={!busy}
      footer={footer()}
    >
      {body()}
    </Dialog>
  );
};

export default ReturnDialog;
