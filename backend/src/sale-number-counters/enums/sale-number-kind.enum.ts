/**
 * Which number a counter issues (Phase 6.4 P7-10): SALE → INV-YYYYMMDD-NNNN
 * for completed sales, RETURN → RET-YYYYMMDD-NNNN for returns. Each kind
 * counts on its own, per branch and Colombo day.
 */
export enum SaleNumberKind {
  SALE = 'SALE',
  RETURN = 'RETURN',
}
