import { z } from "zod";

/**
 * Category Schemas (Zod)
 *
 * Client-side validation for category create/edit dialog. Mirrors the
 * backend DTO shape — same field names (snake_case), same types.
 *
 * CASE-INSENSITIVE UNIQUENESS:
 * Backend enforces category name uniqueness case-insensitively.
 * Duplicate names return 409 Conflict — surfaced as a
 * field-level error on `name` in the dialog.
 *
 * SORT_ORDER:
 * Hidden from the form in R1 (categories only appear in admin dropdowns;
 * ordering matters when the list grows or when customers see it). Create
 * hardcodes sort_order=0; edit omits it from the payload.
 */

// ============================================
// CONSTANTS
// ============================================

// Backend max is ~100 based on typical string column sizing. If the
// backend changes this, the 400 validation response will surface.
const NAME_MAX = 100;

// ============================================
// CATEGORY SCHEMA (shared create + edit)
// ============================================

/**
 * One schema for both create and edit. Category has no create-only or
 * edit-only fields — the only difference is which endpoint receives it.
 *
 */
export const categorySchema = z.object({
  show_phone_specs: z.boolean().default(false),
  name: z
    .string()
    .trim()
    .min(1, "Category name is required")
    .max(NAME_MAX, `Name is too long (max ${NAME_MAX} chars)`),
});

// ============================================
// FORM DEFAULT VALUES
// ============================================

export const categoryFormDefaults = {
  show_phone_specs: false,
  name: "",
};

// ============================================
// MAP BACKEND CATEGORY → FORM VALUES (edit mode)
// ============================================

/**
 * Convert a backend category response into RHF form values.
 *
 */
export const mapCategoryToFormValues = (category) => ({
  show_phone_specs: category?.show_phone_specs ?? false,
  name: category?.name ?? "",
});

// ============================================
// BUILD PAYLOAD (create + edit)
// ============================================

/**
 * Build the request payload. Dual-purpose:
 * - dirtyFields=null → create (send everything, hardcode sort_order=0)
 * - dirtyFields=object → edit (send only changed fields)
 *
 */
export const buildCategoryPayload = (formData, dirtyFields = null) => {
  if (dirtyFields === null) {
    // Create: send everything the form manages, plus sort_order default
    return {
      name: formData.name.trim(),
      parent_id: null,
      sort_order: 0,
      show_phone_specs: formData.show_phone_specs,
    };
  }

  // Edit: only include dirty fields
  const payload = {};
  if (dirtyFields.name) {
    payload.name = formData.name.trim();
  }
  for (const key of ["show_phone_specs"]) {
    if (dirtyFields[key]) payload[key] = formData[key];
  }
  return payload;
};
