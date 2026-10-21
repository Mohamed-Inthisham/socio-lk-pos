/**
 * How a line-level discount was expressed by the cashier.
 *
 * - AMOUNT: discount_value is a raw LKR amount off the whole line
 *   (e.g. 500 = Rs. 500 off). Not used by the till UI.
 * - PERCENT: discount_value is a percentage 0–100 (2 decimals allowed,
 *   e.g. 12.5), of unit_price × quantity. Follows quantity changes.
 * - UNIT_PRICE: discount_value is the agreed FINAL price per unit
 *   (0 ≤ value ≤ unit_price; 0 = free). discount_amount =
 *   (unit_price − value) × quantity, so it follows quantity changes
 *   exactly (200 → 160 each: qty 2 → 320). Phase 6.4 P5-20.
 *
 * The server always resolves discount_value into an absolute LKR
 * discount_amount stored on the line, in integer cents. Never trust the
 * client's discount_amount — recompute it from type + value + (unit_price * qty).
 *
 * A line with no discount has BOTH discount_type and discount_value = NULL
 * (enforced by CHK_sale_lines_discount_consistency).
 */
export enum DiscountType {
  AMOUNT = 'AMOUNT',
  PERCENT = 'PERCENT',
  UNIT_PRICE = 'UNIT_PRICE',
}
