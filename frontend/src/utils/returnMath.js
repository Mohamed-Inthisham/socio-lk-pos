import { toCents } from "./money";
import { colomboToday } from "./colomboDay";
import { receiptDate } from "./receipt";

/**
 * Refund arithmetic for returns (planning doc P7-3, P7-5, P7-22), in
 * integer cents.
 *
 * refundShareCents and tradeInShareCents are copies of the server's
 * backend/src/sales/return-math.ts and are tested on the same cases
 * (returnMath.test.js). The rest works the server's figures out from a
 * hydrated sale (GET /sales/:id with lines[].returned_quantity and
 * returns[]), the way sale-returns.service.ts `plan` does, so the
 * ReturnDialog can show them before it asks; the server's checks stay
 * the authority (REFUND_TOO_HIGH, REFUND_EXCEEDS_PAYMENT,
 * OVERRIDE_REASON_REQUIRED, utils/returnErrors.js).
 */

/** n / d rounded half-up, for n >= 0 and d > 0, exactly (BigInt). */
const divHalfUp = (n, d) => (2n * n + d) / (2n * d);

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
export function refundShareCents(lineTotalCents, quantity, alreadyReturned, returningNow) {
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
 */
export function tradeInShareCents(refundTotalCents, nonTradeInPaidCents, earlierRefundsCents) {
  return Math.max(0, refundTotalCents - (nonTradeInPaidCents - earlierRefundsCents));
}

const CASH = "CASH";
const TRADE_IN = "TRADE_IN";

/** Units of a line still to be returned (CHK_sale_lines_returned_qty keeps it ≥ 0). */
export const returnableQuantity = (line) => line.quantity - (line.returned_quantity ?? 0);

/**
 * The most that may be refunded for a selection (P7-3): the sum of the
 * selected lines' shares. Lines with 0 or no quantity are skipped.
 *
 * @param {Object} sale - hydrated, with lines[].returned_quantity
 * @param {Record<string, number>} selection - { [sale_line_id]: units returned now }
 * @returns {number} cents
 */
export const refundDueCents = (sale, selection) =>
  sale.lines.reduce((sum, line) => {
    const k = selection[line.id] ?? 0;
    if (k <= 0) return sum;
    return sum + refundShareCents(toCents(line.line_total), line.quantity, line.returned_quantity ?? 0, k);
  }, 0);

/**
 * What the sale's earlier returns leave to refund (P7-4, P7-5), as the
 * server works it out:
 * - payments: each non-cash, non-TRADE_IN payment a refund may go back
 *   to, with refundableCents = its amount less every earlier refund to it
 *   (R12's per-payment cap). Cash has no per-payment cap.
 * - nonTradeInPaidCents: every non-TRADE_IN payment, cash included.
 * - earlierRefundsCents: the sum of the earlier returns' refund_total.
 *
 * @param {Object} sale - hydrated, with payments and returns[]
 */
export const saleRefundContext = (sale) => {
  const returns = sale.returns ?? [];
  const refunds = returns.flatMap((r) => r.refunds ?? []);
  const refundedTo = (paymentId) =>
    refunds.filter((f) => f.original_payment_id === paymentId).reduce((sum, f) => sum + toCents(f.amount), 0);

  const payments = sale.payments
    .filter((p) => p.payment_method !== CASH && p.payment_method !== TRADE_IN)
    .map((p) => {
      const amountCents = toCents(p.amount);
      const refundedCents = refundedTo(p.id);
      return {
        id: p.id,
        method: p.payment_method,
        reference_number: p.reference_number,
        amountCents,
        refundedCents,
        refundableCents: amountCents - refundedCents,
      };
    });

  return {
    payments,
    nonTradeInPaidCents: sale.payments
      .filter((p) => p.payment_method !== TRADE_IN)
      .reduce((sum, p) => sum + toCents(p.amount), 0),
    earlierRefundsCents: returns.reduce((sum, r) => sum + toCents(r.refund_total), 0),
  };
};

/**
 * The trade-in share of a refund on this sale (P7-5): "includes LKR X
 * from a trade-in" when > 0. Never more than the refund itself: once
 * earlier refunds have used more than the non-trade-in money,
 * tradeInShareCents alone goes above the refund (the server's audit
 * description isn't capped; FOLLOWUPS).
 */
export const saleTradeInShareCents = (sale, refundTotalCents) => {
  const { nonTradeInPaidCents, earlierRefundsCents } = saleRefundContext(sale);
  return Math.min(refundTotalCents, tradeInShareCents(refundTotalCents, nonTradeInPaidCents, earlierRefundsCents));
};

/**
 * Where a returned line goes when the server decides it (returns.md
 * "Where items go"), in the server's order: another shop's line
 * NOT_OUR_STOCK, a phone from our stock INSPECTION, a product without
 * stock tracking UNTRACKED. null: the cashier picks RESALEABLE (back to
 * stock) or DAMAGED, and the line must carry that `condition`; the
 * others must not (400 RETURN_CONDITION_INVALID).
 *
 * @param {Object} line - sale line
 * @param {{ stockTracked: boolean }} opts - the product's manage_stock at
 *   the sale's branch (GET /stock?branchId=, read when the dialog opens)
 * @returns {"NOT_OUR_STOCK"|"INSPECTION"|"UNTRACKED"|null}
 */
export const lineDisposition = (line, { stockTracked }) => {
  if (line.external_supplier_id) return "NOT_OUR_STOCK";
  if (line.product_unit_id) return "INSPECTION";
  if (!stockTracked) return "UNTRACKED";
  return null;
};

/**
 * A line's warranty status for display (P7-20, P7-22): within warranty
 * when today (Colombo) is on or before its warranty_until; NO_WARRANTY
 * and CHECKING have none and are outside from the day of sale. The
 * server decides by the database clock and stores its verdict; around
 * midnight it may disagree, and OVERRIDE_REASON_REQUIRED says so.
 *
 * @param {Object} line - sale line
 * @param {string} [today] - "YYYY-MM-DD" in Colombo (colomboToday())
 * @returns {{ kind: "within"|"expired"|"checking"|"none", outside: boolean, label: string }}
 */
export const lineWarrantyStatus = (line, today = colomboToday()) => {
  const until = line.warranty_until ? String(line.warranty_until).slice(0, 10) : null;
  if (until && today <= until) {
    return { kind: "within", outside: false, label: `Within warranty until ${receiptDate(until)}` };
  }
  if (until) {
    return { kind: "expired", outside: true, label: `Warranty expired on ${receiptDate(until)}` };
  }
  if (line.warranty === "CHECKING") {
    return { kind: "checking", outside: true, label: "Checking only — outside warranty" };
  }
  return { kind: "none", outside: true, label: "No warranty — outside warranty" };
};

/**
 * The selected lines outside warranty (P7-23: the return needs an
 * override reason when there is any).
 *
 * @returns {string[]} sale_line_ids, in the sale's line order
 */
export const selectionOutsideWarranty = (sale, selection, today = colomboToday()) =>
  sale.lines
    .filter((line) => (selection[line.id] ?? 0) > 0 && lineWarrantyStatus(line, today).outside)
    .map((line) => line.id);

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (day) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/**
 * Whole Colombo days from the sale's completion to today ("Sold N days
 * ago", P7-20: information only, no time limit). 0 on the day of sale.
 */
export const daysSinceSale = (sale, today = colomboToday()) => {
  const soldOn = colomboToday(new Date(sale.completed_at));
  return dayNumber(today) - dayNumber(soldOn);
};
