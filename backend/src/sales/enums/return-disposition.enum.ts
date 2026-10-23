/**
 * Where a returned sale line went (Phase 6.4 P7-8), stored on
 * sale_return_lines.disposition:
 *
 * RESTOCKED: one of our non-phone items, resaleable: stock + quantity.
 * DAMAGED: one of our non-phone items, not resaleable: no stock change.
 * INSPECTION: a phone from our stock: SOLD → INSPECTION, no stock change
 *   until it passes (P7-6, P7-7). The only disposition with a unit.
 * NOT_OUR_STOCK: a line from another shop (external_supplier_id): never
 *   our stock; the shop returns it to that shop.
 * UNTRACKED: a product without stock tracking (manage_stock = false).
 */
export enum ReturnDisposition {
  RESTOCKED = 'RESTOCKED',
  DAMAGED = 'DAMAGED',
  INSPECTION = 'INSPECTION',
  NOT_OUR_STOCK = 'NOT_OUR_STOCK',
  UNTRACKED = 'UNTRACKED',
}
