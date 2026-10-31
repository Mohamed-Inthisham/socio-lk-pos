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

/** The Stock keys, lower-cased, duplicates dropped, in the global order. */
const sortedStockKeys = (
  targets: InventoryLockTargets['stock'],
): { productId: string; branchId: string }[] => {
  const stockKeys = new Map<string, { productId: string; branchId: string }>();
  for (const s of targets ?? []) {
    const productId = s.productId.toLowerCase();
    const branchId = s.branchId.toLowerCase();
    stockKeys.set(`${productId}|${branchId}`, { productId, branchId });
  }
  return [...stockKeys.values()].sort(
    (a, b) =>
      byText(a.productId, b.productId) || byText(a.branchId, b.branchId),
  );
};

/**
 * Create the Stock rows an intake is about to add to, where they don't
 * exist yet: quantity 0, min_quantity 0, manage_stock true. Products are a
 * global catalog (MakeProductsCatalogGlobal), so a product has no Stock row
 * at a branch until something brings it in there; without this, the first
 * phone purchase or trade-in of a model at a branch hit the "Stock row
 * missing" integrity error (500).
 *
 * Call it right before lockInventoryRows with the same Stock targets: one
 * INSERT … ON CONFLICT DO NOTHING per row, in the same sorted order. A row
 * that exists is left alone (and not locked). A row another transaction is
 * inserting at the same moment makes this wait for that transaction, as
 * its row lock would, and in the same position of the order. The rows this
 * inserts are invisible to other transactions until commit, so their lock
 * pass can't wait on them. Only intakes call it: a sale or a reversal
 * never creates stock.
 */
export async function ensureStockRows(
  manager: EntityManager,
  stock: InventoryLockTargets['stock'],
): Promise<void> {
  for (const { productId, branchId } of sortedStockKeys(stock)) {
    await manager.query(
      `INSERT INTO "stock" ("product_id", "branch_id", "quantity", "min_quantity", "manage_stock")
       VALUES ($1, $2, 0, 0, true)
       ON CONFLICT ("product_id", "branch_id") DO NOTHING`,
      [productId, branchId],
    );
  }
}

/**
 * The global lock order (Phase 6.4 P7-25): every transaction that changes
 * stock or product units locks, in this order,
 *
 *   1. its sale row, if it has one (at most one, already first everywhere);
 *   2. every Stock row it will touch, sorted by (product_id, branch_id);
 *   3. every ProductUnit row it will touch, sorted by id;
 *   4. complete, void and return only: today's cash_days row at the sale's
 *      branch, FOR SHARE (assertDayOpen, cash-days/day-gate.ts, P9-10);
 *   5. then everything else: its changes, inserts (a new unit waits on
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
  const stock = sortedStockKeys(targets.stock);
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
