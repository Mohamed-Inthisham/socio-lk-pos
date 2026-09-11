/**
 * The kind of transaction represented by a Sale row.
 *
 * Only RETAIL is wired in Phase 6.3. The other values exist in the enum
 * so the schema and DTO validation are forward-compatible for future
 * phases — USED_PHONE lands in 6.3.5, the rest in later phases.
 */
export enum SaleType {
  RETAIL = 'RETAIL',
  USED_PHONE = 'USED_PHONE',
  REPAIR = 'REPAIR',
  CUSTOM_PRINT = 'CUSTOM_PRINT',
  RELOAD = 'RELOAD',
}
