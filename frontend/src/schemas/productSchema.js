import { z } from "zod";

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
 * CONDITIONAL PHONE FIELDS:
 * When product_type === "PHONE", we require phone_condition. Other
 * phone fields (model, storage, color, ram) are optional even for
 * phones — they're nice-to-have specs. When product_type !== "PHONE",
 * all phone fields are ignored on submit (see stripPhoneFields helper).
 */

// ============================================
// ENUMS
// ============================================

export const PRODUCT_TYPES = ["PHONE", "ACCESSORY", "WATCH", "SPEAKER", "CABLE", "BACKCOVER", "CHARGER", "HEADSET", "BATTERY", "OTHER"];
export const PHONE_CONDITIONS = ["NEW", "USED"];
export const BARCODE_TYPES = ["CODE_128", "EAN_13", "UPC_A", "CODE_39"];
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

// Optional positive integer. Empty string is treated as null/undefined.
const optionalPositiveInt = z
  .union([z.string().length(0), z.coerce.number().int().nonnegative()])
  .transform((v) => (v === "" ? undefined : v))
  .optional();

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
  product_type: z.enum(PRODUCT_TYPES, {
    errorMap: () => ({ message: "Select a product type" }),
  }),
  description: z
    .string()
    .max(2000, "Description is too long")
    .optional()
    .or(z.literal("")),

  // Classification
  brand_id: uuidString,
  category_id: uuidString,
  branch_id: uuidString,

  // Identification
  barcode: z
    .string()
    .max(64, "Barcode is too long")
    .optional()
    .or(z.literal("")),
  barcode_type: z.enum(BARCODE_TYPES).optional(),

  // Pricing
  buying_price: priceString,
  selling_price: priceString,

  // Warranty
  warranty_months: optionalPositiveInt,
  checking_warranty_days: optionalPositiveInt,

  // Serialization
  is_serialized: z.boolean().default(false),

  // Phone-specific (validated conditionally in sharedProductRefinements)
  phone_condition: z.enum(PHONE_CONDITIONS).optional().or(z.literal("")),
  phone_model: z.string().max(100).optional().or(z.literal("")),
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
  // Rule 1: selling price should be >= buying price (prevents obvious
  // data entry mistakes; equal values allowed).
  const buying = Number(data.buying_price);
  const selling = Number(data.selling_price);
  if (
    Number.isFinite(buying) &&
    Number.isFinite(selling) &&
    selling < buying
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Selling price is less than buying price",
      path: ["selling_price"],
    });
  }

  // Rule 2: phone_condition required when product_type === "PHONE"
  if (data.product_type === "PHONE" && !data.phone_condition) {
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
    "phone_model",
    "phone_storage",
    "phone_color",
    "phone_ram",
    "phone_condition",
  ];
  optionalFields.forEach((f) => {
    if (payload[f] === "" || payload[f] == null) delete payload[f];
  });

  // Drop unset warranty numbers (schema already transforms "" -> undefined,
  // but delete for a cleaner JSON payload)
  if (payload.warranty_months === undefined) delete payload.warranty_months;
  if (payload.checking_warranty_days === undefined)
    delete payload.checking_warranty_days;

  // If not a phone, strip all phone fields
  if (payload.product_type !== "PHONE") {
    delete payload.phone_condition;
    delete payload.phone_model;
    delete payload.phone_storage;
    delete payload.phone_color;
    delete payload.phone_ram;
    delete payload.checking_warranty_days;
  }

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
 * Two shape mismatches to handle:
 * - Backend returns nested { brand, category, branch } objects; form uses
 *   flat brand_id / category_id / branch_id.
 * - Backend returns null for unset optionals; form inputs need "" so the
 *   controlled components stay controlled.
 *
 * Number fields (warranty_months, checking_warranty_days) are stringified
 * because InputField type="number" still stores strings in RHF.
 */
export const mapProductToFormValues = (product) => ({
  name: product.name ?? "",
  product_type: product.product_type ?? "",
  description: product.description ?? "",
  brand_id: product.brand?.id ?? "",
  category_id: product.category?.id ?? "",
  branch_id: product.branch?.id ?? "",
  barcode: product.barcode ?? "",
  barcode_type: product.barcode_type ?? "CODE_128",
  buying_price: product.buying_price ?? "",
  selling_price: product.selling_price ?? "",
  warranty_months:
    product.warranty_months != null ? String(product.warranty_months) : "",
  checking_warranty_days:
    product.checking_warranty_days != null
      ? String(product.checking_warranty_days)
      : "",
  is_serialized: product.is_serialized ?? false,
  phone_condition: product.phone_condition ?? "",
  phone_model: product.phone_model ?? "",
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
 * If admin clears the barcode input, they mean "remove the barcode" —
 * we need to send null so the backend clears it. Compare to create,
 * where empty string means "never set it in the first place."
 */
export const buildUpdatePayload = (formData, dirtyFields) => {
  const payload = {};

  // Only include fields RHF flagged as dirty
  Object.keys(dirtyFields).forEach((key) => {
    if (dirtyFields[key]) {
      payload[key] = formData[key];
    }
  });

  // Nullable string fields: "" means "clear it"
  const nullableStringFields = [
    "description",
    "barcode",
    "phone_model",
    "phone_storage",
    "phone_color",
    "phone_ram",
    "phone_condition",
  ];
  nullableStringFields.forEach((f) => {
    if (payload[f] === "") payload[f] = null;
  });

  // Nullable number fields: "" or undefined means "clear it"
  ["warranty_months", "checking_warranty_days"].forEach((f) => {
    if (f in payload && (payload[f] === "" || payload[f] === undefined)) {
      payload[f] = null;
    }
  });

  // Barcode type is only meaningful if barcode is present
  if (payload.barcode === null) {
    payload.barcode_type = null;
  }

  return payload;
};

// ============================================
// FORM DEFAULT VALUES
// ============================================

export const productFormDefaults = {
  name: "",
  product_type: "",
  description: "",
  brand_id: "",
  category_id: "",
  branch_id: "",
  barcode: "",
  barcode_type: "CODE_128",
  buying_price: "",
  selling_price: "",
  warranty_months: "",
  checking_warranty_days: "",
  is_serialized: false,
  phone_condition: "",
  phone_model: "",
  phone_storage: "",
  phone_color: "",
  phone_ram: "",
};
