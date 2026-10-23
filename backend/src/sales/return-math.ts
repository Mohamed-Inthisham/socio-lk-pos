/**
 * Refund arithmetic for returns (Phase 6.4 P7-3, P7-5), in integer cents.
 * The till copies these formulas (frontend utils/returnMath.js) and is
 * tested on the same cases.
 */

/** n / d rounded half-up, for n >= 0 and d > 0, exactly (BigInt). */
const divHalfUp = (n: bigint, d: bigint): bigint => (2n * n + d) / (2n * d);

/**
 * A returned line's share of what the customer paid for those units
 * (P7-3): with L the line total in cents, q its quantity, r the units
 * already returned and k the units returned now,
 *
 *   share = round_half_up(L × (r + k) / q) − round_half_up(L × r / q)
 *
 * So every return on a line adds up to exactly L however the quantity is
 * split, and a refund lowered on one return never raises a later one
 * (the shares follow quantities, not what was refunded). BigInt keeps
 * L × (r + k) exact beyond 2^53.
 */
export function refundShareCents(
  lineTotalCents: number,
  quantity: number,
  alreadyReturned: number,
  returningNow: number,
): number {
  const L = BigInt(lineTotalCents);
  const q = BigInt(quantity);
  const before = divHalfUp(L * BigInt(alreadyReturned), q);
  const after = divHalfUp(L * BigInt(alreadyReturned + returningNow), q);
  return Number(after - before);
}

/**
 * How much of a refund comes from a trade-in (P7-5): the refund total less
 * the non-trade-in money still unrefunded on the sale (the non-TRADE_IN
 * payments less every earlier refund), when that is positive; else 0.
 * Never more than the refund itself: once earlier refunds have used more
 * than the non-trade-in money, all of this refund is trade-in money.
 */
export function tradeInShareCents(
  refundTotalCents: number,
  nonTradeInPaidCents: number,
  earlierRefundsCents: number,
): number {
  return Math.min(
    refundTotalCents,
    Math.max(0, refundTotalCents - (nonTradeInPaidCents - earlierRefundsCents)),
  );
}
