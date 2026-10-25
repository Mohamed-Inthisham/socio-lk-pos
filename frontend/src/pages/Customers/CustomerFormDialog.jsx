import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/common/Button";
import Dialog from "../../components/common/Dialog";
import InputField from "../../components/common/InputField";
import { createCustomer, updateCustomer } from "../../services/customersService";
import { normalizeSlPhone } from "../../utils/phone";

const empty = { name: "", phone: "", nic: "", email: "", notes: "" };

export default function CustomerFormDialog({ open, customer, onClose, onSaved }) {
  const navigate = useNavigate();
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValues(customer ? {
      name: customer.name ?? "", phone: customer.phone ?? "", nic: customer.nic ?? "",
      email: customer.email ?? "", notes: customer.notes ?? "",
    } : empty);
    setErrors({});
    setSubmitError("");
  }, [customer, open]);

  const setField = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setSubmitError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!values.name.trim()) nextErrors.name = "Name is required.";
    if (!normalizeSlPhone(values.phone)) nextErrors.phone = "Enter a valid Sri Lankan phone number.";
    if (values.nic.trim() && (values.nic.trim().length < 5 || values.nic.trim().length > 20)) nextErrors.nic = "NIC must be 5–20 characters.";
    if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) nextErrors.email = "Enter a valid email address.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    setSubmitError("");
    const payload = {
      name: values.name.trim(),
      phone: normalizeSlPhone(values.phone),
      nic: values.nic.trim() || null,
      email: values.email.trim().toLowerCase() || null,
      ...(customer ? { notes: values.notes.trim() || null } : {}),
    };
    try {
      const saved = customer
        ? await updateCustomer(customer.id, payload)
        : await createCustomer(payload);
      onSaved?.(saved);
      onClose();
      if (!customer) navigate(`/customers/${saved.id}`);
    } catch (error) {
      const response = error.response?.data;
      setSubmitError(response?.message ?? error.message ?? "Couldn’t save this customer.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={customer ? "Edit customer" : "Add customer"}
      description="Customer details are kept with their sales history." size="md" dismissible={!saving}
      footer={<><Button variant="secondary" label="Cancel" onClick={onClose} disabled={saving} /><Button variant="accent" label={customer ? "Save changes" : "Add customer"} type="submit" form="customer-form" loading={saving} /></>}>
      <form id="customer-form" onSubmit={submit} noValidate className="space-y-4">
        {submitError && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{Array.isArray(submitError) ? submitError.join(" ") : submitError}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField label="Name" name="customer-name" value={values.name} onChange={setField("name")} error={errors.name} required maxLength={200} autoComplete="name" />
          <InputField label="Phone" name="customer-phone" type="tel" value={values.phone} onChange={setField("phone")} error={errors.phone} required hint="0771234567 or +94771234567" autoComplete="tel" />
          <InputField label="NIC" name="customer-nic" value={values.nic} onChange={setField("nic")} error={errors.nic} hint="Optional" />
          <InputField label="Email" name="customer-email" type="email" value={values.email} onChange={setField("email")} error={errors.email} hint="Optional" autoComplete="email" />
        </div>
        {customer && <InputField label="Notes" name="customer-notes" type="textarea" rows={3} value={values.notes} onChange={setField("notes")} />}
      </form>
    </Dialog>
  );
}
