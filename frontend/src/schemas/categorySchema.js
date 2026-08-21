import { z } from "zod";

/**
 * Category Schemas (Zod)
 *
 * Client-side validation for category create/edit dialog. Mirrors the
 * backend DTO shape — same field names (snake_case), same types.
 *
 * TWO-LEVEL HIERARCHY:
 * Categories can be top-level (parent_id=null) or sub-categories
 * (parent_id points to a top-level category). Nesting deeper than two
 * levels is a 400 from the backend — the parent picker in the form
 * only shows top-level categories, so this is prevented client-side too.
 *
 * CASE-INSENSITIVE UNIQUENESS WITHIN A LEVEL:
 * Backend enforces uniqueness case-insensitively within the SAME parent.
 * "Cases" can exist under both "Phone Accessories" and "Watch Accessories".
 * Duplicate at the same level returns 409 Conflict — surfaced as a
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

// Sentinel value used by the parent select to represent "no parent"
// (top-level). Kept as an empty string so it plays nicely with HTML
// selects, then translated to null in buildCategoryPayload.
export const NO_PARENT = "";

// ============================================
// CATEGORY SCHEMA (shared create + edit)
// ============================================

/**
 * One schema for both create and edit. Category has no create-only or
 * edit-only fields — the only difference is which endpoint receives it.
 *
 * parent_id: empty string = top-level. UUID = sub-category.
 * Validated as EITHER an empty string OR a valid UUID.
 */
export const categorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Category name is required")
    .max(NAME_MAX, `Name is too long (max ${NAME_MAX} chars)`),
  parent_id: z.union([
    z.literal(NO_PARENT),
    z.string().uuid("Please select a valid parent"),
  ]),
});

// ============================================
// FORM DEFAULT VALUES
// ============================================

export const categoryFormDefaults = {
  name: "",
  parent_id: NO_PARENT,
};

// ============================================
// MAP BACKEND CATEGORY → FORM VALUES (edit mode)
// ============================================

/**
 * Convert a backend category response into RHF form values.
 *
 * parent_id: backend returns null for top-level; form uses "" so the
 * controlled select stays controlled.
 */
export const mapCategoryToFormValues = (category) => ({
  name: category?.name ?? "",
  parent_id: category?.parent_id ?? NO_PARENT,
});

// ============================================
// BUILD PAYLOAD (create + edit)
// ============================================

/**
 * Build the request payload. Dual-purpose:
 * - dirtyFields=null → create (send everything, hardcode sort_order=0)
 * - dirtyFields=object → edit (send only changed fields)
 *
 * parent_id translation:
 * - "" (NO_PARENT) → null (top-level)
 * - UUID string → passes through
 */
export const buildCategoryPayload = (formData, dirtyFields = null) => {
  // Helper — translates the form's empty-string sentinel to null for API
  const parentIdForApi = (v) => (v === NO_PARENT ? null : v);

  if (dirtyFields === null) {
    // Create: send everything the form manages, plus sort_order default
    return {
      name: formData.name.trim(),
      parent_id: parentIdForApi(formData.parent_id),
      sort_order: 0,
    };
  }

  // Edit: only include dirty fields
  const payload = {};
  if (dirtyFields.name) {
    payload.name = formData.name.trim();
  }
  if (dirtyFields.parent_id) {
    payload.parent_id = parentIdForApi(formData.parent_id);
  }
  return payload;
};
