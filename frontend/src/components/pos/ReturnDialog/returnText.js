import { methodLabel } from "../PaymentDialog/methods";
import { formatLKR, fromCents, toCents } from "../../../utils/money";
import { saleRefundContext, tradeInShareCents } from "../../../utils/returnMath";

/**
 * The ReturnDialog's wording (planning doc P7-5, P7-17), from the sale and
 * a recorded return (GET /sales/:id returns[]), never from the form.
 */

/** "Paid: Trade-in LKR 40,000.00 · Card LKR 10,000.00 · Cash LKR 20,290.00", in the order paid. */
export const paidLine = (sale) =>
  `Paid: ${sale.payments.map((p) => `${methodLabel(p.payment_method)} ${formatLKR(p.amount)}`).join(" · ")}`;

const DISPOSITION_TEXT = {
  RESTOCKED: "back to stock",
  DAMAGED: "damaged, not back to stock",
  INSPECTION: "goes to inspection: put it aside",
  NOT_OUR_STOCK: "not our stock: return it to that shop",
  UNTRACKED: "no stock change",
};

/** What to hand the customer: "Give LKR 55,590.00 cash.", "Card reversal of LKR 10,000.00, ref REV-1.", or "No refund." */
export const handOverLines = (ret) =>
  ret.refunds.length === 0
    ? ["No refund."]
    : ret.refunds.map((f) =>
        f.method === "CASH"
          ? `Give ${formatLKR(f.amount)} cash.`
          : `${methodLabel(f.method)} reversal of ${formatLKR(f.amount)}, ref ${f.reference_number}.`,
      );

/** Each returned line: "1 × Samsung Galaxy A15 128GB (IMEI …): goes to inspection: put it aside". */
export const itemLines = (ret, sale) =>
  ret.lines.map((l) => {
    const line = sale.lines.find((s) => s.id === l.sale_line_id);
    const name = line?.product_name_snapshot ?? "An item";
    const identifierLabel = line?.identifier_type_snapshot === "SERIAL_NUMBER" ? "Serial number" : "IMEI";
    const identifier = l.product_unit?.imei ? ` (${identifierLabel} ${l.product_unit.imei})` : "";
    return `${l.quantity} × ${name}${identifier}: ${DISPOSITION_TEXT[l.disposition] ?? l.disposition}`;
  });

/**
 * The trade-in share of a recorded return (P7-5), against the refunds of
 * the returns before it (tradeInShareCents keeps it within its own refund).
 */
export const recordedTradeInCents = (ret, sale) => {
  const { nonTradeInPaidCents } = saleRefundContext(sale);
  const before = sale.returns.slice(0, sale.returns.findIndex((r) => r.id === ret.id));
  const earlierCents = before.reduce((sum, r) => sum + toCents(r.refund_total), 0);
  return tradeInShareCents(toCents(ret.refund_total), nonTradeInPaidCents, earlierCents);
};

export const lkr = (cents) => formatLKR(fromCents(cents));
