import { Banknote } from "lucide-react";
import InputField from "../../common/InputField";

/**
 * CashFields Component
 *
 * CASH-only part of the PaymentDialog: the physical cash handed over.
 * Must cover the amount (paymentSchema); the excess is change.
 *
 * PROPS:
 * - register: react-hook-form register
 * - error: field error message
 * - disabled
 */

const CashFields = ({ register, error, disabled }) => (
  <InputField
    label="Cash received"
    required
    icon={Banknote}
    inputMode="decimal"
    autoComplete="off"
    error={error}
    disabled={disabled}
    {...register("cash_received")}
    name="cash_received"
  />
);

export default CashFields;
