import { useId } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AlertCircle, Loader2, UserPlus, UserRound, X } from "lucide-react";
import Button from "../../common/Button";
import Tooltip from "../../common/Tooltip";
import { formatSlPhone } from "../../../utils/phone";
import {
  clearCustomerError,
  detachCustomer,
  selectAttachedCustomer,
  selectCustomerError,
  selectCustomerSaving,
  selectHasTradeInPayment,
} from "../../../store/slices/posTerminalSlice";

/**
 * CustomerCard Component
 *
 * The draft's customer, in the terminal's right column under "Current
 * sale".
 *
 * - No customer: muted "Walk-in sale" + "Attach customer", with an "F3"
 *   key chip on fine-pointer devices (same chip as the scan bar's F2).
 * - Customer: name, phone (077 123 4567), NIC when present, with
 *   "Change" (reopens the attach dialog) and "Detach" (PATCH
 *   customer_id: null, optimistic).
 *
 * TRADE_IN guard (Q19): a trade-in payment needs the customer, so Detach
 * is blocked while one exists. It uses aria-disabled rather than
 * `disabled` so it still takes hover/focus and can explain itself in a
 * tooltip. The slice refuses the detach too.
 *
 * A failed attach/detach has already been rolled back by the slice; the
 * error shows here until dismissed or the next customer change.
 *
 * PROPS:
 * - onAttach: open the CustomerAttachDialog (attach or change)
 * - disabled: the draft isn't ready (loading / gone)
 */

export const TRADE_IN_DETACH_HINT = "Remove TRADE_IN payment first";

const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

const CustomerCard = ({ onAttach, disabled = false }) => {
  const dispatch = useDispatch();
  const customer = useSelector(selectAttachedCustomer);
  const saving = useSelector(selectCustomerSaving);
  const error = useSelector(selectCustomerError);
  const hasTradeIn = useSelector(selectHasTradeInPayment);

  const hintId = useId();

  const detachBlocked = hasTradeIn || saving || disabled;

  return (
    <section
      aria-label="Customer"
      aria-busy={saving}
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Customer
        </h2>
        {saving && (
          <span className="inline-flex items-center gap-1.5 text-xs text-cyan-700 dark:text-cyan-400">
            <Loader2 size={12} aria-hidden="true" className="animate-spin" />
            Saving…
          </span>
        )}
      </div>

      {customer ? (
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center text-sm font-semibold bg-cyan-50 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300"
          >
            {initials(customer.name) || <UserRound size={18} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate" data-testid="customer-name">
              {customer.name ?? "Customer"}
            </p>
            {customer.phone && (
              <p className="text-sm tabular-nums text-slate-600 dark:text-slate-300" data-testid="customer-phone">
                {formatSlPhone(customer.phone)}
              </p>
            )}
            {customer.nic && (
              <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400" data-testid="customer-nic">
                NIC {customer.nic}
              </p>
            )}
          </div>
          <div className="flex flex-shrink-0 gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              label="Change"
              onClick={onAttach}
              disabled={saving || disabled}
            />
            <Tooltip content={hasTradeIn ? TRADE_IN_DETACH_HINT : null} side="bottom" delay={150}>
              <Button
                size="sm"
                variant="ghost"
                label="Detach"
                aria-disabled={detachBlocked || undefined}
                aria-describedby={hasTradeIn ? hintId : undefined}
                onClick={() => {
                  if (!detachBlocked) dispatch(detachCustomer());
                }}
                className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
              />
            </Tooltip>
            {hasTradeIn && (
              <span id={hintId} className="sr-only">{TRADE_IN_DETACH_HINT}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
          >
            <UserRound size={18} />
          </div>
          <p className="flex-1 text-sm text-slate-500 dark:text-slate-400">Walk-in sale</p>
          <kbd
            aria-hidden="true"
            className="
              hidden [@media(hover:hover)_and_(pointer:fine)]:inline-flex
              items-center px-1.5 h-6 rounded-md
              text-[11px] font-semibold font-sans text-slate-500 dark:text-slate-400
              border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800
            "
          >
            F3
          </kbd>
          <Button
            size="sm"
            variant="secondary"
            icon={UserPlus}
            label="Attach customer"
            aria-keyshortcuts="F3"
            onClick={onAttach}
            disabled={saving || disabled}
          />
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          <AlertCircle size={16} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{error.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dispatch(clearCustomerError())}
            className="flex-shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
};

export default CustomerCard;
