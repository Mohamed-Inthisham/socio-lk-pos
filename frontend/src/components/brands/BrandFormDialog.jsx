import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import Dialog from "../common/Dialog";
import Button from "../common/Button";
import InputField from "../common/InputField";
import {
  brandSchema,
  brandFormDefaults,
  mapBrandToFormValues,
  buildBrandPayload,
} from "../../schemas/brandSchema";
import { createBrand, updateBrand } from "../../services/brandsService";

/**
 * BrandFormDialog
 *
 * Shared create/edit modal for brands. One component covers both flows
 * because brand has no field that differs between create and edit — the
 * only difference is which endpoint receives the payload.
 *
 * PROPS:
 * - open: boolean, whether the dialog is visible
 * - onClose: () => void, called on dismiss (Escape, backdrop, X, Cancel)
 * - onSuccess: (brand) => void, called with the created/updated brand
 * - mode: "create" | "edit"
 * - brand: the brand to edit (required for mode="edit", ignored for create)
 *
 * COPY BY MODE:
 * - Title: "Create brand" / "Edit brand"
 * - Submit: "Create" / "Save changes"
 * - Success handler receives the fresh brand for the parent to refetch or
 *   optimistically update the list.
 *
 * 409 HANDLING:
 * Backend enforces case-insensitive uniqueness. When the API returns 409,
 * we surface the message as a field-level error on `name` instead of a
 * generic banner — same input field the admin needs to change anyway.
 *
 * EDIT DIRTY-FIELD OPTIMIZATION:
 * Same PATCH semantics as products: only dirty fields go on the wire.
 * If the admin opens Edit and clicks Save without changing anything,
 * the button is disabled (isDirty=false). Belt-and-braces: if somehow
 * an empty PATCH is submitted, we bail early.
 */

const BrandFormDialog = ({
  open,
  onClose,
  onSuccess,
  mode = "create",
  brand = null,
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
    resolver: zodResolver(brandSchema),
    defaultValues: brandFormDefaults,
    mode: "onBlur",
    reValidateMode: "onChange",
  });

  // Reset form state whenever the dialog opens or the target brand changes.
  // Ensures reopening for a different brand (or a fresh create after a
  // failed edit) starts clean, not with stale state from the previous
  // session. Both setApiError and reset() are the intended synchronization
  // — dialog visibility is the external condition we're syncing to — so
  // the set-state-in-effect warning is a React 19 false positive here.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApiError(null);
    if (isEdit && brand) {
      reset(mapBrandToFormValues(brand));
    } else {
      reset(brandFormDefaults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, brand?.id, isEdit]);

  const onSubmit = async (data) => {
    setApiError(null);

    const payload = isEdit
      ? buildBrandPayload(data, dirtyFields)
      : buildBrandPayload(data, null);

    // Belt-and-braces: edit with nothing dirty. Button is already disabled
    // but we don't want to POST empty payloads on any race.
    if (isEdit && Object.keys(payload).length === 0) {
      return;
    }

    try {
      const result = isEdit
        ? await updateBrand(brand.id, payload)
        : await createBrand(payload);
      onSuccess(result);
    } catch (err) {
      const status = err.response?.status;
      const message =
        err.response?.data?.message ||
        err.message ||
        (isEdit ? "Couldn't update brand." : "Couldn't create brand.");

      // 409: case-insensitive name conflict. Surface on the field.
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
      title={isEdit ? "Edit brand" : "Create brand"}
      description={
        isEdit
          ? "Rename this brand. Products keep their attribution."
          : "Add a new brand. Names must be unique."
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
            form="brand-form"
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

      <form id="brand-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <InputField
          label="Brand name"
          required
          placeholder="e.g. Apple"
          error={errors.name?.message}
          autoFocus
          {...register("name")}
        />
      </form>
    </Dialog>
  );
};;

export default BrandFormDialog;
