import { useState } from "react";
import { AlertTriangle, Power } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import {
  deactivateCategory,
  reactivateCategory,
} from "../../../services/categoriesService";

/**
 * DeactivateCategoryDialog Component
 *
 * Handles both deactivate and reactivate confirmations. The `action` prop
 * decides which — same modal shape, different copy and colors.
 *
 * Sibling of DeactivateProductDialog and DeactivateBrandDialog. Same
 * pattern, same reasoning: one component for both actions since 95% of
 * the dialog is identical.
 *
 * WHY WE HAVEN'T EXTRACTED TO ConfirmDialog YET:
 * This is now the third concrete example (Product + Brand + Category).
 * That's enough triangulation to justify extraction — flagging as a
 * followup for when Path B wraps. Doing it now would inflate this commit;
 * doing it as a dedicated refactor commit is cleaner.
 *
 * CATEGORY-SPECIFIC MESSAGING:
 * Two things worth surfacing in the deactivate copy:
 * 1. Deactivation does NOT cascade to sub-categories (locked Phase 6.1
 *    decision). Sub-categories keep this as their parent.
 * 2. Products keep their category attribution — nothing breaks.
 * The copy is deliberately blunt to preempt admin panic.
 *
 * PROPS:
 * - open: boolean, controls visibility
 * - onClose: () => void, called on cancel/backdrop/escape
 * - onSuccess: () => void, called after successful API call. Parent should
 *   refetch the categories list to reflect the new is_active state.
 * - category: the full category object. Only `id` and `name` are used.
 * - action: 'deactivate' | 'reactivate'
 */

const ACTION_CONFIG = {
  deactivate: {
    title: "Deactivate category",
    description:
      "The category will be hidden from selection when creating new products. Existing products and sub-categories keep this attribution — nothing cascades. You can reactivate it later.",
    confirmLabel: "Yes, deactivate",
    confirmVariant: "danger",
    icon: AlertTriangle,
    iconTone: "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400",
    serviceCall: deactivateCategory,
    errorFallback: "Couldn't deactivate the category.",
  },
  reactivate: {
    title: "Reactivate category",
    description:
      "The category will become selectable when creating new products again.",
    confirmLabel: "Yes, reactivate",
    confirmVariant: "accent",
    icon: Power,
    iconTone:
      "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-600 dark:text-cyan-400",
    serviceCall: reactivateCategory,
    errorFallback: "Couldn't reactivate the category.",
  },
};

const DeactivateCategoryDialog = ({
  open,
  onClose,
  onSuccess,
  category,
  action = "deactivate",
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const config = ACTION_CONFIG[action] || ACTION_CONFIG.deactivate;
  const Icon = config.icon;

  const handleConfirm = async () => {
    if (!category?.id) return;
    setSubmitting(true);
    setError(null);
    try {
      await config.serviceCall(category.id);
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
              {category?.name}
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

export default DeactivateCategoryDialog;
