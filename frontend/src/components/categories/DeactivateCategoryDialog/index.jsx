import ConfirmDialog from "../../common/ConfirmDialog";
import {
  deactivateCategory,
  reactivateCategory,
} from "../../../services/categoriesService";

/**
 * DeactivateCategoryDialog Component
 *
 * Thin adapter over ConfirmDialog. Owns the two things that are genuinely
 * category-specific: the service calls and the cascade-safety copy on
 * deactivation. Everything else — submitting state, error handling,
 * reset-on-close, dialog shape — lives in ConfirmDialog.
 *
 * CATEGORY-SPECIFIC MESSAGING:
 * The deactivate copy calls out two things to preempt admin panic:
 * 1. Deactivation does NOT cascade to sub-categories (Phase 6.1 decision).
 *    Sub-categories keep this as their parent.
 * 2. Products keep their category attribution — nothing breaks.
 *
 * PROPS:
 * - open, onClose, onSuccess, category, action — same shape as before the
 *   ConfirmDialog extraction. Callers are unchanged.
 */

const DEACTIVATE_DESCRIPTION =
  "The category will be hidden from selection when creating new products. Existing products and sub-categories keep this attribution — nothing cascades. You can reactivate it later.";

const REACTIVATE_DESCRIPTION =
  "The category will become selectable when creating new products again.";

const DeactivateCategoryDialog = ({
  open,
  onClose,
  onSuccess,
  category,
  action = "deactivate",
}) => {
  // Guard against a missing category — parent should never render us without
  // one, but if it does, don't render at all rather than crash on undefined.
  if (!category?.id) return null;

  const handleConfirm = () =>
    action === "deactivate"
      ? deactivateCategory(category.id)
      : reactivateCategory(category.id);

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onSuccess={onSuccess}
      onConfirm={handleConfirm}
      action={action}
      entityLabel="category"
      entityName={category.name}
      descriptionOverride={
        action === "deactivate"
          ? DEACTIVATE_DESCRIPTION
          : REACTIVATE_DESCRIPTION
      }
      errorFallback={`Couldn't ${action} the category.`}
    />
  );
};

export default DeactivateCategoryDialog;
