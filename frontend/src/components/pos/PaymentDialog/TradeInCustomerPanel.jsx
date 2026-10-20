import { useState } from "react";
import { useDispatch } from "react-redux";
import { IdCard, UserPlus } from "lucide-react";
import Button from "../../common/Button";
import InputField from "../../common/InputField";
import { saveCustomerNic } from "../../../store/slices/posTerminalSlice";
import {
  NIC_CONFLICT_MESSAGE,
  NIC_LENGTH_MESSAGE,
  TRADE_IN_NEEDS_CUSTOMER,
  TRADE_IN_NEEDS_NIC,
} from "./tradeIn";

/**
 * TradeInCustomerPanel Component
 *
 * Shown in the PaymentDialog in place of the trade-in fields while the
 * sale can't take a trade-in yet:
 *
 * - No customer (P4-2): "Trade-in needs a customer" + Attach customer.
 *   The dialog closes, the CustomerAttachDialog opens, and the
 *   PaymentDialog comes back on Trade-in once a customer is attached
 *   (the terminal runs that sequence: onAttachCustomer).
 * - A customer without an NIC (P4-13): "Trade-in needs the customer's
 *   NIC" with an NIC field. Save NIC (or Enter) PATCHes the customer
 *   (saveCustomerNic); the trade-in fields replace the panel once the
 *   customer has one. 5–20 characters, as CreateCustomerDto. A clash
 *   with another customer's NIC (409) shows inline.
 *
 * PROPS:
 * - customer: the attached customer, or null
 * - onAttachCustomer: start the attach-then-return sequence
 * - onNicSaved: the NIC was saved (the dialog moves focus to Product)
 * - actionRef: the panel's primary control (Attach customer, or the NIC
 *   field), so the dialog can focus it
 * - disabled
 */

const Panel = ({ icon: Icon, title, children }) => (
  <section
    aria-label={title}
    className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3.5"
  >
    <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
      <Icon size={16} aria-hidden="true" />
      {title}
    </h3>
    {children}
  </section>
);

const NicForm = ({ customer, actionRef, onSaved, disabled }) => {
  const dispatch = useDispatch();
  const [nic, setNic] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const value = nic.trim();
    if (value.length < 5 || value.length > 20) {
      setError(NIC_LENGTH_MESSAGE);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await dispatch(saveCustomerNic({ nic: value })).unwrap();
      onSaved?.();
    } catch (err) {
      setError(err?.status === 409 ? NIC_CONFLICT_MESSAGE : err?.message || "Couldn't save the NIC");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Enter") return;
    // Saves the NIC; the payment dialog skips Enters already handled.
    event.preventDefault();
    if (!saving) save();
  };

  return (
    <>
      <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
        {customer.name} has no NIC on file. Add it to take the phone.
      </p>
      <div className="mt-3 flex items-start gap-2">
        <InputField
          ref={actionRef}
          label="Customer NIC"
          name="trade-in-customer-nic"
          required
          value={nic}
          onChange={(event) => {
            setNic(event.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          error={error ?? undefined}
          disabled={disabled || saving}
          autoComplete="off"
          spellCheck={false}
          className="flex-1"
        />
        <Button
          label="Save NIC"
          variant="secondary"
          onClick={save}
          loading={saving}
          disabled={disabled}
          className="mt-5.5 h-11"
        />
      </div>
    </>
  );
};

const TradeInCustomerPanel = ({ customer, onAttachCustomer, onNicSaved, actionRef, disabled }) => {
  if (!customer) {
    return (
      <Panel icon={UserPlus} title={TRADE_IN_NEEDS_CUSTOMER}>
        <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
          The phone is recorded against the customer who hands it over.
        </p>
        <div className="mt-3 flex justify-end">
          <Button
            ref={actionRef}
            icon={UserPlus}
            label="Attach customer"
            variant="secondary"
            onClick={onAttachCustomer}
            disabled={disabled}
          />
        </div>
      </Panel>
    );
  }
  return (
    <Panel icon={IdCard} title={TRADE_IN_NEEDS_NIC}>
      {/* Keyed by customer: a different customer starts a fresh form */}
      <NicForm
        key={customer.id}
        customer={customer}
        actionRef={actionRef}
        onSaved={onNicSaved}
        disabled={disabled}
      />
    </Panel>
  );
};

export default TradeInCustomerPanel;
