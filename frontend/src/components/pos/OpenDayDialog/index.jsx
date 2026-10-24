import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Sunrise } from "lucide-react";
import Button from "../../common/Button";
import InputField from "../../common/InputField";
import TerminalPanel from "../TerminalPanel";
import { openDaySchema } from "../../../schemas/openDaySchema";
import {
  beginOpenDay,
  clearOpenError,
  openDay,
  selectOpenDay,
} from "../../../store/slices/cashDaySlice";
import { CASH_DAY_ERROR, cashDayErrorView } from "../../../utils/cashDayErrors";
import { lastClosedLine } from "../../../utils/cashDayLabels";
import { formatColomboDayLabel } from "../../../utils/colomboDay";
import { toCents } from "../../../utils/money";

/**
 * OpenDayDialog Component
 *
 * The day gate's opening form (planning doc P9-7, P9-8): the cash in the
 * box at opening, typed as whole rupees or with cents (0 allowed), blank
 * to start so the cashier counts. The line under the title is the last
 * closed day's counted cash ("Yesterday closed with LKR 15,400.00"), for
 * information only.
 *
 * NOT A MODAL: it replaces the terminal page inside <main>, so the header
 * (Sales, theme, user menu with logout, Exit) stays usable. It is
 * role="dialog" aria-modal="false", so the terminal's hotkeys (which
 * ignore keys while any [role="dialog"] is open) stay quiet. It can't be
 * dismissed: no close button, and Escape does nothing.
 *
 * REQUEST ID (P9-18): beginOpenDay makes one when the dialog mounts; every
 * attempt from it resends that id.
 *
 * LOST ANSWER: after a timeout, network error or 5xx the slice re-reads
 * the server. If the day still isn't open the amount turns read-only and
 * only Try again is offered, so the resend carries the same amount.
 *
 * Errors come from utils/cashDayErrors.js: C1 under the field, the rest
 * in the alert. The ones that re-read current (DAY_ALREADY_OPEN,
 * EARLIER_DAY_NOT_CLOSED) move the gate on by themselves.
 */

const TITLE_ID = "open-day-title";

const OpenDayDialog = ({ branchId, branchName, businessDate, lastClosed }) => {
  const dispatch = useDispatch();
  const open = useSelector(selectOpenDay);
  const submitting = open.status === "submitting";
  const locked = !!open.error?.reconcile;
  const view = open.error ? cashDayErrorView(open.error) : null;
  const invalid = open.error?.kind === CASH_DAY_ERROR.INVALID;
  const line = lastClosedLine(lastClosed, businessDate);

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(openDaySchema),
    defaultValues: { opening_balance: "" },
  });

  useEffect(() => {
    dispatch(beginOpenDay());
    setFocus("opening_balance");
  }, [dispatch, setFocus]);

  const onSubmit = ({ opening_balance }) =>
    dispatch(openDay({ branchId, openingCents: toCents(opening_balance) }));

  const subtitle = [businessDate && formatColomboDayLabel(businessDate), branchName].filter(Boolean).join(" · ");

  return (
    <TerminalPanel
      icon={Sunrise}
      title="Open the day"
      titleId={TITLE_ID}
      role="dialog"
      aria-modal="false"
      aria-labelledby={TITLE_ID}
    >
      {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      {line && (
        <p data-testid="last-closed" className="mt-3 text-sm text-slate-700 dark:text-slate-300">
          {line}
        </p>
      )}

      {view && !invalid && (
        <div
          role="alert"
          className="mt-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-3 flex items-start gap-2"
        >
          <AlertCircle size={16} aria-hidden="true" className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 dark:text-red-300">{view.message}</p>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 flex flex-col gap-4">
        <InputField
          label="Cash in the box"
          inputMode="decimal"
          autoComplete="off"
          hint="Count the cash before the first sale."
          readOnly={locked || submitting}
          error={errors.opening_balance?.message || (invalid ? view.message : undefined)}
          {...register("opening_balance", {
            onChange: () => {
              if (open.error && !locked) dispatch(clearOpenError());
            },
          })}
        />
        <Button
          type="submit"
          variant="accent"
          fullWidth
          loading={submitting}
          label={submitting ? "Opening…" : locked ? "Try again" : "Open day"}
        />
      </form>
    </TerminalPanel>
  );
};

export default OpenDayDialog;
