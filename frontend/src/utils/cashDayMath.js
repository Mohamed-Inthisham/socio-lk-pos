import { formatLKR, fromCents, toCents } from "./money";

/**
 * The close dialog's difference (planning doc P9-11, cash-days.md "The
 * rounding rule"), in integer cents.
 *
 * REASON_THRESHOLD_CENTS, settleReason and describeDifference are copies
 * of the server's backend/src/cash-days/cash-day-math.ts and are tested
 * on the same cases (cashDayMath.test.js); change them only together with
 * it. The expected balance is never worked out here: differenceCents
 * subtracts the server's expected_balance, as Balance due subtracts the
 * server's totals.
 *
 * describeDifference keeps the server's wording exactly ("Short LKR
 * 1500.00", as the DAY_CLOSE audit row reads). The till shows
 * describeDifferenceForDisplay everywhere instead, with formatLKR's
 * thousands separator ("Short LKR 1,500.00").
 */

/**
 * The rounding rule: the shop counts whole rupees, but discounts and
 * refund shares make cents, so a difference under 1.00 either way is
 * normal and needs no reason.
 */
export const REASON_THRESHOLD_CENTS = 100;

/**
 * P9-11, C9: the reason stored for a difference. Under 1.00 either way (0
 * included) stores null whatever was sent; from 1.00 it needs 3+
 * characters after trimming, or `ok: false` (400 REASON_REQUIRED). The
 * difference itself is stored exactly either way.
 *
 * @param {number} differenceCents
 * @param {string|null|undefined} reason
 * @returns {{ ok: true, reason: string|null } | { ok: false }}
 */
export function settleReason(differenceCents, reason) {
  if (Math.abs(differenceCents) < REASON_THRESHOLD_CENTS) {
    return { ok: true, reason: null };
  }
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  return trimmed.length >= 3 ? { ok: true, reason: trimmed } : { ok: false };
}

/**
 * The difference in words, as the server writes it (P9-11, the rounding
 * rule): "Exact" at 0.00, "Rounding LKR 0.50" under 1.00 either way,
 * "Short LKR 100.00" / "Over LKR 50.00" from 1.00.
 *
 * @param {number} differenceCents
 * @returns {string}
 */
export function describeDifference(differenceCents) {
  if (differenceCents === 0) return "Exact";
  const amount = fromCents(Math.abs(differenceCents));
  if (Math.abs(differenceCents) < REASON_THRESHOLD_CENTS) {
    return `Rounding LKR ${amount}`;
  }
  return differenceCents < 0 ? `Short LKR ${amount}` : `Over LKR ${amount}`;
}

/**
 * describeDifference as the till shows it, the amount by formatLKR:
 * "Exact", "Rounding LKR 0.50", "Short LKR 1,500.00", "Over LKR 50.50".
 *
 * @param {number} differenceCents
 * @returns {string}
 */
export function describeDifferenceForDisplay(differenceCents) {
  if (differenceCents === 0) return "Exact";
  const amount = formatLKR(fromCents(Math.abs(differenceCents)));
  if (Math.abs(differenceCents) < REASON_THRESHOLD_CENTS) {
    return `Rounding ${amount}`;
  }
  return differenceCents < 0 ? `Short ${amount}` : `Over ${amount}`;
}

/**
 * counted − expected in cents; negative = short. NaN while the counted
 * cash isn't a number yet (toCents of a blank input).
 *
 * @param {number} countedCents
 * @param {string} expectedBalance - the server's expected_balance, may be negative
 */
export const differenceCents = (countedCents, expectedBalance) => countedCents - toCents(expectedBalance);

/** Whether the close dialog shows the reason box: a difference of 1.00 or more either way. */
export const needsReason = (diffCents) => Math.abs(diffCents) >= REASON_THRESHOLD_CENTS;
