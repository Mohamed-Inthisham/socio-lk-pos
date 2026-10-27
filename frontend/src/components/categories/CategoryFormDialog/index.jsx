import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import InputField from "../../common/InputField";
import {
  categorySchema,
  categoryFormDefaults,
  mapCategoryToFormValues,
  buildCategoryPayload,
} from "../../../schemas/categorySchema";
import {
  createCategory,
  updateCategory,
} from "../../../services/categoriesService";

/**
 * CategoryFormDialog
 *
 * Shared create/edit modal for categories. One component covers both flows
 * because category has no field that differs between create and edit — the
 * only difference is which endpoint receives the payload.
 *
 * 409 HANDLING:
 * A duplicate category name returns 409 Conflict; we surface
 * that as a field-level error on `name` instead of a generic banner.
 *
 * EDIT DIRTY-FIELD OPTIMIZATION:
 * Same PATCH semantics as brands/products: only dirty fields go on the
 * wire. Save button disabled unless isDirty.
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
  const [apiError, setApiError] = useState(null);

  const {
    register,
    handleSubmit,
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
          ? "Rename this category and manage its product defaults."
          : "Add a category. Names must be unique."
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

        <label className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            {...register("show_phone_specs")}
            className="mt-1"
          />
          Show phone specifications (condition, storage, RAM and colour)
        </label>
      </form>
    </Dialog>
  );
};

export default CategoryFormDialog;
