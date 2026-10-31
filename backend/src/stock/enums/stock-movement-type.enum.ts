/**
 * What moved stock (Phase 1 T1, the stock movement ledger). One ledger row
 * per business event, per stock row and unit:
 *
 * - OPENING_BALANCE: a stock row's quantity when the ledger started (the
 *   backfill), or a new row created with a starting quantity (POST /stock).
 * - PURCHASE: received from a supplier (stock purchase) or bought from a
 *   customer (phone purchase).
 * - TRADE_IN: a customer's phone taken as payment, at sale completion.
 * - SALE: sold at sale completion.
 * - REVERSAL: a void undoing a SALE or a TRADE_IN.
 * - CUSTOMER_RETURN: a returned item back in stock, or a returned phone
 *   moved to INSPECTION (quantity 0).
 * - INSPECTION_PASSED: a returned phone checked and back on sale.
 * - ADJUSTMENT_IN / ADJUSTMENT_OUT: a manual change with a reason.
 *
 * Stored as varchar(30) with CHK_stock_movements_type; keep the
 * migration's list in step.
 */
export enum StockMovementType {
  OPENING_BALANCE = 'OPENING_BALANCE',
  PURCHASE = 'PURCHASE',
  TRADE_IN = 'TRADE_IN',
  SALE = 'SALE',
  REVERSAL = 'REVERSAL',
  CUSTOMER_RETURN = 'CUSTOMER_RETURN',
  INSPECTION_PASSED = 'INSPECTION_PASSED',
  ADJUSTMENT_IN = 'ADJUSTMENT_IN',
  ADJUSTMENT_OUT = 'ADJUSTMENT_OUT',
}

/**
 * The business row a movement came from (reference_id points at it):
 * stock rows, manual adjustments (an id made per request), stock purchase
 * lines, phone purchases, trade-in payments, sale lines and return lines.
 *
 * Stored as varchar(40) with CHK_stock_movements_reference_type.
 */
export enum StockMovementReferenceType {
  STOCK = 'STOCK',
  STOCK_ADJUSTMENT = 'STOCK_ADJUSTMENT',
  STOCK_PURCHASE_ITEM = 'STOCK_PURCHASE_ITEM',
  PHONE_PURCHASE = 'PHONE_PURCHASE',
  PAYMENT = 'PAYMENT',
  SALE_LINE = 'SALE_LINE',
  SALE_RETURN_LINE = 'SALE_RETURN_LINE',
}

/** Movements that need an approver (approved_by_id), and only these. */
export const APPROVED_MOVEMENT_TYPES: readonly StockMovementType[] = [
  StockMovementType.REVERSAL,
  StockMovementType.CUSTOMER_RETURN,
];

/** The reason a manual adjustment gets until reasons can be chosen. */
export const MANUAL_ADJUSTMENT_REASON = 'MANUAL_ADJUSTMENT';
