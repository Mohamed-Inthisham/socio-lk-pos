import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Package, AlertCircle, ShieldAlert } from "lucide-react";
import Button from "../../components/common/Button";
import InputField from "../../components/common/InputField";
import Select from "../../components/common/Select";
import usePermissions from "../../hooks/usePermissions";
import {
  productEditSchema,
  mapProductToFormValues,
  buildUpdatePayload,
  PHONE_CONDITIONS,
  BARCODE_TYPES,
  PHONE_STORAGE_OPTIONS,
  PHONE_RAM_OPTIONS,
} from "../../schemas/productSchema";
import { getProduct, updateProduct } from "../../services/productsService";
import {
  fetchBranches,
  selectActiveBranches,
  selectBranchesInitialized,
} from "../../store/slices/branchesSlice";
import {
  fetchBrands,
  selectActiveBrands,
  selectBrandsInitialized,
} from "../../store/slices/brandsSlice";
import {
  fetchCategories,
  selectActiveCategories,
  selectCategoriesInitialized,
} from "../../store/slices/categoriesSlice";

/**
 * ProductEdit Page
 *
 * Admin-only form for editing an existing product. Path B step 7.
 *
 * DIFFERENCES FROM PRODUCTCREATE:
 * - Loads existing product on mount, pre-fills form via RHF reset()
 * - product_type and branch_id are READ-ONLY (rendered as plain fields).
 *   Changing them post-creation has too many downstream implications
 *   (stock rows keyed to product_id + branch_id, category constraints
 *   tied to type). If wrong at creation, deactivate + re-create.
 * - SKU field appears in Identification section, gated behind an
 *   "Override SKU" toggle. Rare + dangerous change; extra click enforces
 *   intent so admins don't accidentally break physical labels.
 * - Submit sends only dirty fields via PATCH (buildUpdatePayload). If
 *   nothing changed, Save button is disabled — no wasted network call,
 *   no misleading "success" flash.
 * - On success, navigates to /products/:id (detail page).
 *
 * ERROR STATES:
 * 404 (product not found) and 403 (branch outside user scope) get
 * explicit screens matching ProductDetail's UX. Generic failures show
 * an inline error banner and keep the form intact.
 */

// ============================================
// SUB-COMPONENTS
// ============================================

const FormSection = ({ title, description, children, className = "" }) => (
  <div
    className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 ${className}`}
  >
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h2>
      {description && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {description}
        </p>
      )}
    </div>
    {children}
  </div>
);

/**
 * Displays a field that can't be edited. Not a disabled input — plain
 * text with a subtle "cannot be changed" hint. Disabled selects look
 * like they might become enabled somehow; this reads as reference info.
 */
const ReadOnlyField = ({ label, value, hint }) => (
  <div className="flex flex-col gap-1.5 w-full">
    <label className="text-xs uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400">
      {label}
    </label>
    <div className="flex items-center px-3.5 rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 h-11">
      <span className="text-sm text-slate-700 dark:text-slate-200">
        {value ?? "—"}
      </span>
    </div>
    {hint && (
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
        {hint}
      </p>
    )}
  </div>
);

// ============================================
// LOADING / ERROR STATES
// ============================================

const LoadingSkeleton = () => (
  <div className="animate-pulse space-y-4">
    <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded w-1/3" />
    <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/4" />
    <div className="h-64 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl mt-6" />
    <div className="h-64 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl" />
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

const ProductEdit = () => {
  const { id } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();

  const [product, setProduct] = useState(null);
  const [loadState, setLoadState] = useState({ loading: true, error: null });
  const [apiError, setApiError] = useState(null);
  const [overrideSku, setOverrideSku] = useState(false);

  // Reference data for the editable selects (brand, category)
  const branches = useSelector(selectActiveBranches);
  const branchesInitialized = useSelector(selectBranchesInitialized);
  const brands = useSelector(selectActiveBrands);
  const brandsInitialized = useSelector(selectBrandsInitialized);
  const categories = useSelector(selectActiveCategories);
  const categoriesInitialized = useSelector(selectCategoriesInitialized);

  useEffect(() => {
    if (!branchesInitialized) dispatch(fetchBranches());
    if (!brandsInitialized) dispatch(fetchBrands());
    if (!categoriesInitialized) dispatch(fetchCategories());
  }, [dispatch, branchesInitialized, brandsInitialized, categoriesInitialized]);

  const {
    register,
    handleSubmit,
    watch,
    control,
    reset,
    formState: { errors, isSubmitting, isDirty, dirtyFields },
  } = useForm({
    resolver: zodResolver(productEditSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    // No defaultValues here — we reset() with real data once loaded so
    // isDirty tracks against the actual product, not blank defaults.
  });

  // Load product and pre-fill the form
  const load = () => {
    setLoadState({ loading: true, error: null });
    setApiError(null);

    getProduct(id)
      .then((data) => {
        setProduct(data);
        reset(mapProductToFormValues(data));
        setLoadState({ loading: false, error: null });
      })
      .catch((err) => {
        const status = err.response?.status;
        const message =
          err.response?.data?.message ||
          err.message ||
          "Something went wrong loading this product.";
        setLoadState({ loading: false, error: { status, message } });
      });
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const productType = watch("product_type");
  const isPhone = productType === "PHONE";

  // Dropdown options (memoized against the reference-data arrays)
  const brandOptions = useMemo(
    () => [
      { value: "", label: "Select a brand" },
      ...brands.map((b) => ({ value: b.id, label: b.name })),
    ],
    [brands],
  );
  const categoryOptions = useMemo(
    () => [
      { value: "", label: "Select a category" },
      ...categories.map((c) => ({ value: c.id, label: c.name })),
    ],
    [categories],
  );
  const phoneConditionOptions = useMemo(
    () => [
      { value: "", label: "Select a condition" },
      ...PHONE_CONDITIONS.map((c) => ({ value: c, label: c })),
    ],
    [],
  );
  const barcodeTypeOptions = useMemo(
    () => BARCODE_TYPES.map((t) => ({ value: t, label: t.replace("_", "-") })),
    [],
  );
  const storageOptions = useMemo(
    () => [
      { value: "", label: "Select storage" },
      ...PHONE_STORAGE_OPTIONS.map((s) => ({ value: s, label: s })),
    ],
    [],
  );
  const ramOptions = useMemo(
    () => [
      { value: "", label: "Select RAM" },
      ...PHONE_RAM_OPTIONS.map((r) => ({ value: r, label: r })),
    ],
    [],
  );

  // Branch name lookup for the read-only field. Falls back to the
  // branch object on the loaded product if the branches list hasn't
  // fetched yet, so we always have something to show.
  const branchName =
    branches.find((b) => b.id === product?.branch?.id)?.name ||
    product?.branch?.name ||
    "—";

  const onSubmit = async (data) => {
    setApiError(null);

    // If admin didn't tick "Override SKU", strip sku from dirtyFields
    // so it never lands in the payload — even if RHF flagged it dirty
    // for some reason (e.g. focus/blur without change).
    const effectiveDirty = { ...dirtyFields };
    if (!overrideSku) {
      delete effectiveDirty.sku;
    }

    const payload = buildUpdatePayload(data, effectiveDirty);

    // Defense in depth: if nothing to send, don't submit.
    // The button should already be disabled, but this catches edge cases.
    if (Object.keys(payload).length === 0) {
      return;
    }

    try {
      await updateProduct(id, payload);
      navigate(`/products/${id}`);
    } catch (err) {
      setApiError(
        err.response?.data?.message ||
          err.message ||
          "Couldn't update the product. Please try again.",
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleCancel = () => navigate(`/products/${id}`);
  const handleBackToList = () => navigate("/products");

  const wrap = (content) => (
    <div className="max-w-4xl mx-auto p-4 md:p-6">{content}</div>
  );

  // Loading / error gates BEFORE the form renders
  if (loadState.loading) return wrap(<LoadingSkeleton />);

  if (loadState.error) {
    if (loadState.error.status === 404)
      return wrap(<NotFoundState onBack={handleBackToList} />);
    if (loadState.error.status === 403)
      return wrap(<ForbiddenState onBack={handleBackToList} />);
    return wrap(
      <GenericErrorState
        message={loadState.error.message}
        onBack={handleBackToList}
        onRetry={load}
      />,
    );
  }

  if (!product) return wrap(<NotFoundState onBack={handleBackToList} />);

  // Save is disabled unless the form is dirty OR the SKU override toggle
  // was flipped on (with the SKU field itself dirty).
  const hasChanges =
    isDirty &&
    Object.keys(dirtyFields).some((k) => {
      // If SKU is dirty but override is off, that dirty flag doesn't count
      if (k === "sku" && !overrideSku) return false;
      return dirtyFields[k];
    });

  return wrap(
    <>
      <button
        type="button"
        onClick={handleCancel}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors mb-4"
      >
        <ArrowLeft size={14} />
        Back to product
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-cyan-100 dark:bg-cyan-900/40 flex items-center justify-center">
          <Package size={20} className="text-cyan-600 dark:text-cyan-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 truncate">
            Edit product
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
            {product.name} · <span className="font-mono">{product.sku}</span>
          </p>
        </div>
      </div>

      {apiError && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl p-4 mb-4 flex items-start gap-3">
          <AlertCircle
            size={18}
            className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
          />
          <div>
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              Couldn't update product
            </p>
            <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
              {apiError}
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormSection
          title="Basics"
          description="Name and product type. Type is fixed at creation."
        >
          <div className="space-y-4">
            <InputField
              label="Product name"
              required
              placeholder="e.g. iPhone 15 Pro Max 256GB"
              error={errors.name?.message}
              {...register("name")}
            />

            <ReadOnlyField
              label="Product type"
              value={product.product_type}
              hint="Product type cannot be changed after creation. Deactivate and re-create if this is wrong."
            />

            <InputField
              type="textarea"
              label="Description"
              placeholder="Internal notes, condition summary, accessories included…"
              rows={3}
              error={errors.description?.message}
              {...register("description")}
            />
          </div>
        </FormSection>

        <FormSection
          title="Classification"
          description="Brand and category can be reassigned. Branch is fixed at creation."
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Controller
              name="brand_id"
              control={control}
              render={({ field, fieldState }) => (
                <Select
                  label="Brand"
                  required
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  options={brandOptions}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Controller
              name="category_id"
              control={control}
              render={({ field, fieldState }) => (
                <Select
                  label="Category"
                  required
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  options={categoryOptions}
                  error={fieldState.error?.message}
                />
              )}
            />
            <ReadOnlyField
              label="Branch"
              value={branchName}
              hint="Branch cannot be changed. Use a stock transfer instead."
            />
          </div>
        </FormSection>

        <FormSection
          title="Pricing"
          description="Prices in LKR. Use up to 2 decimal places."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InputField
              type="text"
              label="Buying price"
              required
              placeholder="e.g. 180000.00"
              inputMode="decimal"
              error={errors.buying_price?.message}
              {...register("buying_price")}
            />
            <InputField
              type="text"
              label="Selling price"
              required
              placeholder="e.g. 199900.00"
              inputMode="decimal"
              error={errors.selling_price?.message}
              {...register("selling_price")}
            />
          </div>
        </FormSection>

        <FormSection
          title="Identification"
          description="Barcode can be updated. SKU changes require explicit override."
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <InputField
                  label="Barcode"
                  placeholder="Leave blank to unset"
                  error={errors.barcode?.message}
                  {...register("barcode")}
                />
              </div>
              <Controller
                name="barcode_type"
                control={control}
                render={({ field, fieldState }) => (
                  <Select
                    label="Barcode type"
                    name={field.name}
                    value={field.value}
                    onChange={field.onChange}
                    options={barcodeTypeOptions}
                    error={fieldState.error?.message}
                  />
                )}
              />
            </div>

            {/* SKU override — admin-only affordance. Gated behind a
                toggle because changing SKU breaks physical labels and
                cashier muscle memory. */}
            {isAdmin && (
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                <label className="flex items-start gap-3 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={overrideSku}
                    onChange={(e) => setOverrideSku(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded border-slate-300 dark:border-slate-600 text-cyan-600 focus:ring-cyan-500 [color-scheme:light] dark:[color-scheme:dark]"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-200">
                    Override SKU
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Warning: changing SKU affects printed barcode labels and
                      cashier lookups. Only change if you know why.
                    </span>
                  </span>
                </label>

                {overrideSku ? (
                  <InputField
                    label="SKU"
                    required
                    placeholder="e.g. SKU-000001"
                    error={errors.sku?.message}
                    {...register("sku")}
                  />
                ) : (
                  <ReadOnlyField label="SKU" value={product.sku} />
                )}
              </div>
            )}
          </div>
        </FormSection>

        <FormSection
          title="Warranty"
          description={
            isPhone
              ? "Full warranty in months. Checking warranty (defect window) in days — for used phones."
              : "Full warranty in months. Optional."
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InputField
              type="number"
              label="Warranty (months)"
              placeholder="e.g. 12"
              min={0}
              step={1}
              error={errors.warranty_months?.message}
              {...register("warranty_months")}
            />
            {isPhone && (
              <InputField
                type="number"
                label="Checking warranty (days)"
                placeholder="e.g. 14"
                min={0}
                step={1}
                error={errors.checking_warranty_days?.message}
                {...register("checking_warranty_days")}
              />
            )}
          </div>
        </FormSection>

        <FormSection
          title="Serialization"
          description="For phones sold with individual IMEI tracking. Cashiers will be prompted to scan IMEI at sale time."
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              {...register("is_serialized")}
              className="w-4 h-4 mt-0.5 rounded border-slate-300 dark:border-slate-600 text-cyan-600 focus:ring-cyan-500 [color-scheme:light] dark:[color-scheme:dark]"
            />
            <span className="text-sm text-slate-700 dark:text-slate-200">
              This product is sold with a unique serial number (IMEI)
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Enable for phones and other serialized devices. Cashiers will
                see an IMEI input at checkout.
              </span>
            </span>
          </label>
        </FormSection>

        {isPhone && (
          <FormSection
            title="Phone specifications"
            description="Condition is required. Other specs are optional but recommended."
          >
            <div className="space-y-4">
              <Controller
                name="phone_condition"
                control={control}
                render={({ field, fieldState }) => (
                  <Select
                    label="Condition"
                    required
                    name={field.name}
                    value={field.value}
                    onChange={field.onChange}
                    options={phoneConditionOptions}
                    error={fieldState.error?.message}
                  />
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InputField
                  label="Model"
                  placeholder="e.g. A2848"
                  error={errors.phone_model?.message}
                  {...register("phone_model")}
                />
                <Controller
                  name="phone_storage"
                  control={control}
                  render={({ field, fieldState }) => (
                    <Select
                      label="Storage"
                      name={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      options={storageOptions}
                      error={fieldState.error?.message}
                    />
                  )}
                />
                <InputField
                  label="Color"
                  placeholder="e.g. Natural Titanium"
                  error={errors.phone_color?.message}
                  {...register("phone_color")}
                />
                <Controller
                  name="phone_ram"
                  control={control}
                  render={({ field, fieldState }) => (
                    <Select
                      label="RAM"
                      name={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      options={ramOptions}
                      error={fieldState.error?.message}
                    />
                  )}
                />
              </div>
            </div>
          </FormSection>
        )}

        <div className="sticky bottom-0 bg-slate-50 dark:bg-slate-950 -mx-4 md:-mx-6 px-4 md:px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={handleCancel}
            disabled={isSubmitting}
            label="Cancel"
            fullWidth
          />
          <Button
            type="submit"
            variant="accent"
            loading={isSubmitting}
            disabled={!hasChanges}
            label="Save changes"
            fullWidth
          />
        </div>
      </form>
    </>,
  );
};

export default ProductEdit;
