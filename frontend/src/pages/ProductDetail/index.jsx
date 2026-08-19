import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Edit3,
  Power,
  PowerOff,
  Package,
  AlertCircle,
  Ban,
  ShieldAlert,
} from "lucide-react";
import Button from "../../components/common/Button";
import usePermissions from "../../hooks/usePermissions";
import { PERMISSIONS } from "../../constants/rolePermissions";
import { getProduct } from "../../services/productsService";
import { getStockByProduct } from "../../services/stockService";
import DeactivateProductDialog from "../../components/products/DeactivateProductDialog";
import AdjustStockDialog from "../../components/products/AdjustStockDialog";

/**
 * ProductDetail Page
 *
 * Read-only view of one product. Path B step 5.
 *
 * Fetches:
 * - Product details (with nested brand/category/branch) via /products/:id
 * - Stock rows per branch via /stock/by-product/:productId
 *
 * Action buttons (all admin-only, wired in a follow-up step):
 * - Edit: navigates to /products/:id/edit (form not built yet)
 * - Deactivate / Reactivate: opens confirmation modal (not wired yet)
 * - Adjust Stock: per-row button opens modal (not wired yet)
 *
 * 404 (product not found) and 403 (branch outside user scope) are handled
 * explicitly so staff on a mistyped or unauthorized URL get a helpful
 * screen instead of a raw error.
 */

const currencyFormatter = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatPrice = (priceStr) => {
  const n = Number(priceStr);
  if (!Number.isFinite(n)) return priceStr;
  return currencyFormatter.format(n);
};

const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-LK", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
};

// ============================================
// SUB-COMPONENTS
// ============================================

const Section = ({ title, children, className = "" }) => (
  <div
    className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 ${className}`}
  >
    <h2 className="text-xs uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400 mb-4">
      {title}
    </h2>
    {children}
  </div>
);

const Field = ({ label, value, mono = false }) => (
  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline gap-1 py-2 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
    <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">
      {label}
    </span>
    <span
      className={`text-sm text-slate-800 dark:text-slate-200 text-left sm:text-right ${
        mono ? "font-mono" : ""
      }`}
    >
      {value ?? "—"}
    </span>
  </div>
);

const Badge = ({ children, tone = "slate" }) => {
  const TONES = {
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
    green:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    amber:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
};

const stockTone = (row) => {
  if (!row.manage_stock) return "slate";
  if (row.quantity === 0) return "red";
  if (row.min_quantity && row.quantity <= row.min_quantity) return "amber";
  return "green";
};

const stockLabel = (row) => {
  if (!row.manage_stock) return "Not tracked";
  if (row.quantity === 0) return "Out of stock";
  return `${row.quantity} in stock`;
};

// ============================================
// LOADING / ERROR STATES
// ============================================

const LoadingSkeleton = () => (
  <div className="animate-pulse space-y-4">
    <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded w-1/3" />
    <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/4" />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
      <div className="h-64 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl" />
      <div className="h-64 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl" />
    </div>
  </div>
);

const NotFoundState = ({ onBack }) => (
  <div className="flex flex-col items-center justify-center py-24 text-center">
    <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
      <Package size={28} className="text-slate-400 dark:text-slate-500" />
    </div>
    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">
      Product not found
    </h2>
    <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-sm">
      This product may have been deleted or the link is incorrect.
    </p>
    <Button
      variant="secondary"
      icon={ArrowLeft}
      onClick={onBack}
      label="Back to products"
    />
  </div>
);

const ForbiddenState = ({ onBack }) => (
  <div className="flex flex-col items-center justify-center py-24 text-center">
    <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mb-4">
      <ShieldAlert size={28} className="text-amber-600 dark:text-amber-400" />
    </div>
    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">
      Not accessible
    </h2>
    <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-sm">
      This product belongs to a branch you don't have access to.
    </p>
    <Button
      variant="secondary"
      icon={ArrowLeft}
      onClick={onBack}
      label="Back to products"
    />
  </div>
);

const GenericErrorState = ({ message, onBack, onRetry }) => (
  <div className="flex flex-col items-center justify-center py-24 text-center">
    <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center mb-4">
      <AlertCircle size={28} className="text-red-600 dark:text-red-400" />
    </div>
    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">
      Couldn't load product
    </h2>
    <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-sm">
      {message}
    </p>
    <div className="flex gap-2">
      <Button
        variant="secondary"
        icon={ArrowLeft}
        onClick={onBack}
        label="Back"
      />
      <Button variant="accent" onClick={onRetry} label="Try again" />
    </div>
  </div>
);

// ============================================
// MAIN COMPONENT
// ============================================

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();

  const [product, setProduct] = useState(null);
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Dialog state — deactivate is boolean, adjust-stock uses the row itself
  // as the "open" signal (null = closed, row object = open on that row).
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [adjustStockRow, setAdjustStockRow] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);

    Promise.all([getProduct(id), getStockByProduct(id)])
      .then(([productData, stockData]) => {
        setProduct(productData);
        setStock(stockData);
      })
      .catch((err) => {
        const status = err.response?.status;
        const message =
          err.response?.data?.message ||
          err.message ||
          "Something went wrong loading this product.";
        setError({ status, message });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleBack = () => navigate("/products");
  const handleEdit = () => navigate(`/products/${id}/edit`);
  // Deactivate and reactivate share the same dialog — the action prop
  // decides which flow. Same trigger, same modal, different confirmation.
  const handleDeactivate = () => setShowDeactivateDialog(true);
  const handleReactivate = () => setShowDeactivateDialog(true);
  const handleAdjustStock = (stockRow) => setAdjustStockRow(stockRow);

  // Called by the deactivate/reactivate dialog after a successful API call
  const handleDeactivateSuccess = () => {
    setShowDeactivateDialog(false);
    load(); // Refetch product + stock so is_active flips
  };

  // Called by the adjust-stock dialog after a successful update
  const handleAdjustStockSuccess = () => {
    setAdjustStockRow(null);
    load(); // Refetch stock rows so the quantity/badge update
  };

  const canEdit = can(PERMISSIONS.EDIT_PRODUCT);
  const canDelete = can(PERMISSIONS.DELETE_PRODUCT);
  const canAdjustStock = can(PERMISSIONS.ADJUST_STOCK);

   const wrap = (content) => (
     <div className="max-w-6xl mx-auto p-4 md:p-6">{content}</div>
   );

  if (loading) return wrap(<LoadingSkeleton />);

  if (error) {
    if (error.status === 404)
      return wrap(<NotFoundState onBack={handleBack} />);
    if (error.status === 403)
      return wrap(<ForbiddenState onBack={handleBack} />);
    return wrap(
      <GenericErrorState
        message={error.message}
        onBack={handleBack}
        onRetry={load}
      />,
    );
  }

  if (!product) return wrap(<NotFoundState onBack={handleBack} />);

  const isPhone = product.product_type === "PHONE";

  return wrap(
    <div className="space-y-4">
      <button
        type="button"
        onClick={handleBack}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors mb-2"
      >
        <ArrowLeft size={14} />
        Back to products
      </button>

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            {product.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="slate">
              <span className="font-mono">{product.sku}</span>
            </Badge>
            <Badge tone="cyan">{product.product_type}</Badge>
            {product.is_active ? (
              <Badge tone="green">Active</Badge>
            ) : (
              <Badge tone="slate">Inactive</Badge>
            )}
            {isPhone && product.phone_condition && (
              <Badge
                tone={product.phone_condition === "NEW" ? "green" : "amber"}
              >
                {product.phone_condition}
              </Badge>
            )}
          </div>
        </div>

        {(canEdit || canDelete) && (
          <div className="flex flex-wrap gap-2 lg:flex-shrink-0">
            {canEdit && (
              <Button
                variant="secondary"
                icon={Edit3}
                onClick={handleEdit}
                label="Edit"
              />
            )}
            {canDelete && product.is_active && (
              <Button
                variant="danger"
                icon={PowerOff}
                onClick={handleDeactivate}
                label="Deactivate"
              />
            )}
            {canDelete && !product.is_active && (
              <Button
                variant="accent"
                icon={Power}
                onClick={handleReactivate}
                label="Reactivate"
              />
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Product information">
          <Field label="Brand" value={product.brand?.name} />
          <Field label="Category" value={product.category?.name} />
          <Field label="Branch" value={product.branch?.name} />
          <Field label="Barcode" value={product.barcode} mono />
          <Field label="Barcode type" value={product.barcode_type} />
          <Field
            label="Serialized"
            value={product.is_serialized ? "Yes (IMEI captured at sale)" : "No"}
          />
          {product.description && (
            <Field label="Description" value={product.description} />
          )}
          <Field label="Created" value={formatDate(product.created_at)} />
          <Field label="Updated" value={formatDate(product.updated_at)} />
        </Section>

        <div className="space-y-4">
          <Section title="Pricing & warranty">
            <Field
              label="Buying price"
              value={formatPrice(product.buying_price)}
              mono
            />
            <Field
              label="Selling price"
              value={formatPrice(product.selling_price)}
              mono
            />
            <Field
              label="Warranty"
              value={
                product.warranty_months
                  ? `${product.warranty_months} months`
                  : null
              }
            />
            {isPhone && (
              <Field
                label="Checking warranty"
                value={
                  product.checking_warranty_days
                    ? `${product.checking_warranty_days} days`
                    : null
                }
              />
            )}
          </Section>

          {isPhone && (
            <Section title="Phone specifications">
              <Field label="Model" value={product.phone_model} />
              <Field label="Storage" value={product.phone_storage} />
              <Field label="RAM" value={product.phone_ram} />
              <Field label="Color" value={product.phone_color} />
            </Section>
          )}
        </div>
      </div>

      <Section title="Stock across branches">
        {stock.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">
            No stock rows for this product yet.
          </div>
        ) : (
          <div className="space-y-2">
            {stock.map((row) => (
              <div
                key={row.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {row.branch?.name || "—"}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {row.manage_stock
                      ? `Min quantity: ${row.min_quantity ?? 0}`
                      : "Stock tracking disabled"}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={stockTone(row)}>{stockLabel(row)}</Badge>
                  {canAdjustStock && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleAdjustStock(row)}
                      label="Adjust"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {!product.is_active && (
        <div className="bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex items-start gap-3">
          <Ban
            size={18}
            className="text-slate-500 dark:text-slate-400 flex-shrink-0 mt-0.5"
          />
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              This product is inactive
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              It will not appear in the POS terminal or on the customer-facing
              catalog until it's reactivated.
            </p>
          </div>
        </div>
      )}

      {/* Dialogs — rendered outside the layout, mounted only when open */}
      <DeactivateProductDialog
        open={showDeactivateDialog}
        onClose={() => setShowDeactivateDialog(false)}
        onSuccess={handleDeactivateSuccess}
        product={product}
        action={product.is_active ? "deactivate" : "reactivate"}
      />

      <AdjustStockDialog
        open={adjustStockRow !== null}
        onClose={() => setAdjustStockRow(null)}
        onSuccess={handleAdjustStockSuccess}
        stockRow={adjustStockRow}
      />
    </div>,
  );
};;;

export default ProductDetail;
