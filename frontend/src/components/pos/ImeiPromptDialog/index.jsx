import { useState } from "react";
import { Smartphone } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";

/**
 * ImeiPromptDialog Component
 *
 * Serialized products (phones) need the specific unit's IMEI before the
 * line can be added (planning doc Q9: scan the product label first, then
 * the IMEI). The cashier scans the phone's IMEI sticker or types it; Enter
 * submits.
 *
 * Server errors stay inline and keep the dialog open:
 * - 400: IMEI not found / belongs to a different product
 * - 409: unit isn't IN_STOCK (sold, reserved in another draft...) —
 *   `existing_unit.status` is shown when the server sends it; a returned
 *   phone waiting for its check (INSPECTION, P7-6) gets its own words
 *
 * PROPS:
 * - product: the serialized catalog product, or null when closed
 * - onClose
 * - onSubmit: (imei) => Promise — rejects with { message, existing_unit? }
 */

// Mirrors the backend's IMEI rule (letters/digits, 8–50 chars).
const IMEI_PATTERN = /^[A-Za-z0-9]{8,50}$/;

const INSPECTION_MESSAGE =
  "This phone was returned and is waiting to be checked. It can't be sold until a manager passes it.";

const describeError = (err) => {
  const status = err?.existing_unit?.status;
  if (status === "INSPECTION") return INSPECTION_MESSAGE;
  const message = err?.message || "Couldn't add the phone";
  return status ? `${message} (unit status: ${status})` : message;
};

const ImeiPromptDialog = ({ product, onClose, onSubmit }) => {
  const [imei, setImei] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setImei("");
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const value = imei.trim();
    if (!IMEI_PATTERN.test(value)) {
      setError("Enter the IMEI: 8–50 letters or digits.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(value);
      reset();
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={!!product}
      onClose={handleClose}
      title="Scan the IMEI"
      description={product?.name}
      size="sm"
      dismissible={!submitting}
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="flex items-center gap-3 mb-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">
          <Smartphone size={18} aria-hidden="true" className="flex-shrink-0 text-cyan-600 dark:text-cyan-400" />
          Scan the IMEI sticker on the phone or its box, or type it.
        </div>
        <label
          htmlFor="imei-input"
          className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5"
        >
          IMEI
        </label>
        <input
          id="imei-input"
          data-autofocus
          value={imei}
          onChange={(e) => {
            setImei(e.target.value);
            if (error) setError(null);
          }}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={error ? "imei-error" : undefined}
          className="
            w-full h-12 px-3 rounded-lg text-base font-mono tracking-wider tabular-nums
            bg-white dark:bg-slate-950
            border border-slate-300 dark:border-slate-700
            text-slate-900 dark:text-slate-100
            focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500
          "
        />
        {error && (
          <p id="imei-error" role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" label="Cancel" onClick={handleClose} disabled={submitting} />
          <Button type="submit" variant="accent" label="Add to sale" loading={submitting} />
        </div>
      </form>
    </Dialog>
  );
};

export default ImeiPromptDialog;
