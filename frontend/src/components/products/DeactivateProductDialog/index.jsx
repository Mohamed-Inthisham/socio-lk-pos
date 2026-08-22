import ConfirmDialog from "../../common/ConfirmDialog";
import {
  deactivateProduct,
  reactivateProduct,
} from "../../../services/productsService";

/**
 * DeactivateProductDialog Component
 *
 * Thin adapter over ConfirmDialog. Owns the two things that are genuinely
 * product-specific: the service calls and the customer-facing impact copy
 * on deactivation. Everything else — submitting state, error handling,
 * reset-on-close, dialog shape — lives in ConfirmDialog.
 *
 * PRODUCT-SPECIFIC MESSAGING:
 * Unlike brands/categories (which are admin-only dropdown values),
 * products are user-facing at point of sale. The deactivate copy calls
 * out both the POS terminal and the customer catalog because that's what
 * actually changes for real users, and reassures on historical sales
 * data preservation so admin doesn't fear breaking reports.
 *
 * PROPS:
 * - open, onClose, onSuccess, product, action — same shape as before the
 *   ConfirmDialog extraction. Callers are unchanged.
 */

const DEACTIVATE_DESCRIPTION =
  "The product will be hidden from the POS terminal and customer catalog. Historical sales data is preserved. You can reactivate it later.";

const REACTIVATE_DESCRIPTION =
  "The product will become visible in the POS terminal and customer catalog again.";

const DeactivateProductDialog = ({
  open,
  onClose,
  onSuccess,
  product,
  action = "deactivate",
}) => {
  // Guard against a missing product — parent should never render us without
  // one, but if it does, don't render at all rather than crash on undefined.
  if (!product?.id) return null;

  const handleConfirm = () =>
    action === "deactivate"
      ? deactivateProduct(product.id)
      : reactivateProduct(product.id);

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onSuccess={onSuccess}
      onConfirm={handleConfirm}
      action={action}
      entityLabel="product"
      entityName={product.name}
      descriptionOverride={
        action === "deactivate"
          ? DEACTIVATE_DESCRIPTION
          : REACTIVATE_DESCRIPTION
      }
      errorFallback={`Couldn't ${action} the product.`}
    />
  );
};

export default DeactivateProductDialog;
