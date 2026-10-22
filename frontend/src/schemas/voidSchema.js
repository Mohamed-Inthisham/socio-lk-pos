import { z } from "zod";

/**
 * Void Schema (Zod)
 *
 * Client-side validation for the POS VoidSaleDialog (planning doc P6-9,
 * P6-17, P6-20). Mirrors the backend VoidSaleDto + ApprovalDto:
 *
 * - Reason: one of six presets (keys 1–6) plus an optional detail,
 *   required for Other. Sent as one `void_reason`: "Wrong price — <detail>",
 *   the preset alone, or the detail alone for Other. The backend takes
 *   3–500 characters after trimming (VoidSaleDto @MaxLength(500)); the
 *   presets are all longer than 3, so Other's detail needs at least 3.
 *   The 500 limit is checked on the composed reason with JS string
 *   length, which is never shorter than the backend's count, so a reason
 *   that passes here never fails there.
 * - Approval: an approver from GET /approvers and their PIN, exactly 6
 *   digits. No weak-PIN rule here: that applies when a PIN is set (D1).
 *
 * The PIN lives only in the form while the dialog is open: never in
 * Redux or local storage, cleared after every attempt (P6-20).
 */

export const OTHER = "OTHER";
export const VOID_REASON_MAX = 500;
const OTHER_DETAIL_MIN = 3;

export const VOID_REASONS = [
  { key: "1", value: "CUSTOMER_RETURNED", label: "Customer returned the items" },
  { key: "2", value: "WRONG_ITEM", label: "Wrong item rung up" },
  { key: "3", value: "WRONG_PRICE", label: "Wrong price" },
  { key: "4", value: "DUPLICATE", label: "Duplicate sale" },
  { key: "5", value: "PAYMENT_FAILED", label: "Payment failed" },
  { key: "6", value: OTHER, label: "Other" },
];

const PIN_SHAPE = /^\d{6}$/;

const labelOf = (preset) => VOID_REASONS.find((r) => r.value === preset)?.label ?? "";

/**
 * The `void_reason` sent for a preset and detail: "Wrong price — <detail>",
 * the preset alone without a detail, the detail alone for Other.
 */
export const buildVoidReason = ({ reason_preset, reason_detail }) => {
  const detail = String(reason_detail ?? "").trim();
  if (reason_preset === OTHER) return detail;
  const label = labelOf(reason_preset);
  return detail ? `${label} — ${detail}` : label;
};

export const voidSchema = z
  .object({
    reason_preset: z.enum(
      VOID_REASONS.map((r) => r.value),
      { error: "Pick a reason" },
    ),
    reason_detail: z.string(),
    approver_id: z.string().min(1, "Pick who approves"),
    pin: z.string().regex(PIN_SHAPE, "PIN must be 6 digits"),
  })
  .superRefine((values, ctx) => {
    const detail = values.reason_detail.trim();
    if (values.reason_preset === OTHER && detail.length < OTHER_DETAIL_MIN) {
      ctx.addIssue({
        code: "custom",
        path: ["reason_detail"],
        message: "Say what happened (at least 3 characters)",
      });
      return;
    }
    const length = buildVoidReason(values).length;
    if (length > VOID_REASON_MAX) {
      ctx.addIssue({
        code: "custom",
        path: ["reason_detail"],
        message: `The reason must be ${VOID_REASON_MAX} characters or fewer (now ${length})`,
      });
    }
  });

/**
 * Fresh form values. `approverId`: the session's manager or admin when
 * they're on the approver list, "" otherwise (a cashier's session, P6-20).
 */
export const voidFormDefaults = ({ approverId = "" } = {}) => ({
  reason_preset: "",
  reason_detail: "",
  approver_id: approverId,
  pin: "",
});

/** Validated form values → POST /sales/:id/void body. */
export const buildVoidPayload = (values) => ({
  void_reason: buildVoidReason(values),
  approval: { approver_id: values.approver_id, pin: values.pin },
});
