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
// PRODUCT CREATE SCHEMA
// ============================================

export const productCreateSchema = z
  .object({
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

    // Phone-specific (validated conditionally below via .superRefine)
    phone_condition: z.enum(PHONE_CONDITIONS).optional().or(z.literal("")),
    phone_model: z.string().max(100).optional().or(z.literal("")),
    phone_storage: z.string().max(50).optional().or(z.literal("")),
    phone_color: z.string().max(50).optional().or(z.literal("")),
    phone_ram: z.string().max(50).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    // Rule 1: selling price should be >= buying price (warning-level in
    // real business, but we make it an error to prevent obvious data entry
    // mistakes. Admin can override by entering equal values if intentional.)
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
    if (data.product_type === "PHONE") {
      if (!data.phone_condition) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Condition is required for phones",
          path: ["phone_condition"],
        });
      }
    }
  });

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
