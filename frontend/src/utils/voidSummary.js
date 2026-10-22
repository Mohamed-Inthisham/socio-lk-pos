import { fromCents, toCents } from "./money";

/**
 * What voiding a sale does, and what to hand back outside the system
 * (planning doc P6-10, P6-12). Pure: read from the hydrated sale the
 * detail page already holds (GET /sales/:id).
 *
 * Mirrors SalesService.voidSale (backend/src/sales/sales.service.ts):
 * - each line with external_supplier_id null goes back to our stock (its
 *   quantity); lines from another shop (external_supplier_id set) don't
 * - each line with a product_unit_id is a phone of ours: SOLD → IN_STOCK
 * - each TRADE_IN payment's phone leaves our stock (IN_STOCK → RETURNED):
 *   it goes back to the customer
 * - payments are only stamped reversed: no refund is recorded (until P7),
 *   so the money goes back by hand
 *
 * @returns {{
 *   restockCount: number,
 *   otherShopCount: number,
 *   phonesBack: string[],                       // IMEIs
 *   tradeInsOut: { name: string|null, imei: string|null }[],
 *   cashBack: string|null,                      // "20290.00", or null
 *   referenced: { method: string, amount: string, reference: string|null }[],
 * }}
 */
export const voidSummary = (sale) => {
  const lines = sale?.lines ?? [];
  const payments = sale?.payments ?? [];

  const ours = lines.filter((l) => !l.external_supplier_id);
  const restockCount = ours.reduce((sum, l) => sum + l.quantity, 0);
  const otherShopCount = lines
    .filter((l) => l.external_supplier_id)
    .reduce((sum, l) => sum + l.quantity, 0);
  const phonesBack = ours.filter((l) => l.product_unit_id && l.imei_snapshot).map((l) => l.imei_snapshot);

  const tradeInsOut = payments
    .filter((p) => p.payment_method === "TRADE_IN")
    .map((p) => ({ name: p.trade_in_product?.name ?? null, imei: p.trade_in_imei ?? null }));

  // Cash kept is each cash tender's amount (the change was already handed back).
  const cashCents = payments
    .filter((p) => p.payment_method === "CASH")
    .reduce((sum, p) => sum + toCents(p.amount), 0);

  const referenced = payments
    .filter((p) => p.payment_method !== "CASH" && p.payment_method !== "TRADE_IN")
    .map((p) => ({ method: p.payment_method, amount: p.amount, reference: p.reference_number ?? null }));

  return {
    restockCount,
    otherShopCount,
    phonesBack,
    tradeInsOut,
    cashBack: cashCents > 0 ? fromCents(cashCents) : null,
    referenced,
  };
};
