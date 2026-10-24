import { z } from "zod";
import { MONEY_SHAPE } from "./paymentSchema";
import { toCents } from "../utils/money";

/**
 * Open Day Schema (Zod)
 *
 * Client-side validation for the POS OpenDayDialog (planning doc P9-7).
 * Mirrors the backend OpenCashDayDto: opening_balance at least 0, at most
 * 2 decimals, at most 9999999999.99. Typed as whole rupees ("5000") or
 * with cents ("5000.50"); 0 is allowed (an empty box). No sign and no
 * thousands separators, as in PaymentDialog (MONEY_SHAPE).
 */

export const OPENING_MAX_CENTS = 999999999999;

export const OPENING_SHAPE_MESSAGE = "Enter an amount like 5000 or 5000.50";

export const openDaySchema = z.object({
  opening_balance: z
    .string()
    .trim()
    .min(1, "Enter the cash in the box")
    .regex(MONEY_SHAPE, OPENING_SHAPE_MESSAGE)
    .refine((v) => toCents(v) <= OPENING_MAX_CENTS, "Can't be more than LKR 9,999,999,999.99"),
});
