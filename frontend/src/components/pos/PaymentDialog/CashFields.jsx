import { Banknote } from "lucide-react";
import InputField from "../../common/InputField";
import { CASH_SHORT_MESSAGE } from "../../../schemas/paymentSchema";

/**
 * CashFields Component
 *
 * CASH-only part of the PaymentDialog: the physical cash handed over.
 * Must cover the amount (paymentSchema); the excess is change.
 *
 * Presentational: the dialog computes the change (computeChangeCents)
 * from the live form values and passes the result in.
 * - change: formatted change ("LKR 765.50"), or null to hide the line
 *   (cash received blank / invalid, or short)
 * - insufficient: cash received is below the amount — the short-cash
 *   error shows at once, before any submit
 *
 * PROPS:
 * - register: react-hook-form register
 * - error: field error message (from the schema, on submit)
 * - change, insufficient: see above
 * - disabled
 */

const CashFields = ({ register, error, change = null, insufficient = false, disabled }) => (
  <div className="space-y-3">
    <InputField
      label="Cash received"
      required
      icon={Banknote}
      inputMode="decimal"
      autoComplete="off"
      error={error || (insufficient ? CASH_SHORT_MESSAGE : undefined)}
      disabled={disabled}
      {...register("cash_received")}
      name="cash_received"
    />

    {change !== null && (
      <div
        data-testid="cash-change"
        className="flex items-baseline justify-between gap-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3"
      >
        <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
          Change:
        </span>
        <span className="text-2xl font-bold tabular-nums tracking-tight text-emerald-900 dark:text-emerald-100">
          {change}
        </span>
      </div>
    )}
  </div>
);

export default CashFields;
