import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import InputField from "../../common/InputField";
import CashDayFigures from "../CashDayFigures";
import { MONEY_SHAPE } from "../../../schemas/paymentSchema";
import { buildCloseDaySchema, REASON_MAX } from "../../../schemas/closeDaySchema";
import {
  closeDay,
  endCloseDay,
  fetchCloseSummary,
  selectCashDayCurrent,
  selectCloseDay,
} from "../../../store/slices/cashDaySlice";
import { selectCartLines } from "../../../store/slices/posTerminalSlice";
import { CASH_DAY_ERROR, cashDayErrorView } from "../../../utils/cashDayErrors";
import { differenceCents, needsReason } from "../../../utils/cashDayMath";
import { shortDayLabel } from "../../../utils/cashDayLabels";
import { formatColomboTime } from "../../../utils/colomboTime";
import { toCents } from "../../../utils/money";
import { focusTerminalMain } from "../../../utils/posFocus";

/**
 * CloseDayDialog Component
 *
 * Closing a cash day (planning doc P9-11, P9-12): today's from the status
 * strip, or an earlier day still open from the day gate. One host in
 * TerminalLayout; it is open while cashDaySlice `close.dayId` is set
 * (beginCloseDay) and ends with endCloseDay once it has gone.
 *
 * A HEADLESS MODAL over the till: the page behind it is inert, so the scan
 * bar and every hotkey are dead while it is open.
 *
 * STAGES:
 * - Figures loading (or failed, with Try again).
 * - Count: the counted cash, focused. The figures show from the start (no
 *   blind count, P9-24); Counted and Difference follow the typing, the
 *   difference in the till's words (describeDifferenceForDisplay). The
 *   reason box shows from 1.00 either way (the rounding rule). The open
 *   sale's items are warned about and block closing until the sale is
 *   completed or discarded (P9-12). A notice says the close discards
 *   unfinished sales without a payment on every till at the branch; one
 *   with a payment makes the server refuse (OPEN_SALES), which can be
 *   sent again from Confirm once it is dealt with. Esc cancels; nothing
 *   is sent.
 * - Confirm: the count and reason read-only, then "No more sales today
 *   after closing. This can't be undone." Focus on Back, so a stray Enter
 *   never closes the day; Esc goes back.
 * - Submitting: not dismissable.
 * - Closed: the RETURNED day's figures (an accepted resend answers with
 *   what was recorded, never the form). Done or Esc closes.
 *
 * SERVER ANSWERS: EXPECTED_CHANGED goes back to Count with the fresh
 * figures and the count kept, and needs a new confirm; REASON_REQUIRED
 * goes back to Count with the reason box open. A lost answer the slice
 * couldn't settle (close.unconfirmed) keeps Confirm with the inputs
 * read-only and only Try again, not dismissable: the resend is the first
 * send's body.
 *
 * FOCUS AFTER DONE: after closing an earlier day, the opening amount;
 * after closing today, the page's main heading (the Day closed screen on
 * /pos, the sales list or sale on /pos/sales…).
 */

const FORM_ID = "close-day-form";
const EMPTY = { counted_balance: "", difference_reason: "" };

const Alert = ({ children }) => (
  <div
    role="alert"
    className="mb-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2 flex items-start gap-2"
  >
    <AlertCircle size={16} aria-hidden="true" className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
    <p className="text-xs text-red-700 dark:text-red-300">{children}</p>
  </div>
);

const CloseDayDialog = () => {
  const dispatch = useDispatch();
  const close = useSelector(selectCloseDay);
  const current = useSelector(selectCashDayCurrent);
  const cartLines = useSelector(selectCartLines);
  // count | confirm, remembered with the dialog (request id) it belongs to
  // and the server error already seen when it was set.
  const [stageState, setStageState] = useState({ id: null, stage: "count", error: null });
  const [leaving, setLeaving] = useState(false);
  const focusTarget = useRef(null);
  const backRef = useRef(null);
  const doneRef = useRef(null);
  const retryRef = useRef(null);

  const summary = close.summary;
  // The schema follows the expected on show (it changes on EXPECTED_CHANGED);
  // validation runs on submit, after this effect.
  const expectedRef = useRef("0.00");
  useEffect(() => {
    expectedRef.current = summary?.expected_balance ?? "0.00";
  }, [summary]);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setFocus,
    formState: { errors },
  } = useForm({
    resolver: (values, context, options) =>
      zodResolver(buildCloseDaySchema(expectedRef.current))(values, context, options),
    defaultValues: EMPTY,
  });

  // A new dialog (a new request id) starts with a blank form.
  useEffect(() => {
    reset(EMPTY);
    focusTarget.current = null;
  }, [close.clientRequestId, reset]);

  const errorKind = close.error?.kind;
  const setStage = (next) => setStageState({ id: close.clientRequestId, stage: next, error: close.error });
  // A new dialog starts on Count; so does a server answer that needs the
  // user to look again (EXPECTED_CHANGED, REASON_REQUIRED) until they go on.
  const lookAgain =
    (errorKind === CASH_DAY_ERROR.EXPECTED_CHANGED || errorKind === CASH_DAY_ERROR.REASON_REQUIRED) &&
    stageState.error !== close.error;
  const stage = stageState.id !== close.clientRequestId || lookAgain ? "count" : stageState.stage;

  const submitting = close.status === "submitting";
  const closed = close.status === "closed";
  const unconfirmed = close.unconfirmed;
  const shown = closed ? "closed" : unconfirmed ? "confirm" : stage;
  const locked = shown === "confirm" || submitting;

  useEffect(() => {
    if (shown === "confirm" && !unconfirmed && !submitting) backRef.current?.focus();
    if (shown === "confirm" && unconfirmed && !submitting) retryRef.current?.focus();
    if (shown === "closed") doneRef.current?.focus();
    if (shown === "count" && summary) setFocus("counted_balance");
  }, [shown, unconfirmed, submitting, summary, setFocus]);

  const [countedValue, reasonValue] = useWatch({ control, name: ["counted_balance", "difference_reason"] });
  const counted = countedValue ?? "";
  const reason = reasonValue ?? "";
  const countedOk = MONEY_SHAPE.test(counted.trim());
  const diff = summary && countedOk ? differenceCents(toCents(counted.trim()), summary.expected_balance) : NaN;
  const reasonForced = errorKind === CASH_DAY_ERROR.REASON_REQUIRED;
  const showReason = needsReason(diff) || reasonForced;

  const isToday = !!close.dayId && close.dayId === current.today?.id;
  const earlierDate = current.earlierOpen?.id === close.dayId ? current.earlierOpen.business_date : null;
  const dayDate = summary?.business_date ?? earlierDate;
  const title =
    !isToday && dayDate ? `Close ${shortDayLabel(dayDate, current.businessDate)}` : "Close the day";

  const items = isToday ? cartLines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0) : 0;

  const view = close.error ? cashDayErrorView(close.error) : null;
  const reasonError = errors.difference_reason?.message || (view?.field === "reason" ? view.message : undefined);
  const blocked = !!close.error?.blocks;

  const leave = () => setLeaving(true);
  const onDone = () => {
    const closedDate = close.closedDay?.business_date;
    focusTarget.current = closedDate && closedDate !== current.businessDate ? "amount" : "heading";
    leave();
  };
  const afterLeave = () => {
    const target = focusTarget.current;
    focusTarget.current = null;
    dispatch(endCloseDay());
    setLeaving(false);
    if (target) setTimeout(() => focusTerminalMain(target), 0);
  };
  const onClose = () => {
    if (submitting || unconfirmed) return;
    if (shown === "closed") onDone();
    else if (shown === "confirm") setStage("count");
    else leave();
  };

  const toConfirm = handleSubmit(() => {
    if (items > 0) return;
    setStage("confirm");
  });
  const send = () => {
    if (unconfirmed) {
      dispatch(closeDay());
      return;
    }
    dispatch(closeDay({ countedCents: toCents(counted.trim()), reason: reason.trim() }));
  };

  let body;
  let footer;
  if (shown === "closed") {
    const day = close.closedDay;
    body = (
      <div data-testid="close-day-closed">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          Closed at {formatColomboTime(day.closed_at)} by {day.closed_by?.full_name}.
        </p>
        <CashDayFigures
          figures={day}
          countedText={day.counted_balance}
          differenceCents={toCents(day.difference)}
        />
        {day.difference_reason && (
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
            <span className="text-slate-500 dark:text-slate-400">Reason: </span>
            {day.difference_reason}
          </p>
        )}
      </div>
    );
    footer = <Button ref={doneRef} variant="accent" label="Done" onClick={onDone} />;
  } else if (!summary) {
    body =
      close.summaryStatus === "error" ? (
        <Alert>{cashDayErrorView(close.summaryError).message}</Alert>
      ) : (
        <div role="status" className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
          <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Loading the day&apos;s figures…
        </div>
      );
    footer = (
      <>
        <Button variant="secondary" label="Cancel" onClick={leave} />
        {close.summaryStatus === "error" && (
          <Button
            variant="accent"
            label="Try again"
            onClick={() => dispatch(fetchCloseSummary({ dayId: close.dayId }))}
          />
        )}
      </>
    );
  } else {
    body = (
      <>
        {view && view.field !== "reason" && <Alert>{view.message}</Alert>}
        {items > 0 && shown === "count" && (
          <div
            role="alert"
            data-testid="cart-warning"
            className="mb-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-3 flex items-start gap-2 text-xs text-red-800 dark:text-red-200"
          >
            <AlertCircle size={16} aria-hidden="true" className="shrink-0 mt-0.5" />
            <p>
              There is an unfinished sale with {items} {items === 1 ? "item" : "items"}. Complete or discard it
              before closing the day.
            </p>
          </div>
        )}
        {shown === "count" && (
          <p data-testid="close-day-cleanup-notice" className="mb-4 text-xs text-slate-500 dark:text-slate-400">
            Unfinished sales without a payment, on any till at this branch, are discarded when the day closes.
          </p>
        )}
        <form
          id={FORM_ID}
          onSubmit={toConfirm}
          // Close day sits in the dialog footer, outside this form: browsers
          // differ on Enter submitting through form=…, so Enter in the
          // counted field is handled here (the textarea keeps its newline).
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
            e.preventDefault();
            if (shown === "count") toConfirm();
          }}
          noValidate
          className="flex flex-col gap-4"
        >
          <InputField
            label="Counted cash"
            inputMode="decimal"
            autoComplete="off"
            readOnly={locked}
            error={errors.counted_balance?.message}
            {...register("counted_balance")}
          />
          <CashDayFigures
            figures={summary}
            countedText={countedOk ? counted.trim() : null}
            differenceCents={diff}
          />
          {showReason && (
            <InputField
              label="Reason for the difference"
              type="textarea"
              rows={2}
              maxLength={REASON_MAX}
              readOnly={locked}
              error={reasonError}
              {...register("difference_reason")}
            />
          )}
        </form>
        {/* Not while unconfirmed: the user has already confirmed. */}
        {shown === "confirm" && !unconfirmed && (
          <p className="mt-4 text-sm font-medium text-slate-900 dark:text-slate-100" data-testid="close-day-final">
            No more sales today after closing. This can&apos;t be undone.
          </p>
        )}
      </>
    );
    if (blocked) {
      footer = <Button variant="secondary" label="Done" onClick={leave} />;
    } else if (shown === "count") {
      footer = (
        <>
          <Button variant="secondary" label="Cancel" onClick={leave} />
          <Button
            type="submit"
            form={FORM_ID}
            variant="accent"
            label="Close day"
            disabled={items > 0 || submitting}
          />
        </>
      );
    } else if (unconfirmed) {
      footer = (
        <Button ref={retryRef} variant="danger" label="Try again" loading={submitting} onClick={send} />
      );
    } else {
      footer = (
        <>
          <Button ref={backRef} variant="secondary" label="Back" disabled={submitting} onClick={() => setStage("count")} />
          <Button variant="danger" label="Close day" loading={submitting} onClick={send} />
        </>
      );
    }
  }

  return (
    <Dialog
      open={!!close.dayId && !leaving}
      onClose={onClose}
      title={title}
      size="md"
      hideCloseButton
      dismissible={!submitting && !unconfirmed}
      footer={footer}
      afterLeave={afterLeave}
    >
      {body}
    </Dialog>
  );
};

export default CloseDayDialog;
