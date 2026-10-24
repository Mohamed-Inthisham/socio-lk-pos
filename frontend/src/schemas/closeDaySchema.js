import { z } from "zod";
import { MONEY_SHAPE } from "./paymentSchema";
import { differenceCents, needsReason } from "../utils/cashDayMath";
import { toCents } from "../utils/money";

/**
 * Close Day Schema (Zod)
 *
 * Client-side validation for the POS CloseDayDialog (planning doc P9-11).
 * Mirrors the backend CloseCashDayDto and the rounding rule:
 *
 * - counted_balance: at least 0, at most 2 decimals, at most
 *   9999999999.99; whole rupees or cents, no sign or separators
 *   (MONEY_SHAPE, as PaymentDialog and OpenDayDialog).
 * - difference_reason: needed only when counted − expected is 1.00 or more
 *   either way (needsReason, the server's REASON_THRESHOLD_CENTS), then
 *   3–500 characters after trimming. Under 1.00 it is ignored: the dialog
 *   doesn't send it and the server would store null.
 *
 * Rebuilt for each expected balance (the server's string), so an
 * EXPECTED_CHANGED summary changes whether the reason is needed.
 */

export const COUNTED_MAX_CENTS = 999999999999;
export const REASON_MIN = 3;
export const REASON_MAX = 500;

export const COUNTED_SHAPE_MESSAGE = "Enter an amount like 15500 or 15499.50";
export const REASON_REQUIRED_MESSAGE = "Give a reason for the difference (at least 3 characters)";

export const buildCloseDaySchema = (expectedBalance) =>
  z
    .object({
      counted_balance: z
        .string()
        .trim()
        .min(1, "Enter the cash counted in the box")
        .regex(MONEY_SHAPE, COUNTED_SHAPE_MESSAGE)
        .refine(
          (v) => !MONEY_SHAPE.test(v) || toCents(v) <= COUNTED_MAX_CENTS,
          "Can't be more than LKR 9,999,999,999.99",
        ),
      difference_reason: z.string(),
    })
    .superRefine(({ counted_balance, difference_reason }, ctx) => {
      if (!MONEY_SHAPE.test(counted_balance)) return;
      if (!needsReason(differenceCents(toCents(counted_balance), expectedBalance))) return;
      const reason = difference_reason.trim();
      if (reason.length < REASON_MIN) {
        ctx.addIssue({ code: "custom", path: ["difference_reason"], message: REASON_REQUIRED_MESSAGE });
      } else if (reason.length > REASON_MAX) {
        ctx.addIssue({ code: "custom", path: ["difference_reason"], message: "Keep the reason to 500 characters" });
      }
    });
