import { useEffect, useRef, useState } from "react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import InputField from "../../common/InputField";
import { writeOffStock } from "../../../services/stockService";
import { writeOffProductUnit } from "../../../services/productUnitsService";

const REASONS = [
  { value: "DAMAGED", label: "Damaged" },
  { value: "LOST", label: "Lost" },
  { value: "STOLEN", label: "Stolen" },
  { value: "EXPIRED", label: "Expired" },
  { value: "OBSOLETE", label: "Obsolete" },
  { value: "OTHER", label: "Other" },
];

export default function WriteOffDialog({
  open,
  onClose,
  onSuccess,
  stockRow,
  unit,
  product,
}) {
  const isUnit = Boolean(unit);
  const [quantity, setQuantity] = useState("1");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    // Reset form when a new write-off target is opened.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuantity("1");
    setReasonCode("");
    setNote("");
    setConfirmed(false);
    setError("");
    setSubmitting(false);
    submittingRef.current = false;
  }, [open, stockRow, unit]);

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    const qty = Number(quantity);
    if (!reasonCode) return setError("Select a write-off reason.");
    if (reasonCode === "OTHER" && !note.trim())
      return setError("Explain the Other reason in the note.");
    if (
      !isUnit &&
      (!Number.isInteger(qty) || qty < 1 || qty > Number(stockRow.quantity))
    ) {
      return setError(
        "Enter a whole quantity between 1 and the available stock.",
      );
    }
    if (!confirmed)
      return setError("Confirm that this is a permanent stock removal.");
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (isUnit)
        await writeOffProductUnit(unit.id, {
          reasonCode,
          ...(note.trim() && { note: note.trim() }),
        });
      else
        await writeOffStock(stockRow.id, {
          quantity: qty,
          expected_quantity: Number(stockRow.quantity),
          reasonCode,
          ...(note.trim() && { note: note.trim() }),
        });
      onSuccess();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Could not write off this stock. Refresh and try again.",
      );
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (!stockRow && !unit) return null;
  const title = "Write off stock";
  const description = isUnit
    ? `${product?.name || unit.product?.name || "Product"} · ${unit.unit_code || unit.imei || unit.serial_number || "Identified unit"} · ${unit.branch?.name || "Branch"} · ${unit.status}`
    : `${product?.name || "Product"} · ${stockRow.branch?.name || "Branch"} · ${stockRow.quantity} available`;

  return (
    <Dialog
      open={open}
      onClose={() => !submitting && onClose()}
      title={title}
      description={description}
      dismissible={!submitting}
      footer={
        <>
          <Button
            variant="secondary"
            label="Cancel"
            onClick={onClose}
            disabled={submitting}
          />
          <Button
            variant="danger"
            label="Confirm write-off"
            onClick={handleSubmit}
            loading={submitting}
            disabled={!confirmed || submitting}
          />
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          This permanently removes stock from availability. A written-off unit
          cannot be sold or restored through this workflow.
        </p>
        {!isUnit && (
          <InputField
            type="number"
            name="quantity"
            label="Quantity to write off"
            min={1}
            max={stockRow.quantity}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        )}
        <InputField
          type="select"
          name="reason"
          label="Reason"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          options={REASONS}
          placeholder="Choose a reason"
          required
        />
        <InputField
          type="textarea"
          name="note"
          label={
            reasonCode === "OTHER"
              ? "Explanation (required)"
              : "Note (optional)"
          }
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          maxLength={500}
          rows={3}
          placeholder="Add context for this write-off"
        />
        <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1"
          />
          <span>I confirm this stock is being permanently written off.</span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-300">
            {Array.isArray(error) ? error.join(" ") : error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
