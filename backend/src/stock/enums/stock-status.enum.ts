/**
 * A product's stock position in the inventory overview (INV-F4).
 *
 * - IN_STOCK: above its low-stock threshold.
 * - LOW_STOCK: above zero, at or below the threshold.
 * - OUT_OF_STOCK: zero, or no stock row in the scope.
 * - NOT_TRACKED: stock rows in the scope, none of them tracked
 *   (manage_stock false). Never read as zero.
 */
export enum StockStatus {
  IN_STOCK = 'IN_STOCK',
  LOW_STOCK = 'LOW_STOCK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  NOT_TRACKED = 'NOT_TRACKED',
}
