import { fromCents, toCents } from "./money";

/**
 * Line discounts (planning doc P5-20). The server resolves the money
 * (discount_amount, line_total); these helpers only describe a line's
 * discount and preview one before it's applied, with the server's math:
 * integer cents, PERCENT half-up on the exact value.
 *
 * Types (the backend's DiscountType):
 * - PERCENT: value 0–100 off unit price × qty
 * - UNIT_PRICE: value = the final price per unit, 0 to the unit price
 * - AMOUNT: value = LKR off the line (not offered by the till; older lines)
 */

export const DISCOUNT_PERCENT = "PERCENT";
export const DISCOUNT_UNIT_PRICE = "UNIT_PRICE";

/** basisCents × percent / 100, half-up on the exact value (the backend's percentOfCentsHalfUp). */
export const percentOfCentsHalfUp = (baseCents, percent) => {
  const hundredths = BigInt(Math.round(Number(percent) * 100));
  return Number((BigInt(baseCents) * hundredths + 5000n) / 10000n);
};

/** "20.00" → "20", "12.50" → "12.5" (for labels and the dialog's field). */
export const trimNumber = (value) => String(Number(value));

export const hasDiscount = (line) =>
  !!line?.discount_type && Number(line.discount_amount ?? 0) > 0;

/**
 * The line's price per unit after its discount, as "160.00"; null when it
 * has none. PERCENT is applied to one unit (display only — the line total
 * is the server's).
 */
export const discountedUnitPrice = (line) => {
  if (!hasDiscount(line)) return null;
  const unitCents = toCents(line.unit_price);
  if (line.discount_type === DISCOUNT_UNIT_PRICE) return fromCents(toCents(line.discount_value));
  if (line.discount_type === DISCOUNT_PERCENT) {
    return fromCents(unitCents - percentOfCentsHalfUp(unitCents, line.discount_value));
  }
  return fromCents(Math.round((toCents(line.line_total) || 0) / line.quantity));
};

/**
 * Short form for badges and the receipt: "20%" / "160.00 each" (amount
 * already formatted by `formatAmount`); null for AMOUNT or no discount.
 */
export const discountShortLabel = (line, formatAmount = (v) => v) => {
  if (!hasDiscount(line)) return null;
  if (line.discount_type === DISCOUNT_PERCENT) return `${trimNumber(line.discount_value)}%`;
  if (line.discount_type === DISCOUNT_UNIT_PRICE) return `${formatAmount(line.discount_value)} each`;
  return null;
};

const MONEY_INPUT = /^\d+(\.\d{0,2})?$/;

/**
 * Preview a discount the cashier is typing (LineDiscountDialog).
 * Returns { error } or { offCents, totalCents, subtotalCents, none } where
 * `none` means it takes nothing off (0%, or the price each equals the
 * unit price): applying it removes the discount.
 */
export const previewDiscount = ({ unitPrice, quantity, mode, input }) => {
  const raw = String(input ?? "").trim();
  const unitCents = toCents(unitPrice);
  const subtotalCents = unitCents * quantity;

  if (mode === DISCOUNT_PERCENT) {
    if (raw === "") return { error: "Enter the percent off." };
    if (!MONEY_INPUT.test(raw)) return { error: "Use a number with up to 2 decimals." };
    const percent = Number(raw);
    if (percent > 100) return { error: "The percent can't be more than 100." };
    const offCents = percentOfCentsHalfUp(subtotalCents, percent);
    return { percent, offCents, subtotalCents, totalCents: subtotalCents - offCents, none: offCents === 0 };
  }

  if (raw === "") return { error: "Enter the price each." };
  if (!MONEY_INPUT.test(raw)) return { error: "Use a price with up to 2 decimals." };
  const priceCents = toCents(raw);
  if (priceCents > unitCents) {
    return { error: `The price each can't be more than the unit price (${fromCents(unitCents)}).` };
  }
  const offCents = (unitCents - priceCents) * quantity;
  return { priceCents, offCents, subtotalCents, totalCents: priceCents * quantity, none: offCents === 0 };
};
