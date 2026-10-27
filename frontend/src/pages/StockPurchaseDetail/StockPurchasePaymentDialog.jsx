import { useState } from "react";
import Button from "../../components/common/Button";
import Dialog from "../../components/common/Dialog";
import InputField from "../../components/common/InputField";
import Select from "../../components/common/Select";
import { addStockPurchasePayment } from "../../services/stockPurchasesService";

const paymentMethods = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "ONLINE_TRANSFER", label: "Online transfer" },
  { value: "CHEQUE", label: "Cheque" },
];
const currentColomboDate = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Colombo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

export default function StockPurchasePaymentDialog({ open, onClose, purchaseId, maxAmount, onSaved }) {
  const [method, setMethod] = useState("CASH");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(currentColomboDate);
  const [reference, setReference] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [bank, setBank] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const amountNumber = Number(amount);
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(amount) || !Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError("Enter a valid payment amount.");
      return;
    }
    if (amountNumber > maxAmount) {
      setError(`Payment cannot exceed the remaining available amount of LKR ${maxAmount.toFixed(2)}.`);
      return;
    }
    if (!paymentDate) {
      setError("Enter the payment date.");
      return;
    }
    if (method === "CHEQUE" && (!chequeNumber.trim() || !chequeDate || !bank.trim())) {
      setError("Enter the cheque number, cheque date, and bank.");
      return;
    }

    setSaving(true);
    try {
      await addStockPurchasePayment(purchaseId, {
        amount,
        method,
        payment_date: paymentDate,
        ...(reference.trim() && { reference: reference.trim() }),
        ...(method === "CHEQUE" && {
          cheque_number: chequeNumber.trim(),
          cheque_date: chequeDate,
          bank: bank.trim(),
        }),
      });
      await onSaved?.();
      onClose();
    } catch (requestError) {
      const message = requestError.response?.data?.message || requestError.message || "Couldn't record this payment.";
      setError(Array.isArray(message) ? message.join(" ") : message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record supplier payment"
      description="Payments are recorded against this stock purchase. Cheques remain pending until cleared."
      size="lg"
      dismissible={!saving}
      footer={[
        <Button key="cancel" variant="secondary" label="Cancel" onClick={onClose} disabled={saving} />,
        <Button key="submit" type="submit" form="stock-purchase-payment-form" variant="accent" label="Record payment" loading={saving} />,
      ]}
    >
      <form id="stock-purchase-payment-form" onSubmit={submit} noValidate className="space-y-4">
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField label="Amount" required inputMode="decimal" placeholder="e.g. 25000.00" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <Select label="Payment method" required value={method} onChange={(event) => setMethod(event.target.value)} options={paymentMethods} />
          <InputField label="Payment date" type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
          {method !== "CHEQUE" && <InputField label="Payment reference" placeholder="Optional" value={reference} onChange={(event) => setReference(event.target.value)} />}
          {method === "CHEQUE" && <>
            <InputField label="Cheque number" required value={chequeNumber} onChange={(event) => setChequeNumber(event.target.value)} />
            <InputField label="Cheque date" type="date" required value={chequeDate} onChange={(event) => setChequeDate(event.target.value)} />
            <InputField label="Bank" required value={bank} onChange={(event) => setBank(event.target.value)} />
            <p className="sm:col-span-2 text-xs text-amber-700 dark:text-amber-300">The amount stays outstanding until this cheque is cleared.</p>
          </>}
        </div>
      </form>
    </Dialog>
  );
}
