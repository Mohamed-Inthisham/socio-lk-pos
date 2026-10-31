import { useState, useEffect } from "react";
import { Package } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import InputField from "../../common/InputField";
import { updateStock } from "../../../services/stockService";

/**
 * AdjustStockDialog Component
 *
 * Form modal for adjusting a stock row's quantity and min_quantity.
 *
 * IMPORTANT: The backend's PATCH /stock/:id takes ABSOLUTE quantities,
 * not deltas. If admin says "add 5 units," they must enter (current + 5)
 * themselves. The dialog shows current quantity read-only so admins can
 * see what they're starting from.
 *
 * STALE QUANTITY (Phase 1 T1):
 * A changed quantity is sent with expected_quantity, the figure shown as
 * "Currently in stock". If a sale or another change moved the stock
 * meanwhile, the backend refuses with 409 STOCK_QUANTITY_CHANGED and
 * writes nothing; the dialog then shows the new current quantity, keeps
 * what the admin typed, and the next save is checked against the new
 * figure. The parent isn't reloaded until a save succeeds, so the typed
 * value is never reset. An unchanged quantity isn't sent at all, so
 * changing only the minimum can't put back an old quantity.
 *
 * REASON FIELD:
 * Deliberately omitted for R1 — the backend has no audit table to persist
 * the reason. Showing a field that gets silently discarded is dishonest
 * UX. Tracked as a followup: when the backend adds a stock_adjustments
 * audit table, we add the reason field here and a history view on the
 * product detail page.
 *
 * PROPS:
 * - open: boolean
 * - onClose: () => void
 * - onSuccess: () => void, called after successful update. Parent should
 *   reload the stock rows.
 * - stockRow: the full stock object being adjusted. Must include id,
 *   quantity, min_quantity, and branch.name for the display.
 */

const AdjustStockDialog = ({ open, onClose, onSuccess, stockRow }) => {
  const [quantity, setQuantity] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  // The stock as the backend last reported it: the row's quantity when the
  // dialog opened, or current_quantity from a 409.
  const [currentQty, setCurrentQty] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);

  // Reset form whenever the dialog opens (or the underlying row changes).
  // We're syncing form state from an external prop (stockRow) — that's
  // exactly the "external system sync" pattern effects are made for, and
  // one of the rare cases where setState-in-effect is genuinely correct.
  useEffect(() => {
    if (open && stockRow) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuantity(String(stockRow.quantity ?? 0));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMinQuantity(String(stockRow.min_quantity ?? 0));
      setCurrentQty(stockRow.quantity ?? 0);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setErrors({});
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setApiError(null);
    }
  }, [open, stockRow]);

  const validate = () => {
    const next = {};
    const qty = Number(quantity);
    const minQty = Number(minQuantity);

    if (quantity === "" || Number.isNaN(qty)) {
      next.quantity = "Quantity is required";
    } else if (!Number.isInteger(qty)) {
      next.quantity = "Quantity must be a whole number";
    } else if (qty < 0) {
      next.quantity = "Quantity can't be negative";
    }

    if (minQuantity === "" || Number.isNaN(minQty)) {
      next.minQuantity = "Min quantity is required";
    } else if (!Number.isInteger(minQty)) {
      next.minQuantity = "Min quantity must be a whole number";
    } else if (minQty < 0) {
      next.minQuantity = "Min quantity can't be negative";
    }

    return next;
  };

  const handleSubmit = async () => {
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    setApiError(null);

    const qty = Number(quantity);
    try {
      await updateStock(stockRow.id, {
        ...(qty !== currentQty && {
          quantity: qty,
          expected_quantity: currentQty,
        }),
        min_quantity: Number(minQuantity),
      });
      onSuccess();
    } catch (err) {
      const data = err.response?.data;
      if (
        err.response?.status === 409 &&
        data?.code === "STOCK_QUANTITY_CHANGED"
      ) {
        // Keep the typed quantity; check the next save against the new figure.
        setCurrentQty(data.current_quantity);
      }
      setApiError(data?.message || err.message || "Couldn't adjust stock.");
      setSubmitting(false);
    }
    // On success, parent unmounts us via open=false
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  if (!stockRow) return null;

  const newQty = Number(quantity);
  const delta = Number.isFinite(newQty) ? newQty - currentQty : 0;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Adjust stock"
      description={`Update quantity for ${stockRow.branch?.name || "this branch"}.`}
      size="md"
      dismissible={!submitting}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={handleClose}
            disabled={submitting}
            label="Cancel"
          />
          <Button
            variant="accent"
            onClick={handleSubmit}
            loading={submitting}
            label="Save changes"
          />
        </>
      }
    >
      {/* Current quantity, read-only reference */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 mb-4">
        <div className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
          <Package size={16} className="text-slate-500 dark:text-slate-400" />
        </div>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Currently in stock
          </div>
          <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {currentQty}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <InputField
          type="number"
          name="quantity"
          label="New quantity"
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            if (errors.quantity) {
              setErrors((prev) => ({ ...prev, quantity: undefined }));
            }
          }}
          min={0}
          step={1}
          required
          error={errors.quantity}
          hint={
            !errors.quantity && Number.isFinite(newQty) && delta !== 0
              ? delta > 0
                ? `Adding ${delta} unit${delta === 1 ? "" : "s"}`
                : `Removing ${Math.abs(delta)} unit${Math.abs(delta) === 1 ? "" : "s"}`
              : undefined
          }
        />

        <InputField
          type="number"
          name="minQuantity"
          label="Minimum quantity (low-stock threshold)"
          value={minQuantity}
          onChange={(e) => {
            setMinQuantity(e.target.value);
            if (errors.minQuantity) {
              setErrors((prev) => ({ ...prev, minQuantity: undefined }));
            }
          }}
          min={0}
          step={1}
          required
          error={errors.minQuantity}
          hint={
            !errors.minQuantity
              ? "You'll see a low-stock badge when quantity falls to or below this."
              : undefined
          }
        />
      </div>

      {apiError && (
        <div className="mt-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-3">
          <p className="text-xs text-red-700 dark:text-red-300">{apiError}</p>
        </div>
      )}
    </Dialog>
  );
};;;

export default AdjustStockDialog;
