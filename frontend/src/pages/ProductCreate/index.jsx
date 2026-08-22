import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Package, AlertCircle } from "lucide-react";
import Button from "../../components/common/Button";
import InputField from "../../components/common/InputField";
import Select from "../../components/common/Select";
import {
  productCreateSchema,
  productFormDefaults,
  buildCreatePayload,
  PRODUCT_TYPES,
  PHONE_CONDITIONS,
  BARCODE_TYPES,
  PHONE_STORAGE_OPTIONS,
  PHONE_RAM_OPTIONS,
} from "../../schemas/productSchema";
import { createProduct } from "../../services/productsService";
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
 * ProductCreate Page
 *
 * Admin-only form for creating a new product. Path B step 6.
 *
 * FORM LIBRARY:
 * react-hook-form + zod. The schema in schemas/productSchema.js is the
 * source of truth for validation rules and default values. Component
 * only handles UI concerns: layout, conditional rendering, submit flow.
 *
 * CONDITIONAL PHONE FIELDS:
 * When product_type = PHONE, an extra "Phone specifications" section
 * appears below the main fields. Zod's superRefine enforces that
 * phone_condition is required for phones. Other phone fields (model,
 * storage, color, RAM) are optional even for phones.
 *
 * SUBMIT FLOW:
 * 1. RHF runs Zod validation
 * 2. buildCreatePayload() cleans the data (strips phone fields when
 *    not a phone, drops empty-string optionals)
 * 3. createProduct() POSTs to the backend
 * 4. On success: navigate to /products/:id (backend returns the created
 *    product with auto-generated SKU)
 * 5. On error: show inline error banner, keep the form intact
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

// ============================================
// MAIN COMPONENT
// ============================================

const ProductCreate = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [apiError, setApiError] = useState(null);

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
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(productCreateSchema),
    defaultValues: productFormDefaults,
    mode: "onBlur",
    reValidateMode: "onChange",
  });

  const productType = watch("product_type");
  const isPhone = productType === "PHONE";

  const productTypeOptions = useMemo(
    () => [
      { value: "", label: "Select a type" },
      ...PRODUCT_TYPES.map((t) => ({ value: t, label: t })),
    ],
    [],
  );
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
  const branchOptions = useMemo(
    () => [
      { value: "", label: "Select a branch" },
      ...branches.map((b) => ({ value: b.id, label: b.name })),
    ],
    [branches],
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

  const onSubmit = async (data) => {
    setApiError(null);
    try {
      const payload = buildCreatePayload(data);
      const created = await createProduct(payload);
      navigate(`/products/${created.id}`);
    } catch (err) {
      setApiError(
        err.response?.data?.message ||
          err.message ||
          "Couldn't create the product. Please try again.",
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleCancel = () => navigate("/products");

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
        <button
          type="button"
          onClick={handleCancel}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors mb-4"
        >
          <ArrowLeft size={14} />
          Back to products
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-cyan-100 dark:bg-cyan-900/40 flex items-center justify-center">
            <Package size={20} className="text-cyan-600 dark:text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              New product
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              SKU is auto-generated after saving.
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
                Couldn't create product
              </p>
              <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                {apiError}
              </p>
            </div>
          </div>
        )}

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <FormSection
            title="Basics"
            description="Name and product type. Optional description for internal notes."
          >
            <div className="space-y-4">
              <InputField
                label="Product name"
                required
                placeholder="e.g. iPhone 15 Pro Max 256GB"
                error={errors.name?.message}
                {...register("name")}
              />

              <Controller
                name="product_type"
                control={control}
                render={({ field, fieldState }) => (
                  <Select
                    label="Product type"
                    required
                    name={field.name}
                    value={field.value}
                    onChange={field.onChange}
                    options={productTypeOptions}
                    error={fieldState.error?.message}
                  />
                )}
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
            description="Brand, category, and which branch owns this product."
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
              <Controller
                name="branch_id"
                control={control}
                render={({ field, fieldState }) => (
                  <Select
                    label="Branch"
                    required
                    name={field.name}
                    value={field.value}
                    onChange={field.onChange}
                    options={branchOptions}
                    error={fieldState.error?.message}
                  />
                )}
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
            description="Barcode is optional — leave blank to auto-generate (SLP-XXXXXX)."
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <InputField
                  label="Barcode"
                  placeholder="Leave blank to auto-generate"
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
              label="Create product"
              fullWidth
            />
          </div>
        </form>
      </div>
  );
};

export default ProductCreate;
