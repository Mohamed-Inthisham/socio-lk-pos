import { z } from "zod";
import { PIN_PATTERN, WEAK_PIN_MESSAGE, isWeakPin } from "../utils/pin";

/**
 * Approval PIN Schema (Zod)
 *
 * Client-side validation for ApprovalPinDialog (planning doc P6-18).
 * Mirrors SetApprovalPinDto + ApprovalsService.setOwnPin:
 * - current_password: required, at most 72 characters (bcrypt's limit)
 * - pin: exactly 6 digits, and not one of the 20 weak PINs (utils/pin.js)
 * - confirm_pin: must equal pin; never sent
 *
 * The password and PIN live only in the dialog's form while it is open:
 * never in Redux, storage or logs.
 */

export const PIN_MISMATCH_MESSAGE = "The PINs don't match";

export const approvalPinSchema = z
  .object({
    current_password: z
      .string()
      .min(1, "Enter your current password")
      .max(72, "That password is too long"),
    pin: z
      .string()
      .regex(PIN_PATTERN, "The PIN must be 6 digits")
      .refine((v) => !isWeakPin(v), WEAK_PIN_MESSAGE),
    confirm_pin: z.string().min(1, "Enter the PIN again"),
  })
  // An empty confirmation has its own message ("Enter the PIN again").
  .refine((v) => v.confirm_pin === "" || v.confirm_pin === v.pin, {
    path: ["confirm_pin"],
    message: PIN_MISMATCH_MESSAGE,
  });

export const approvalPinDefaults = { current_password: "", pin: "", confirm_pin: "" };

/** Validated values → PUT /auth/me/approval-pin body (no confirm_pin). */
export const buildApprovalPinPayload = (values) => ({
  current_password: values.current_password,
  pin: values.pin,
});
