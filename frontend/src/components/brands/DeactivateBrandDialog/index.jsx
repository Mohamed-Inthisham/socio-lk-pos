import ConfirmDialog from "../../common/ConfirmDialog";
import {
  deactivateBrand,
  reactivateBrand,
} from "../../../services/brandsService";

/**
 * DeactivateBrandDialog Component
 *
 * Thin adapter over ConfirmDialog. Owns the two things that are genuinely
 * brand-specific: the service calls (deactivate/reactivate) and the
 * cascade-safety copy on deactivation. Everything else — submitting state,
 * error handling, reset-on-close, dialog shape — lives in ConfirmDialog.
 *
 * WHY KEEP THIS WRAPPER (instead of calling ConfirmDialog directly from
 * ManageBrandsPage): the deactivation caveat ("does NOT cascade to products")
 * is domain knowledge that shouldn't leak into list pages. Keeping it here
 * means the list page just says "user clicked deactivate on this brand"
 * without knowing what deactivation *means*.
 *
 * PROPS:
 * - open, onClose, onSuccess, brand, action — same shape as before the
 *   ConfirmDialog extraction. Callers are unchanged.
 */

const DEACTIVATE_DESCRIPTION =
  "The brand will be hidden from selection when creating new products. Existing products keep this brand — nothing cascades. You can reactivate it later.";

const REACTIVATE_DESCRIPTION =
  "The brand will become selectable when creating new products again.";

const DeactivateBrandDialog = ({
  open,
  onClose,
  onSuccess,
  brand,
  action = "deactivate",
}) => {
  // Guard against a missing brand — parent should never render us without one,
  // but if it does, don't render the dialog at all rather than crash on undefined.
  if (!brand?.id) return null;

  const handleConfirm = () =>
    action === "deactivate"
      ? deactivateBrand(brand.id)
      : reactivateBrand(brand.id);

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onSuccess={onSuccess}
      onConfirm={handleConfirm}
      action={action}
      entityLabel="brand"
      entityName={brand.name}
      descriptionOverride={
        action === "deactivate"
          ? DEACTIVATE_DESCRIPTION
          : REACTIVATE_DESCRIPTION
      }
      errorFallback={`Couldn't ${action} the brand.`}
    />
  );
};

export default DeactivateBrandDialog;
