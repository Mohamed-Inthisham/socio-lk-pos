import { useState } from "react";
import { useDispatch } from "react-redux";
import { AlertCircle, ArrowLeft, UserRound } from "lucide-react";
import Button from "../../common/Button";
import InputField from "../../common/InputField";
import { normalizeSlPhone, formatSlPhone } from "../../../utils/phone";
import {
  attachCustomer,
  clearCustomerError,
  createAndAttachCustomer,
} from "../../../store/slices/posTerminalSlice";

/**
 * CustomerCreateForm Component
 *
 * Inline "new customer" form inside CustomerAttachDialog. Submitting
 * creates the customer and attaches it to the draft (createAndAttachCustomer).
 *
 * Validation mirrors CreateCustomerDto: name 1–200, phone must normalize
 * to a Sri Lankan number, NIC optional (5–20 when given).
 *
 * Failure paths keep the form open:
 * - NIC already on file (409): shows who has it, with "Use existing
 *   customer" to attach that record instead.
 * - Customer saved but the attach failed: the submit button retries the
 *   attach only, so a second customer is never created.
 *
 * Errors are shown here, so they're cleared from the slice and don't also
 * appear on the CustomerCard.
 *
 * PROPS:
 * - initialValues: { name, phone } prefilled from the search query
 * - onBack: return to search
 * - onDone: close the dialog (customer attached)
 * - onBusyChange: (busy) => void — the dialog can't be dismissed mid-request
 */

const validate = ({ name, phone, nic }) => {
  const errors = {};
  if (!name.trim()) errors.name = "Name is required.";
  else if (name.trim().length > 200) errors.name = "Name must be 200 characters or fewer.";
  if (!phone.trim()) errors.phone = "Phone is required.";
  else if (!normalizeSlPhone(phone)) errors.phone = "Enter a Sri Lankan number, e.g. 0771234567 or +94771234567.";
  const nicValue = nic.trim();
  if (nicValue && (nicValue.length < 5 || nicValue.length > 20)) {
    errors.nic = "NIC must be 5–20 characters.";
  }
  return errors;
};

const CustomerCreateForm = ({ initialValues, onBack, onDone, onBusyChange }) => {
  const dispatch = useDispatch();
  const [values, setValues] = useState({ name: "", phone: "", nic: "", ...initialValues });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  // Created by an earlier submit whose attach failed — retry attaches it.
  const [created, setCreated] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const run = async (thunk) => {
    setSubmitting(true);
    onBusyChange?.(true);
    try {
      await dispatch(thunk).unwrap();
      onDone();
      return null;
    } catch (err) {
      dispatch(clearCustomerError());
      return err;
    } finally {
      setSubmitting(false);
      onBusyChange?.(false);
    }
  };

  const setField = (field) => (event) => {
    setValues((v) => ({ ...v, [field]: event.target.value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
    if (field === "nic") setConflict(null);
    setSubmitError(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (created) {
      const err = await run(attachCustomer({ customer: created }));
      if (err) setSubmitError(`${created.name} was saved, but couldn't be attached: ${err.message}`);
      return;
    }
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length) return;

    setSubmitError(null);
    setConflict(null);
    const err = await run(
      createAndAttachCustomer({
        name: values.name.trim(),
        phone: normalizeSlPhone(values.phone),
        nic: values.nic.trim() || null,
      }),
    );
    if (!err) return;
    if (err.stage === "attach") {
      setCreated(err.customer);
      setSubmitError(`${err.customer.name} was saved, but couldn't be attached: ${err.message}`);
    } else if (err.status === 409 && err.existing_customer_id) {
      setConflict(err);
    } else {
      setSubmitError(err.message);
    }
  };

  const attachExisting = async () => {
    const customer = conflict.existing_customer ?? { id: conflict.existing_customer_id };
    const err = await run(attachCustomer({ customer }));
    if (err) setSubmitError(err.message);
  };

  const existing = conflict?.existing_customer;

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="New customer">
      <div className="space-y-4">
        <InputField
          label="Name"
          name="customer-name"
          required
          value={values.name}
          onChange={setField("name")}
          error={errors.name}
          disabled={submitting || !!created}
          autoComplete="off"
          autoFocus
        />
        <InputField
          label="Phone"
          name="customer-phone"
          type="tel"
          required
          value={values.phone}
          onChange={setField("phone")}
          error={errors.phone}
          hint="0771234567 or +94771234567"
          disabled={submitting || !!created}
          autoComplete="off"
          inputMode="tel"
        />
        <InputField
          label="NIC"
          name="customer-nic"
          value={values.nic}
          onChange={setField("nic")}
          error={errors.nic}
          hint="Optional"
          disabled={submitting || !!created}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {conflict && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200"
        >
          <p className="flex items-start gap-2">
            <AlertCircle size={16} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
            <span>
              This NIC is already on file
              {existing ? (
                <>
                  {" "}for <strong className="font-semibold">{existing.name}</strong>
                  {" · "}
                  <span className="tabular-nums">{formatSlPhone(existing.phone)}</span>
                </>
              ) : null}
              .
            </span>
          </p>
          <div className="mt-2.5 flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              icon={UserRound}
              label="Use existing customer"
              onClick={attachExisting}
              disabled={submitting}
            />
          </div>
        </div>
      )}

      {submitError && (
        <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle size={16} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
          {submitError}
        </p>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          icon={ArrowLeft}
          label="Back to search"
          onClick={onBack}
          disabled={submitting || !!created}
        />
        <Button
          type="submit"
          variant="accent"
          label={created ? "Retry attach" : "Save and attach"}
          loading={submitting}
        />
      </div>
    </form>
  );
};

export default CustomerCreateForm;
