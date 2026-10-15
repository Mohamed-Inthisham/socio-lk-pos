import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";

/**
 * NewSaleDialog Component
 *
 * Confirms discarding the current draft before a fresh sale is opened
 * (planning doc Q18 a). The caller's `onConfirm` does the discard + create;
 * its rejection is shown inline and the dialog stays open.
 *
 * PROPS:
 * - open, onClose
 * - onConfirm: () => Promise<void>
 * - itemCount: units being thrown away (for the copy)
 * - afterLeave: called once the dialog has fully closed (focus hand-off)
 */

const NewSaleDialog = ({ open, onClose, onConfirm, itemCount = 0, afterLeave }) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleClose = () => {
    if (submitting) return;
    setError(null);
    onClose();
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err?.message || "Couldn't start a new sale");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Start a new sale?"
      size="sm"
      dismissible={!submitting}
      afterLeave={afterLeave}
      footer={
        <>
          <Button
            variant="secondary"
            label="Keep current sale"
            onClick={handleClose}
            disabled={submitting}
          />
          <Button
            variant="danger"
            label="Discard and start new"
            onClick={handleConfirm}
            loading={submitting}
          />
        </>
      }
    >
      <div className="flex gap-3">
        <div className="w-10 h-10 flex-shrink-0 rounded-xl flex items-center justify-center bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          <AlertTriangle size={20} aria-hidden="true" />
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          The current sale
          {itemCount > 0
            ? ` and its ${itemCount} ${itemCount === 1 ? "item" : "items"}`
            : ""}{" "}
          will be discarded. This can&apos;t be undone.
        </p>
      </div>
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}
    </Dialog>
  );
};

export default NewSaleDialog;
