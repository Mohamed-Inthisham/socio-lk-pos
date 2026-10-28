import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Package, AlertCircle } from "lucide-react";
import Button from "../../components/common/Button";
import InputField from "../../components/common/InputField";
import Select from "../../components/common/Select";
import Dialog from "../../components/common/Dialog";
import { WARRANTY_PERIODS } from "../../constants/warranty";
import {
  productCreateSchema,
  productFormDefaults,
  buildCreatePayload,
  PHONE_CONDITIONS,
  BARCODE_TYPES,
  PHONE_STORAGE_OPTIONS,
  PHONE_RAM_OPTIONS,
  TRACKING_METHOD_OPTIONS,
} from "../../schemas/productSchema";
import { createProduct } from "../../services/productsService";
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
 * Category settings enable optional phone specifications.
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

const ProductCreate = ({ embedded = false, onCreated, onCancel }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [apiError, setApiError] = useState(null);

  const brands = useSelector(selectActiveBrands);
  const brandsInitialized = useSelector(selectBrandsInitialized);
  const categories = useSelector(selectActiveCategories);
  const categoriesInitialized = useSelector(selectCategoriesInitialized);

  useEffect(() => {
    if (!brandsInitialized) dispatch(fetchBrands());
    if (!categoriesInitialized) dispatch(fetchCategories());
  }, [dispatch, brandsInitialized, categoriesInitialized]);

  const {
    register,
    setValue,
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

  const isPhone = watch("show_phone_specs");
  const selectedCategoryId = watch("category_id");
  const selectedBrandId = watch("brand_id");

  const brandOptions = useMemo(
    () => [
      { value: "", label: "Select a brand" },
      ...brands
        .filter((brand) => brand.category_id === selectedCategoryId)
        .map((b) => ({ value: b.id, label: b.name })),
    ],
    [brands, selectedCategoryId],
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

  const onSubmit = async (data) => {
    setApiError(null);
    try {
      const payload = buildCreatePayload(data);
      const created = await createProduct(payload);
      if (onCreated) {
        onCreated(created);
      } else {
        navigate(`/products/${created.id}`);
      }
    } catch (err) {
      setApiError(
        err.response?.data?.message ||
          err.message ||
          "Couldn't create the product. Please try again.",
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      navigate("/products");
    }
  };

  const page = (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <button
        type="button"
        onClick={handleCancel}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors mb-4"
      >
        <ArrowLeft size={14} />
        {onCancel ? "Back to stock purchase" : "Back to products"}
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
            Register a model once. SKU and a product barcode are generated when
            needed. Stock and individual identifiers are added later through
            stock purchase.
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

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormSection
          title="Classification"
          description="Choose a category first, then a brand assigned to it."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Controller
              name="category_id"
              control={control}
              render={({ field, fieldState }) => (
                <Select
                  label="Category"
                  required
                  name={field.name}
                  value={field.value}
                  onChange={(event) => {
                    const value = event.target.value;
                    field.onChange(event);
                    const category = categories.find((item) => item.id === value);
                    setValue("show_phone_specs", category?.show_phone_specs ?? false, { shouldValidate: true });
                    setValue("tracking_method", category?.show_phone_specs ? "IMEI" : "QUANTITY", { shouldValidate: true });
                    const selectedBrand = brands.find((brand) => brand.id === selectedBrandId);
                    if (selectedBrand?.category_id && selectedBrand.category_id !== value) {
                      setValue("brand_id", "", { shouldValidate: true });
                    }
                  }}
                  options={categoryOptions}
                  error={fieldState.error?.message}
                />
              )}
            />
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
                  disabled={!selectedCategoryId}
                />
              )}
            />
          </div>
        </FormSection>

        <FormSection
          title="Basic details"
          description="Product name and model. Optional description for internal notes."
        >
          <div className="space-y-4">
            <InputField
              label="Product name"
              required
              placeholder="e.g. iPhone 15 Pro Max 256GB"
              error={errors.name?.message}
              {...register("name")}
            />

            <InputField
              label="Model"
              placeholder="e.g. 12 Pro or A115Hk Zolo 20W Type C"
              error={errors.model?.message}
              {...register("model")}
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
          title="Pricing"
          description="Prices in LKR. Use up to 2 decimal places."
        >
          <div className="grid grid-cols-1 gap-4">
            <div className="max-w-sm">
              <InputField
                type="text"
                label="Selling price"
                placeholder="Enter now or add during stock purchase"
                inputMode="decimal"
                error={errors.selling_price?.message}
                {...register("selling_price")}
              />
            </div>
          </div>
        </FormSection>

        <FormSection
          title="Identification"
          description="Choose the primary unit identifier. Stock purchases can also record both an IMEI and serial number for each received unit. Product barcode is optional."
        >
          <div className="max-w-sm mb-4">
            <Controller
              name="tracking_method"
              control={control}
              render={({ field, fieldState }) => (
                <Select
                  label="Unit identification"
                  required
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  options={TRACKING_METHOD_OPTIONS}
                  error={fieldState.error?.message}
                  hint="This sets the primary identifier type. You can record the other identifier on each stock purchase too."
                />
              )}
            />
          </div>
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
          description="The warranty a sale of this product starts with. The cashier can change it per item at the till."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Controller
              name="default_warranty"
              control={control}
              render={({ field, fieldState }) => (
                <Select
                  label="Default warranty"
                  required
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  options={WARRANTY_PERIODS}
                  error={fieldState.error?.message}
                  hint="Checking = the customer checks it in the shop; no warranty after they leave."
                />
              )}
            />
          </div>
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

  return embedded ? (
    <Dialog open onClose={handleCancel} size="xl" dismissible={!isSubmitting}>
      <div className="max-h-[78vh] overflow-y-auto">{page}</div>
    </Dialog>
  ) : page;
};

export default ProductCreate;
