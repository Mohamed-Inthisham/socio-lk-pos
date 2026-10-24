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
 * - TRADE_IN (P4): no Amount field. One "Trade-in value"
 *   (trade_in_buying_price, empty by default, P4-5) is sent as both
 *   `amount` and `trade_in_buying_price` (the backend requires them
 *   equal), so it carries the balance-due cap (P4-4). Product required;
 *   IMEI 8–50 letters/digits (the backend's rule, P4-7) and not already
 *   on another trade-in on this sale; resale price optional, > 0 when
 *   given (P4-6); condition notes optional.
 *
 * Money is compared in integer cents (P3-9). Form values are strings
 * (what the inputs hold); buildPaymentPayload turns them into the
 * numbers the API takes. Client validation is a convenience — the
 * server stays authoritative.
 */

export const CASH = "CASH";
export const TRADE_IN = "TRADE_IN";
export const REFERENCE_METHODS = ["CARD", "BANK_TRANSFER", "KOKO", "MINTPAY"];
const REFERENCE_MAX = 100;

export const CASH_SHORT_MESSAGE = "Cash received is less than the amount";
export const DUPLICATE_IMEI_MESSAGE = "This IMEI is already on another trade-in on this sale";

// Up to 2 decimals, no sign, no thousands separators.
export const MONEY_SHAPE = /^\d+(\.\d{1,2})?$/;
// AddPaymentDto trade_in_imei: 8–50 letters or digits.
export const IMEI_SHAPE = /^[A-Za-z0-9]{8,50}$/;

/** IMEIs compare case-insensitively, after trimming. */
export const normalizeImei = (imei) => String(imei ?? "").trim().toUpperCase();

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
 * `tradeInImeis`: IMEIs already on this sale's trade-ins (recorded and
 * pending, selectTradeInImeis) — a second trade-in can't reuse one.
 */
export const buildPaymentSchema = (balanceDue, { tradeInImeis = [] } = {}) => {
  const balanceCents = toCents(balanceDue);
  const balanceText = formatLKR(fromCents(balanceCents));
  const takenImeis = new Set(tradeInImeis.map(normalizeImei));

  const amount = money("Enter an amount")
    .refine((v) => toCents(v) > 0, "Amount must be more than 0")
    .refine(
      (v) => toCents(v) <= balanceCents,
      `Can't be more than the balance due (${balanceText})`,
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

  // No `amount` here: the trade-in value is the amount (P4-1).
  const tradeIn = z.object({
    payment_method: z.literal(TRADE_IN),
    trade_in_product_id: z.string().min(1, "Pick the trade-in product"),
    trade_in_imei: z
      .string()
      .trim()
      .min(1, "Enter the IMEI")
      .regex(IMEI_SHAPE, "IMEI must be 8–50 letters or digits")
      .refine((v) => !takenImeis.has(normalizeImei(v)), DUPLICATE_IMEI_MESSAGE),
    trade_in_buying_price: money("Enter the trade-in value")
      .refine((v) => toCents(v) > 0, "Trade-in value must be more than 0")
      .refine(
        (v) => toCents(v) <= balanceCents,
        `Trade-in value can't exceed the balance due (${balanceText}). Add items, or record the phone purchase separately.`,
      ),
    trade_in_selling_price: z
      .string()
      .trim()
      .refine((v) => v === "" || MONEY_SHAPE.test(v), "Enter an amount like 1500 or 1499.80")
      .refine((v) => v === "" || toCents(v) > 0, "Resale price must be more than 0"),
    trade_in_notes: z.string().trim(),
  });

  return z.discriminatedUnion("payment_method", [cash, ...referenced, tradeIn]);
};

/**
 * Fresh form values: CASH (§6: F4 defaults to CASH), amount = balance
 * due. The trade-in value starts empty (P4-5): it becomes the unit's cost.
 */
export const paymentFormDefaults = (balanceDue) => ({
  payment_method: CASH,
  amount: balanceDue ?? "",
  cash_received: "",
  reference_number: "",
  trade_in_product_id: "",
  trade_in_imei: "",
  trade_in_buying_price: "",
  trade_in_selling_price: "",
  trade_in_notes: "",
});

const toNumber = (value) => Number(fromCents(toCents(value)));

const tradeInPayload = (values) => {
  const value = toNumber(values.trade_in_buying_price);
  const sellingPrice = values.trade_in_selling_price.trim();
  const notes = values.trade_in_notes.trim();
  return {
    payment_method: TRADE_IN,
    amount: value,
    trade_in_product_id: values.trade_in_product_id,
    trade_in_imei: values.trade_in_imei.trim(),
    trade_in_buying_price: value,
    ...(sellingPrice ? { trade_in_selling_price: toNumber(sellingPrice) } : {}),
    ...(notes ? { trade_in_notes: notes } : {}),
  };
};

/** Validated form values → AddPaymentDto body (numbers, method-specific fields only). */
export const buildPaymentPayload = (values) => {
  if (values.payment_method === TRADE_IN) return tradeInPayload(values);
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
