import { z } from "zod";
import { DEFAULT_WARRANTY, WARRANTY_CODES } from "../constants/warranty";

/**
 * Product Schemas (Zod)
 *
 * Client-side validation for product create/edit forms. Mirrors the
 * backend DTO shape from Swagger — same field names (snake_case), same
 * types, same nullability.
 *
 * PRICE HANDLING:
 * Prices are strings in the DB (numeric(10,2) → TypeScript string) to
 * avoid JS float rounding. We store form values as strings, validate
 * that they parse to a valid non-negative number with at most 2
 * decimal places, and send strings to the backend.
 *
 * Category settings control optional phone specifications. Model is shared
 * by all products. Individual identifiers are captured during future GRN.
 */

// ============================================
// ENUMS
// ============================================

export const PHONE_CONDITIONS = ["NEW", "USED"];
export const BARCODE_TYPES = ["CODE_128", "EAN_13"];
// Phone specs — common values only. Schema still accepts any string on these
// fields (phone_storage, phone_ram) since manufacturers occasionally use
// non-standard values. The dropdown just gives fast entry for the 95% case.
export const PHONE_STORAGE_OPTIONS = [
  "16GB",
  "32GB",
  "64GB",
  "128GB",
  "256GB",
  "512GB",
  "1TB",
];

export const PHONE_RAM_OPTIONS = [
  "1GB",
  "2GB",
  "3GB",
  "4GB",
  "6GB",
  "8GB",
  "12GB",
  "16GB",
];
// ============================================
// FIELD SCHEMAS
// ============================================

// Price: string form value, must parse to non-negative number with <=2 decimals.
// Kept as string throughout — never converted to Number, so no float precision loss.
const priceString = z
  .string()
  .min(1, "Required")
  .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid price (max 2 decimals)")
  .refine((v) => Number(v) >= 0, "Price can't be negative")
  .refine((v) => Number(v) < 10_000_000_000, "Price is too large");

// UUID from the reference-data selects
const uuidString = z.string().uuid("Please select an option");

// ============================================
// PRODUCT BASE SCHEMA
// ============================================

/**
 * Raw object shape shared by create and edit.
 *
 * Kept as a plain ZodObject (not wrapped in .superRefine yet) so both
 * productCreateSchema and productEditSchema can .extend() from it and
 * then apply the shared refinements below.
 */
const productBaseSchema = z.object({
  // Basics
  name: z
    .string()
    .min(1, "Product name is required")
    .max(200, "Name is too long (max 200 chars)"),
  model: z.string().trim().max(100).optional().or(z.literal("")),
  show_phone_specs: z.boolean().default(false),
  description: z
    .string()
    .max(2000, "Description is too long")
    .optional()
    .or(z.literal("")),

  // Classification
  brand_id: uuidString,
  category_id: uuidString,

  // Identification
  barcode: z
    .string()
    .max(64, "Barcode is too long")
    .optional()
    .or(z.literal("")),
  barcode_type: z.enum(BARCODE_TYPES).optional(),

  // Pricing
  selling_price: priceString.optional().or(z.literal("")),

  // Warranty (P5-18): the period a sale line starts with
  default_warranty: z.enum(WARRANTY_CODES, {
    errorMap: () => ({ message: "Select a warranty" }),
  }),

  // Phone-specific (validated conditionally in sharedProductRefinements)
  phone_condition: z.enum(PHONE_CONDITIONS).optional().or(z.literal("")),
  phone_storage: z.string().max(50).optional().or(z.literal("")),
  phone_color: z.string().max(50).optional().or(z.literal("")),
  phone_ram: z.string().max(50).optional().or(z.literal("")),
});

/**
 * Cross-field validation rules shared by create and edit.
 *
 * Extracted as a plain function so it can be passed to .superRefine on
 * both schemas without duplication.
 */
const sharedProductRefinements = (data, ctx) => {
  // Condition is required when category specifications are enabled.
  if (data.show_phone_specs && !data.phone_condition) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Condition is required for phones",
      path: ["phone_condition"],
    });
  }
};

// ============================================
// PRODUCT CREATE SCHEMA
// ============================================

export const productCreateSchema = productBaseSchema.superRefine(
  sharedProductRefinements,
);

// ============================================
// PRODUCT EDIT SCHEMA
// ============================================

/**
 * Edit adds one field: SKU (admin can override on update).
 *
 * Built from productBaseSchema.extend({ sku }) instead of extending
 * productCreateSchema, because .extend() only works on ZodObject and
 * productCreateSchema is a ZodEffects (post-.superRefine).
 */
export const productEditSchema = productBaseSchema
  .extend({
    // Every saved product has a barcode (NOT NULL; auto-generated when left
    // blank on create), so the edit form can change it but not clear it.
    barcode: z
      .string()
      .trim()
      .min(1, "Barcode is required")
      .max(64, "Barcode is too long"),
    sku: z
      .string()
      .min(1, "SKU is required")
      .max(64, "SKU is too long")
      .regex(
        /^[A-Z0-9-]+$/,
        "SKU must be uppercase letters, numbers, or hyphens",
      ),
  })
  .superRefine(sharedProductRefinements);

// ============================================
// PAYLOAD BUILDER
// ============================================

/**
 * Strip empty strings and phone-only fields (when not a phone) before sending
 * to the backend. The backend DTO uses class-validator with whitelist=true so
 * unknown fields are dropped, but sending empty strings for optional fields
 * confuses some validators — clean them up here.
 */
export const buildCreatePayload = (data) => {
  const payload = { ...data };

  // Drop empty-string optionals
  const optionalFields = [
    "description",
    "barcode",
    "model",
    "selling_price",
    "phone_storage",
    "phone_color",
    "phone_ram",
    "phone_condition",
  ];
  optionalFields.forEach((f) => {
    if (payload[f] === "" || payload[f] == null) delete payload[f];
  });

  // Category settings control phone specifications, never the shared model.
  if (!payload.show_phone_specs) {
    delete payload.phone_condition;
    delete payload.phone_storage;
    delete payload.phone_color;
    delete payload.phone_ram;
  }

  delete payload.show_phone_specs;

  // Default barcode_type only if barcode is present
  if (payload.barcode && !payload.barcode_type) {
    payload.barcode_type = "CODE_128";
  } else if (!payload.barcode) {
    delete payload.barcode_type;
  }

  return payload;
};

// ============================================
// EDIT: MAP BACKEND PRODUCT → FORM VALUES
// ============================================

/**
 * Convert a backend product response into RHF form values.
 *
 * Backend returns nested { brand, category } objects; form uses flat IDs.
 * - Backend returns null for unset optionals; form inputs need "" so the
 *   controlled components stay controlled.
 */
export const mapProductToFormValues = (product) => ({
  name: product.name ?? "",
  model:
    (product.model === undefined ? product.phone_model : product.model) ?? "",
  show_phone_specs: product.category?.show_phone_specs ?? false,
  description: product.description ?? "",
  brand_id: product.brand?.id ?? "",
  category_id: product.category?.id ?? "",
  barcode: product.barcode ?? "",
  barcode_type: product.barcode_type ?? "CODE_128",
  selling_price: product.selling_price ?? "",
  default_warranty: product.default_warranty ?? DEFAULT_WARRANTY,
  phone_condition: product.phone_condition ?? "",
  phone_storage: product.phone_storage ?? "",
  phone_color: product.phone_color ?? "",
  phone_ram: product.phone_ram ?? "",
  sku: product.sku ?? "",
});

// ============================================
// EDIT: BUILD UPDATE PAYLOAD
// ============================================

/**
 * Build the PATCH payload from RHF form data + dirtyFields.
 *
 * WHY DIRTY FIELDS ONLY:
 * PATCH semantics: absent field = "don't touch", null = "clear it".
 * By only sending fields the admin actually changed, we get:
 * - Smaller network payloads
 * - Cleaner audit trail (which fields changed, per update)
 * - No accidental overwrites of concurrent edits
 *
 * WHY EMPTY STRINGS → null (NOT "delete field"):
 * If admin clears an optional text input (description, phone details),
 * they mean "remove it" — we need to send null so the backend clears it.
 * Compare to create, where empty string means "never set it in the first
 * place." Only nullable columns get null: the API rejects null on NOT
 * NULL ones (400), so barcode is required by productEditSchema instead.
 */
export const buildUpdatePayload = (formData, dirtyFields) => {
  const payload = {};

  // Only include fields RHF flagged as dirty
  Object.keys(dirtyFields).forEach((key) => {
    if (dirtyFields[key] && key !== "show_phone_specs") {
      payload[key] = formData[key];
    }
  });

  // Nullable string fields: "" means "clear it"
  const nullableStringFields = [
    "description",
    "model",
    "selling_price",
    "phone_storage",
    "phone_color",
    "phone_ram",
    "phone_condition",
  ];
  nullableStringFields.forEach((f) => {
    if (payload[f] === "") payload[f] = null;
  });

  return payload;
};

// ============================================
// FORM DEFAULT VALUES
// ============================================

export const productFormDefaults = {
  name: "",
  model: "",
  show_phone_specs: false,
  description: "",
  brand_id: "",
  category_id: "",
  barcode: "",
  barcode_type: "CODE_128",
  selling_price: "",
  default_warranty: DEFAULT_WARRANTY,
  phone_condition: "",
  phone_storage: "",
  phone_color: "",
  phone_ram: "",
};
