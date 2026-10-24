import { fromCents, toCents } from '../common/utils/money';
import { PaymentMethod } from '../sales/enums/payment-method.enum';

/**
 * The cash day's arithmetic (Phase 6.4 P9-3, P9-5, P9-11), in integer
 * cents. Pure: CashDaysService runs the queries and hands the sums here.
 */

/** The tenders the printout lists by name besides cash (P9-15). */
export const NON_CASH_TENDERS = [
  PaymentMethod.CARD,
  PaymentMethod.BANK_TRANSFER,
  PaymentMethod.KOKO,
  PaymentMethod.MINTPAY,
] as const;
export type NonCashTender = (typeof NON_CASH_TENDERS)[number];

/** Money per non-cash tender, every tender present ("0.00" when none). */
export type TenderTotals = Record<NonCashTender, string>;

/**
 * The rest of the day summary, frozen in cash_days.summary at close so a
 * reprint matches the original print (P9-2, P9-15). Money is a 2-decimal
 * string, as everywhere in the API.
 *
 *   non_cash_sales, trade_in_value: payments of sales completed on the day
 *     and not voided on it (the same rule as cash sales).
 *   non_cash_refunds: refund rows of returns made on the day.
 *   earlier_voids_non_cash: payments of earlier days' sales voided on the
 *     day ("earlier sales voided"), as cash_voids_earlier is for cash.
 *   counts.sales_completed: every sale completed on the day, same-day
 *     voids included; counts.returns: returns made on the day;
 *     counts.voids: every sale voided on the day, whenever completed.
 */
export interface CashDayBreakdown {
  non_cash_sales: TenderTotals;
  non_cash_refunds: TenderTotals;
  earlier_voids_non_cash: TenderTotals;
  trade_in_value: string;
  counts: { sales_completed: number; returns: number; voids: number };
}

/** Rows of `SELECT method, SUM(amount)::text AS total … GROUP BY method`. */
export interface MethodTotalRow {
  method: string;
  total: string;
}

/** Sum rows into cents per method; a method with no row is absent. */
export function centsByMethod(rows: MethodTotalRow[]): Map<string, number> {
  const byMethod = new Map<string, number>();
  for (const row of rows) {
    byMethod.set(
      row.method,
      (byMethod.get(row.method) ?? 0) + toCents(row.total),
    );
  }
  return byMethod;
}

/** Every non-cash tender's total as a string, "0.00" when absent. */
export function tenderTotals(byMethod: Map<string, number>): TenderTotals {
  return Object.fromEntries(
    NON_CASH_TENDERS.map((t) => [t, fromCents(byMethod.get(t) ?? 0)]),
  ) as TenderTotals;
}

/**
 * P9-5: expected = opening + cash sales − cash refunds − cash handed back
 * for earlier days' sales voided today. May be negative; nothing forbids
 * it.
 */
export function expectedCents(figures: {
  openingCents: number;
  cashSalesCents: number;
  cashRefundsCents: number;
  cashVoidsEarlierCents: number;
}): number {
  return (
    figures.openingCents +
    figures.cashSalesCents -
    figures.cashRefundsCents -
    figures.cashVoidsEarlierCents
  );
}

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
 */
export function settleReason(
  differenceCents: number,
  reason: string | null | undefined,
): { ok: true; reason: string | null } | { ok: false } {
  if (Math.abs(differenceCents) < REASON_THRESHOLD_CENTS) {
    return { ok: true, reason: null };
  }
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  return trimmed.length >= 3 ? { ok: true, reason: trimmed } : { ok: false };
}

/**
 * The difference in words, as the till shows it (P9-11, the rounding
 * rule): "Exact" at 0.00, "Rounding LKR 0.50" under 1.00 either way,
 * "Short LKR 100.00" / "Over LKR 50.00" from 1.00.
 */
export function describeDifference(differenceCents: number): string {
  if (differenceCents === 0) return 'Exact';
  const amount = fromCents(Math.abs(differenceCents));
  if (Math.abs(differenceCents) < REASON_THRESHOLD_CENTS) {
    return `Rounding LKR ${amount}`;
  }
  return differenceCents < 0 ? `Short LKR ${amount}` : `Over LKR ${amount}`;
}
