import { Hash } from "lucide-react";
import InputField from "../../common/InputField";

/**
 * ReferenceFields Component
 *
 * Reference number for CARD, BANK_TRANSFER, KOKO and MINTPAY — required
 * by the backend for reconciliation (auth code, slip reference or the
 * provider's transaction ID).
 *
 * The label stays "Reference number" for every method; `hint` names the
 * method's own reference (methods.js referenceHint).
 *
 * PROPS:
 * - register: react-hook-form register
 * - error: field error message
 * - hint: which reference to enter for the selected method
 * - disabled
 */

const ReferenceFields = ({ register, error, hint, disabled }) => (
  <InputField
    label="Reference number"
    required
    icon={Hash}
    autoComplete="off"
    spellCheck={false}
    error={error}
    hint={hint}
    disabled={disabled}
    {...register("reference_number")}
    name="reference_number"
  />
);

export default ReferenceFields;
