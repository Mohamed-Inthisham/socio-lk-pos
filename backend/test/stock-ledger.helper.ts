import { DataSource } from 'typeorm';

/**
 * Stock ledger reconciliation (Phase 1 T1b), read-only: the queries of
 * docs/backend/stock-ledger.md "Reconciliation", run against the e2e
 * database. Each returns the rows that break a rule; nothing is
 * corrected. `informational` lists are expected in normal operation and
 * only reported.
 */
export interface StockLedgerReconciliation {
  /** First movement of a stock row isn't a valid start (before 0). */
  unanchored: {
    stock_id: string;
    movement_type: string;
    quantity_before: number;
  }[];
  /** A movement whose before isn't the previous movement's after. */
  chainBreaks: {
    movement_id: string;
    stock_id: string;
    quantity_before: number;
    previous_after: number;
  }[];
  /** SUM(delta) or the latest after differs from stock.quantity. */
  quantityMismatches: {
    stock_id: string;
    quantity: number;
    sum_delta: number;
    last_after: number;
  }[];
  /** A stock row with a quantity but no ledger history at all. */
  unrecordedQuantities: { stock_id: string; quantity: number }[];
  /** Tracked IMEI product: quantity differs from its IN_STOCK units. */
  imeiMismatches: {
    stock_id: string;
    quantity: number;
    in_stock_units: number;
  }[];
  /** Tracked serial product: fewer quantity than IN_STOCK units. */
  negativeUntrackedSerials: {
    stock_id: string;
    quantity: number;
    in_stock_units: number;
  }[];
  /** Completion marker missing, or its counts differ. */
  markerProblems: string[];
  informational: {
    /** Serial products' quantity without a serial number. */
    untrackedSerialQuantities: { stock_id: string; untracked: number }[];
    /** Untracked rows (manage_stock false) still holding IN_STOCK units. */
    untrackedRowsWithUnits: { stock_id: string; in_stock_units: number }[];
    /** Unit events recorded on untracked rows (quantity_delta 0). */
    unmanagedUnitEvents: { movement_id: string; stock_id: string }[];
    /** Stock rows with no ledger history (quantity 0). */
    emptyRowsWithoutHistory: { stock_id: string }[];
  };
}

export async function reconcileStockLedger(
  dataSource: DataSource,
): Promise<StockLedgerReconciliation> {
  const q = <T>(sql: string): Promise<T[]> => dataSource.query(sql);

  const unanchored = await q<StockLedgerReconciliation['unanchored'][number]>(`
    SELECT s.id AS stock_id, f.movement_type, f.quantity_before
      FROM stock s
      JOIN LATERAL (
        SELECT m.* FROM stock_movements m
         WHERE m.product_id = s.product_id AND m.branch_id = s.branch_id
         ORDER BY m.seq LIMIT 1
      ) f ON true
     WHERE f.quantity_before <> 0
        OR (f.movement_type = 'OPENING_BALANCE'
            AND NOT (f.reference_type = 'STOCK' AND f.reference_id = s.id))
     ORDER BY s.id`);

  const chainBreaks = await q<
    StockLedgerReconciliation['chainBreaks'][number]
  >(`
    SELECT x.id AS movement_id, s.id AS stock_id,
           x.quantity_before, x.previous_after
      FROM (
        SELECT m.*, LAG(m.quantity_after) OVER (
                 PARTITION BY m.product_id, m.branch_id ORDER BY m.seq
               ) AS previous_after
          FROM stock_movements m
      ) x
      JOIN stock s ON s.product_id = x.product_id AND s.branch_id = x.branch_id
     WHERE x.previous_after IS NOT NULL
       AND x.quantity_before <> x.previous_after
     ORDER BY x.seq`);

  const quantityMismatches = await q<
    StockLedgerReconciliation['quantityMismatches'][number]
  >(`
    SELECT s.id AS stock_id, s.quantity,
           t.sum_delta::int AS sum_delta, t.last_after
      FROM stock s
      JOIN (
        SELECT product_id, branch_id,
               SUM(quantity_delta) AS sum_delta,
               (array_agg(quantity_after ORDER BY seq DESC))[1] AS last_after
          FROM stock_movements
         GROUP BY product_id, branch_id
      ) t ON t.product_id = s.product_id AND t.branch_id = s.branch_id
     WHERE t.sum_delta <> s.quantity OR t.last_after <> s.quantity
     ORDER BY s.id`);

  const withoutHistory = await q<{ stock_id: string; quantity: number }>(`
    SELECT s.id AS stock_id, s.quantity
      FROM stock s
     WHERE NOT EXISTS (SELECT 1 FROM stock_movements m
                        WHERE m.product_id = s.product_id
                          AND m.branch_id = s.branch_id)
     ORDER BY s.id`);

  const unitCounts = await q<{
    stock_id: string;
    tracking_method: string;
    quantity: number;
    in_stock_units: number;
  }>(`
    SELECT s.id AS stock_id, p.tracking_method, s.quantity,
           (SELECT count(*) FROM product_units u
             WHERE u.product_id = s.product_id AND u.branch_id = s.branch_id
               AND u.status = 'IN_STOCK')::int AS in_stock_units
      FROM stock s
      JOIN products p ON p.id = s.product_id
     WHERE s.manage_stock AND p.tracking_method IN ('IMEI', 'SERIAL_NUMBER')
     ORDER BY s.id`);

  const untrackedRowsWithUnits = await q<
    StockLedgerReconciliation['informational']['untrackedRowsWithUnits'][number]
  >(`
    SELECT s.id AS stock_id, count(u.id)::int AS in_stock_units
      FROM stock s
      JOIN product_units u ON u.product_id = s.product_id
                          AND u.branch_id = s.branch_id
                          AND u.status = 'IN_STOCK'
     WHERE NOT s.manage_stock
     GROUP BY s.id
     ORDER BY s.id`);

  const unmanagedUnitEvents = await q<
    StockLedgerReconciliation['informational']['unmanagedUnitEvents'][number]
  >(`
    SELECT m.id AS movement_id, s.id AS stock_id
      FROM stock_movements m
      JOIN stock s ON s.product_id = m.product_id AND s.branch_id = m.branch_id
     WHERE NOT m.stock_managed AND m.product_unit_id IS NOT NULL
     ORDER BY m.seq`);

  const marker = await q<{ stock_rows: number; opening_rows: number }>(
    `SELECT stock_rows, opening_rows FROM stock_ledger_backfill`,
  );
  const markerProblems: string[] = [];
  if (!marker[0]) markerProblems.push('no completion marker');
  else if (marker[0].stock_rows !== marker[0].opening_rows) {
    markerProblems.push(
      `marker counts differ: ${marker[0].stock_rows} stock rows, ` +
        `${marker[0].opening_rows} opening balances`,
    );
  }

  return {
    unanchored,
    chainBreaks,
    quantityMismatches,
    unrecordedQuantities: withoutHistory.filter((r) => r.quantity !== 0),
    imeiMismatches: unitCounts
      .filter((r) => r.tracking_method === 'IMEI')
      .filter((r) => r.quantity !== r.in_stock_units)
      .map(({ stock_id, quantity, in_stock_units }) => ({
        stock_id,
        quantity,
        in_stock_units,
      })),
    negativeUntrackedSerials: unitCounts
      .filter((r) => r.tracking_method === 'SERIAL_NUMBER')
      .filter((r) => r.quantity < r.in_stock_units)
      .map(({ stock_id, quantity, in_stock_units }) => ({
        stock_id,
        quantity,
        in_stock_units,
      })),
    markerProblems,
    informational: {
      untrackedSerialQuantities: unitCounts
        .filter((r) => r.tracking_method === 'SERIAL_NUMBER')
        .map((r) => ({
          stock_id: r.stock_id,
          untracked: r.quantity - r.in_stock_units,
        })),
      untrackedRowsWithUnits,
      unmanagedUnitEvents,
      emptyRowsWithoutHistory: withoutHistory
        .filter((r) => r.quantity === 0)
        .map(({ stock_id }) => ({ stock_id })),
    },
  };
}

/** The problem lists of a reconciliation (informational lists left out). */
export const reconciliationProblems = (r: StockLedgerReconciliation) => ({
  unanchored: r.unanchored,
  chainBreaks: r.chainBreaks,
  quantityMismatches: r.quantityMismatches,
  unrecordedQuantities: r.unrecordedQuantities,
  imeiMismatches: r.imeiMismatches,
  negativeUntrackedSerials: r.negativeUntrackedSerials,
  markerProblems: r.markerProblems,
});

/** What reconciliationProblems returns for a consistent ledger. */
export const NO_PROBLEMS = {
  unanchored: [],
  chainBreaks: [],
  quantityMismatches: [],
  unrecordedQuantities: [],
  imeiMismatches: [],
  negativeUntrackedSerials: [],
  markerProblems: [],
};
