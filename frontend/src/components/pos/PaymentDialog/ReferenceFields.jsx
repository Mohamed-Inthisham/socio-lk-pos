import { Hash } from "lucide-react";
import InputField from "../../common/InputField";

/**
 * ReferenceFields Component
 *
 * Reference number for CARD, BANK_TRANSFER, KOKO and MINTPAY — required
 * by the backend for reconciliation (auth code, slip reference or the
 * provider's transaction ID).
 *
 * PROPS:
 * - register: react-hook-form register
 * - error: field error message
 * - disabled
 */

const ReferenceFields = ({ register, error, disabled }) => (
  <InputField
    label="Reference number"
    required
    icon={Hash}
    autoComplete="off"
    spellCheck={false}
    error={error}
    disabled={disabled}
    {...register("reference_number")}
    name="reference_number"
  />
);

export default ReferenceFields;
