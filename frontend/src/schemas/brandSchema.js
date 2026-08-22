import { z } from "zod";

/**
 * Brand Schemas (Zod)
 *
 * Client-side validation for brand create/edit dialog. Mirrors the
 * backend DTO shape — same field names (snake_case), same types.
 *
 * BRAND IS TINY:
 * Only one editable field (name). is_active is managed via
 * deactivate/reactivate endpoints, not the form. We still use RHF+zod
 * for consistency with the rest of Path B and so 409-conflict errors
 * from the backend can be surfaced cleanly under the name input.
 *
 * CASE-INSENSITIVE UNIQUENESS:
 * Backend enforces uniqueness case-insensitively — creating "apple"
 * when "Apple" exists returns 409 Conflict. We can't check this
 * client-side (the brands slice may be stale), so we let submit fail
 * and translate the 409 into a field-level error in the dialog.
 */

// ============================================
// PRODUCT NAME LENGTH
// ============================================

// Backend max is ~100 based on typical string column sizing. If the
// backend changes this, the 400 validation response will surface.
const NAME_MAX = 100;

// ============================================
// BRAND SCHEMA (shared create + edit)
// ============================================

/**
 * One schema for both create and edit. Brand has no create-only or
 * edit-only fields — the only difference is which endpoint receives it.
 */
export const brandSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Brand name is required")
    .max(NAME_MAX, `Name is too long (max ${NAME_MAX} chars)`),
});

// ============================================
// FORM DEFAULT VALUES
// ============================================

export const brandFormDefaults = {
  name: "",
};

// ============================================
// MAP BACKEND BRAND → FORM VALUES (edit mode)
// ============================================

/**
 * Convert a backend brand response into RHF form values. Null-safe so
 * a partial brand object (e.g. from an optimistic update) still works.
 */
export const mapBrandToFormValues = (brand) => ({
  name: brand?.name ?? "",
});

// ============================================
// BUILD PAYLOAD (create + edit)
// ============================================

/**
 * Build the request payload. For create, we send the full form.
 * For edit, we trust RHF's dirtyFields to only send what changed —
 * matches the buildUpdatePayload pattern in productSchema.js.
 *
 * Both callers can use this: pass dirtyFields=null for create (send
 * everything), pass RHF's dirtyFields for edit (send only changes).
 */
export const buildBrandPayload = (formData, dirtyFields = null) => {
  if (dirtyFields === null) {
    // Create: send everything the form manages
    return { name: formData.name.trim() };
  }

  // Edit: only include dirty fields
  const payload = {};
  if (dirtyFields.name) {
    payload.name = formData.name.trim();
  }
  return payload;
};
