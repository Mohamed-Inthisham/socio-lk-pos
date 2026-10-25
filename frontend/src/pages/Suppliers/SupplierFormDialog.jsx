import { useEffect, useState } from "react";
import Button from "../../components/common/Button";
import Dialog from "../../components/common/Dialog";
import InputField from "../../components/common/InputField";
import { createSupplier, updateSupplier } from "../../services/suppliersService";

const empty = { name: "", contact_person: "", phone: "", email: "", address: "", notes: "" };

export default function SupplierFormDialog({ open, supplier, onClose, onSaved }) {
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValues(supplier ? {
      name: supplier.name ?? "", contact_person: supplier.contact_person ?? "",
      phone: supplier.phone ?? "", email: supplier.email ?? "",
      address: supplier.address ?? "", notes: supplier.notes ?? "",
    } : empty);
    setErrors({});
    setSubmitError("");
  }, [supplier, open]);

  const setField = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setSubmitError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    const name = values.name.trim();
    const phone = values.phone.trim();
    const email = values.email.trim();
    if (!name) nextErrors.name = "Name is required.";
    else if (name.length > 150) nextErrors.name = "Name must be 150 characters or fewer.";
    if (phone && !/^0\d{9}$/.test(phone)) nextErrors.phone = "Enter a Sri Lankan phone number (0XXXXXXXXX).";
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255)) nextErrors.email = "Enter a valid email address.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const payload = Object.fromEntries(Object.entries({
      name, contact_person: values.contact_person.trim() || null,
      phone: phone || null, email: email.toLowerCase() || null,
      address: values.address.trim() || null, notes: values.notes.trim() || null,
    }));
    setSaving(true);
    setSubmitError("");
    try {
      const saved = supplier
        ? await updateSupplier(supplier.id, payload)
        : await createSupplier(payload);
      onSaved?.(saved);
      onClose();
    } catch (error) {
      const message = error.response?.data?.message ?? error.message ?? "Could not save this supplier.";
      setSubmitError(Array.isArray(message) ? message.join(" ") : message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={supplier ? "Edit supplier" : "Add supplier"}
      description="Supplier contact details and internal notes." size="md" dismissible={!saving}
      footer={<><Button variant="secondary" label="Cancel" onClick={onClose} disabled={saving} /><Button variant="accent" label={supplier ? "Save changes" : "Add supplier"} type="submit" form="supplier-form" loading={saving} /></>}>
      <form id="supplier-form" onSubmit={submit} noValidate className="space-y-4">
        {submitError && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{submitError}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField label="Supplier name" name="supplier-name" value={values.name} onChange={setField("name")} error={errors.name} required maxLength={150} />
          <InputField label="Contact person" name="supplier-contact" value={values.contact_person} onChange={setField("contact_person")} maxLength={100} />
          <InputField label="Phone" name="supplier-phone" type="tel" value={values.phone} onChange={setField("phone")} error={errors.phone} hint="Optional · 0XXXXXXXXX" />
          <InputField label="Email" name="supplier-email" type="email" value={values.email} onChange={setField("email")} error={errors.email} maxLength={255} />
        </div>
        <InputField label="Address" name="supplier-address" type="textarea" rows={2} value={values.address} onChange={setField("address")} />
        <InputField label="Notes" name="supplier-notes" type="textarea" rows={3} value={values.notes} onChange={setField("notes")} />
      </form>
    </Dialog>
  );
}
