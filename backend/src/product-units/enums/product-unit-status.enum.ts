export enum ProductUnitStatus {
  IN_STOCK = 'IN_STOCK',
  SOLD = 'SOLD',
  RETURNED = 'RETURNED',
  WRITTEN_OFF = 'WRITTEN_OFF',
  // A customer's return, back with the shop but not sellable until a
  // manager or admin checks it (Phase 6.4 P7-6, P7-7). Live: it holds the
  // IMEI in uq_product_units_imei_live.
  INSPECTION = 'INSPECTION',
  // A supplier has taken the unit back. Terminal for this acquisition and
  // deliberately excluded from the live identifier indexes.
  SUPPLIER_RETURNED = 'SUPPLIER_RETURNED',
}
