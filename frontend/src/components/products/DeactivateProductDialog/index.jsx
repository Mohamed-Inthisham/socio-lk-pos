import { useState } from "react";
import { AlertTriangle, Power } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import {
  deactivateProduct,
  reactivateProduct,
} from "../../../services/productsService";

/**
 * DeactivateProductDialog Component
 *
 * Handles both deactivate and reactivate confirmations. The `action` prop
 * decides which — same modal shape, different copy and colors.
 *
 * WHY ONE COMPONENT FOR BOTH:
 * The dialog is 95% the same for both actions — same shape, same modal,
 * same submitting state, same error handling. The differences (title,
 * description, button copy, button variant, icon, service call) are all
 * derived from `action`. Splitting into two components would mean
 * duplicating the loading/error logic in two places.
 *
 * PROPS:
 * - open: boolean, controls visibility
 * - onClose: () => void, called on cancel/backdrop/escape
 * - onSuccess: () => void, called after successful API call. Parent should
 *   reload the product to reflect the new is_active state.
 * - product: the full product object. Only `id` and `name` are used.
 * - action: 'deactivate' | 'reactivate'
 */

const ACTION_CONFIG = {
  deactivate: {
    title: "Deactivate product",
    description:
      "The product will be hidden from the POS terminal and customer catalog. Historical sales data is preserved. You can reactivate it later.",
    confirmLabel: "Yes, deactivate",
    confirmVariant: "danger",
    icon: AlertTriangle,
    iconTone: "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400",
    serviceCall: deactivateProduct,
    errorFallback: "Couldn't deactivate the product.",
  },
  reactivate: {
    title: "Reactivate product",
    description:
      "The product will become visible in the POS terminal and customer catalog again.",
    confirmLabel: "Yes, reactivate",
    confirmVariant: "accent",
    icon: Power,
    iconTone:
      "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-600 dark:text-cyan-400",
    serviceCall: reactivateProduct,
    errorFallback: "Couldn't reactivate the product.",
  },
};

const DeactivateProductDialog = ({
  open,
  onClose,
  onSuccess,
  product,
  action = "deactivate",
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const config = ACTION_CONFIG[action] || ACTION_CONFIG.deactivate;
  const Icon = config.icon;

  const handleConfirm = async () => {
    if (!product?.id) return;
    setSubmitting(true);
    setError(null);
    try {
      await config.serviceCall(product.id);
      onSuccess();
    } catch (err) {
      setError(
        err.response?.data?.message || err.message || config.errorFallback,
      );
      setSubmitting(false);
    }
    // On success, parent unmounts us (open=false) so no need to setSubmitting(false).
  };

  const handleClose = () => {
    // Reset error when dialog closes so it doesn't linger on next open
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={config.title}
      description={config.description}
      size="sm"
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
            variant={config.confirmVariant}
            onClick={handleConfirm}
            loading={submitting}
            label={config.confirmLabel}
          />
        </>
      }
    >
      <div className="flex items-start gap-4 py-2">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${config.iconTone}`}
        >
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            You're about to {action}{" "}
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {product?.name}
            </span>
            .
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-3">
          <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}
    </Dialog>
  );
};

export default DeactivateProductDialog;
