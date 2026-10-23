import { EntityManager } from 'typeorm';
import { Stock } from './entities/stock.entity';
import { ProductUnit } from '../product-units/entities/product-unit.entity';

/**
 * The inventory rows a transaction is about to change.
 */
export interface InventoryLockTargets {
  stock?: ReadonlyArray<{ productId: string; branchId: string }>;
  unitIds?: ReadonlyArray<string>;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The global lock order (Phase 6.4 P7-25): every transaction that changes
 * stock or product units locks, in this order,
 *
 *   1. its sale row, if it has one (at most one, already first everywhere);
 *   2. every Stock row it will touch, sorted by (product_id, branch_id);
 *   3. every ProductUnit row it will touch, sorted by id;
 *   4. then everything else: its changes, inserts (a new unit waits on
 *      uq_product_units_imei_live here, after the Stock locks), the
 *      sale-number counter, audit rows.
 *
 * Two transactions can then never hold a row each and wait for the
 * other's: the one that gets the first shared row goes first. Before
 * this, completeSale and voidSale locked rows line by line, so two sales
 * with the same products in a different order deadlocked (40P01).
 *
 * This function takes steps 2 and 3: one SELECT … FOR UPDATE per row, in
 * sorted order, duplicates dropped. It only locks: a row that doesn't
 * exist is skipped, never an error, so the caller's existing code still
 * raises what it raised before (the StockService and ProductUnitsService
 * methods lock their row again, which costs nothing once it is held).
 *
 * A transaction that needs only one kind of row passes only that kind.
 * Must run inside a transaction (setLock throws otherwise), after the
 * caller's checks that need no locks and before any change.
 */
export async function lockInventoryRows(
  manager: EntityManager,
  targets: InventoryLockTargets,
): Promise<void> {
  const stockKeys = new Map<string, { productId: string; branchId: string }>();
  for (const s of targets.stock ?? []) {
    const productId = s.productId.toLowerCase();
    const branchId = s.branchId.toLowerCase();
    stockKeys.set(`${productId}|${branchId}`, { productId, branchId });
  }
  const stock = [...stockKeys.values()].sort(
    (a, b) =>
      byText(a.productId, b.productId) || byText(a.branchId, b.branchId),
  );
  const unitIds = [
    ...new Set((targets.unitIds ?? []).map((id) => id.toLowerCase())),
  ].sort(byText);

  for (const { productId, branchId } of stock) {
    await manager
      .createQueryBuilder(Stock, 'stock')
      .setLock('pessimistic_write')
      .select('stock.id')
      .where('stock.product_id = :productId', { productId })
      .andWhere('stock.branch_id = :branchId', { branchId })
      .getOne();
  }
  for (const unitId of unitIds) {
    await manager
      .createQueryBuilder(ProductUnit, 'unit')
      .setLock('pessimistic_write')
      .select('unit.id')
      .where('unit.id = :unitId', { unitId })
      .getOne();
  }
}
