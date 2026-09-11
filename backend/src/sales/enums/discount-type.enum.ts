/**
 * How a line-level discount was expressed by the cashier.
 *
 * - AMOUNT: discount_value is a raw LKR amount (e.g. 500 = Rs. 500 off the line)
 * - PERCENT: discount_value is a percentage 0–100 (e.g. 10 = 10% off)
 *
 * The server always resolves discount_value into an absolute LKR
 * discount_amount stored on the line. Never trust the client's
 * discount_amount — recompute it from type + value + (unit_price * qty).
 *
 * A line with no discount has BOTH discount_type and discount_value = NULL
 * (enforced by CHK_sale_lines_discount_consistency).
 */
export enum DiscountType {
  AMOUNT = 'AMOUNT',
  PERCENT = 'PERCENT',
}
