import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDispatch, useSelector } from "react-redux";
import { AlertCircle } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import InputField from "../../common/InputField";
import Select from "../../common/Select";
import {
  categorySchema,
  categoryFormDefaults,
  mapCategoryToFormValues,
  buildCategoryPayload,
  NO_PARENT,
} from "../../../schemas/categorySchema";
import {
  createCategory,
  updateCategory,
} from "../../../services/categoriesService";
import {
  fetchCategories,
  selectAllCategories,
  selectCategoriesInitialized,
} from "../../../store/slices/categoriesSlice";

/**
 * CategoryFormDialog
 *
 * Shared create/edit modal for categories. One component covers both flows
 * because category has no field that differs between create and edit — the
 * only difference is which endpoint receives the payload.
 *
 * PARENT PICKER:
 * Categories are two-level. The parent select shows only top-level
 * categories (parent_id === null) plus a "None (top-level)" option at
 * the top. This makes it impossible to select a sub-category as a parent,
 * enforcing the two-level rule client-side. Backend enforces it too as
 * defense in depth.
 *
 * On edit, the category being edited is excluded from its own parent
 * options so it can't become its own parent. Deeper cycle prevention
 * isn't needed because the endpoint only offers top-level parents — a
 * top-level category has no children that are themselves parents.
 *
 * 409 HANDLING:
 * Case-insensitive uniqueness within the same parent. Backend returns
 * "Category name already exists at this level" on conflict; we surface
 * that as a field-level error on `name` instead of a generic banner.
 *
 * EDIT DIRTY-FIELD OPTIMIZATION:
 * Same PATCH semantics as brands/products: only dirty fields go on the
 * wire. Save button disabled unless isDirty.
 *
 * CATEGORIES SLICE:
 * We read from the categories slice for the parent picker options. If
 * the slice hasn't been initialized yet (e.g. dialog opens before any
 * page has fetched categories), we dispatch fetchCategories on mount.
 *
 * PROPS:
 * - open: boolean
 * - onClose: () => void
 * - onSuccess: (category) => void, called with the created/updated category
 * - mode: "create" | "edit"
 * - category: the category to edit (required for mode="edit", ignored for create)
 */

const CategoryFormDialog = ({
  open,
  onClose,
  onSuccess,
  mode = "create",
  category = null,
}) => {
  const isEdit = mode === "edit";
  const dispatch = useDispatch();

  const [apiError, setApiError] = useState(null);

  const allCategories = useSelector(selectAllCategories);
  const categoriesInitialized = useSelector(selectCategoriesInitialized);

  // Lazy-fetch categories if the slice hasn't been initialized yet.
  // Most callers will have already triggered this from a page, but a
  // future flow could open this dialog cold.
  useEffect(() => {
    if (!categoriesInitialized) dispatch(fetchCategories());
  }, [dispatch, categoriesInitialized]);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty, dirtyFields },
  } = useForm({
    resolver: zodResolver(categorySchema),
    defaultValues: categoryFormDefaults,
    mode: "onBlur",
    reValidateMode: "onChange",
  });

  // Reset the form when the dialog opens or the target category changes.
  // Create mode → blank defaults. Edit mode → category values. Tied to
  // `open` so re-opening for a different category (or a fresh create
  // after a failed edit) always starts clean.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApiError(null);
    if (isEdit && category) {
      reset(mapCategoryToFormValues(category));
    } else {
      reset(categoryFormDefaults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category?.id, isEdit]);

  // Parent options: top-level only (parent_id === null), excluding self on
  // edit. Memoized against the slice data so it only recomputes when the
  // category list changes.
  const parentOptions = useMemo(() => {
    const topLevel = allCategories.filter((c) => c.parent_id === null);
    const excludingSelf = isEdit
      ? topLevel.filter((c) => c.id !== category?.id)
      : topLevel;
    return [
      { value: NO_PARENT, label: "None (top-level category)" },
      ...excludingSelf.map((c) => ({ value: c.id, label: c.name })),
    ];
  }, [allCategories, isEdit, category?.id]);

  const onSubmit = async (data) => {
    setApiError(null);

    const payload = isEdit
      ? buildCategoryPayload(data, dirtyFields)
      : buildCategoryPayload(data, null);

    // Belt-and-braces: edit with nothing dirty. Button is already disabled
    // but we don't want to PATCH empty payloads on any race.
    if (isEdit && Object.keys(payload).length === 0) {
      return;
    }

    try {
      const result = isEdit
        ? await updateCategory(category.id, payload)
        : await createCategory(payload);
      onSuccess(result);
    } catch (err) {
      const status = err.response?.status;
      const message =
        err.response?.data?.message ||
        err.message ||
        (isEdit ? "Couldn't update category." : "Couldn't create category.");

      // 409: name conflict at this level. Surface on the name field.
      if (status === 409) {
        setError("name", { type: "server", message });
        return;
      }

      // 400: usually "parent is not top-level" — could happen if the parent
      // list is stale (e.g. someone else deactivated the parent between our
      // fetch and submit). Surface on the parent field so admin sees where
      // to look.
      if (status === 400 && /parent/i.test(message)) {
        setError("parent_id", { type: "server", message });
        return;
      }

      // Everything else: banner at the top of the dialog body.
      setApiError(message);
    }
  };

  // Edit needs isDirty to enable Save. Create is always allowed to submit
  // (Zod will block empty name at validation time).
  const canSubmit = isEdit ? isDirty : true;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit category" : "Create category"}
      description={
        isEdit
          ? "Rename or reparent this category. Products keep their attribution."
          : "Add a new category. Names must be unique within the same parent."
      }
      size="sm"
      dismissible={!isSubmitting}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
            label="Cancel"
          />
          <Button
            type="submit"
            variant="accent"
            form="category-form"
            loading={isSubmitting}
            disabled={!canSubmit}
            label={isEdit ? "Save changes" : "Create"}
          />
        </>
      }
    >
      {apiError && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertCircle
            size={16}
            className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
          />
          <p className="text-xs text-red-700 dark:text-red-300">{apiError}</p>
        </div>
      )}

      <form
        id="category-form"
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-4"
        noValidate
      >
        <InputField
          label="Category name"
          required
          placeholder="e.g. Smartphones"
          error={errors.name?.message}
          autoFocus
          {...register("name")}
        />

        <Controller
          name="parent_id"
          control={control}
          render={({ field, fieldState }) => (
            <Select
              label="Parent category"
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              options={parentOptions}
              error={fieldState.error?.message}
              hint="Sub-categories go one level deep. Leave as top-level for a new root category."
            />
          )}
        />
      </form>
    </Dialog>
  );
};

export default CategoryFormDialog;
