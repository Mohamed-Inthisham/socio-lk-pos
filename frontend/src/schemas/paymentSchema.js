import { z } from "zod";
import { formatLKR, fromCents, toCents } from "../utils/money";

/**
 * Payment Schemas (Zod)
 *
 * Client-side validation for the POS PaymentDialog. Mirrors the backend
 * AddPaymentDto + SalesService rules (planning doc §7, P3 recon):
 *
 * - amount: required, > 0, at most 2 decimals, and never more than the
 *   balance due — for every method, CASH included (the backend rejects
 *   overpayment; CASH's excess goes in cash_received as change).
 * - CASH: cash_received required and ≥ amount.
 * - CARD / BANK_TRANSFER / KOKO / MINTPAY: reference_number required
 *   (1–100 chars after trimming); cash_received not sent.
 *
 * Money is compared in integer cents (P3-9). Form values are strings
 * (what the inputs hold); buildPaymentPayload turns them into the
 * numbers the API takes. Client validation is a convenience — the
 * server stays authoritative.
 */

export const CASH = "CASH";
export const REFERENCE_METHODS = ["CARD", "BANK_TRANSFER", "KOKO", "MINTPAY"];
const REFERENCE_MAX = 100;

export const CASH_SHORT_MESSAGE = "Cash received is less than the amount";

// Up to 2 decimals, no sign, no thousands separators.
const MONEY_SHAPE = /^\d+(\.\d{1,2})?$/;

const isMoney = (value) => MONEY_SHAPE.test(String(value ?? "").trim());

/**
 * Live change for the CASH form: cash received − amount, in integer cents
 * (P3-9). Negative when the cash is short. null while either input is
 * blank or not a valid amount, so the dialog shows nothing yet.
 */
export const computeChangeCents = (amount, cashReceived) =>
  isMoney(amount) && isMoney(cashReceived)
    ? toCents(String(cashReceived).trim()) - toCents(String(amount).trim())
    : null;

const money = (requiredMessage) =>
  z
    .string()
    .trim()
    .min(1, requiredMessage)
    .regex(MONEY_SHAPE, "Enter an amount like 1500 or 1499.80");

/**
 * Build the schema for the current balance due ("1499.80"). Rebuilt when
 * the balance changes so the upper bound is always the server's figure.
 */
export const buildPaymentSchema = (balanceDue) => {
  const balanceCents = toCents(balanceDue);

  const amount = money("Enter an amount")
    .refine((v) => toCents(v) > 0, "Amount must be more than 0")
    .refine(
      (v) => toCents(v) <= balanceCents,
      `Can't be more than the balance due (${formatLKR(fromCents(balanceCents))})`,
    );

  const cash = z
    .object({
      payment_method: z.literal(CASH),
      amount,
      cash_received: money("Enter the cash received"),
    })
    .refine(
      (v) => (computeChangeCents(v.amount, v.cash_received) ?? 0) >= 0,
      { path: ["cash_received"], message: CASH_SHORT_MESSAGE },
    );

  const referenced = REFERENCE_METHODS.map((method) =>
    z.object({
      payment_method: z.literal(method),
      amount,
      reference_number: z
        .string()
        .trim()
        .min(1, "Enter the reference number")
        .max(REFERENCE_MAX, `Reference must be ${REFERENCE_MAX} characters or fewer`),
    }),
  );

  return z.discriminatedUnion("payment_method", [cash, ...referenced]);
};

/** Fresh form values: CASH (§6: F4 defaults to CASH), amount = balance due. */
export const paymentFormDefaults = (balanceDue) => ({
  payment_method: CASH,
  amount: balanceDue ?? "",
  cash_received: "",
  reference_number: "",
});

const toNumber = (value) => Number(fromCents(toCents(value)));

/** Validated form values → AddPaymentDto body (numbers, method-specific fields only). */
export const buildPaymentPayload = (values) => {
  const payload = {
    payment_method: values.payment_method,
    amount: toNumber(values.amount),
  };
  if (values.payment_method === CASH) {
    payload.cash_received = toNumber(values.cash_received);
  } else {
    payload.reference_number = values.reference_number.trim();
  }
  return payload;
};
