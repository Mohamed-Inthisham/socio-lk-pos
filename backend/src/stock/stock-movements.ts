import { EntityManager } from 'typeorm';
import { ProductUnitStatus } from '../product-units/enums/product-unit-status.enum';
import {
  StockMovementReferenceType,
  StockMovementType,
} from './enums/stock-movement-type.enum';

/**
 * What a stock change tells the ledger about itself (Phase 1 T1): the
 * business event, who did it and, for a unit, its status change. The
 * quantities come from the stock row, which StockService reads under its
 * lock; callers never pass them.
 */
export interface StockMovementInput {
  type: StockMovementType;
  referenceType: StockMovementReferenceType;
  referenceId: string;
  /** Who did it; the requester when someone else approved it. */
  createdById: string | null;
  /** The approver, for REVERSAL and CUSTOMER_RETURN only. */
  approvedById?: string | null;
  /** The unit and its status change; from is null when it is created. */
  unit?: {
    id: string;
    from: ProductUnitStatus | null;
    to: ProductUnitStatus;
  };
  reversesMovementId?: string | null;
  reasonCode?: string | null;
  note?: string | null;
}

/** One ledger row, as StockService has worked it out. */
export interface StockMovementRow {
  productId: string;
  branchId: string;
  quantityDelta: number;
  quantityBefore: number;
  stockManaged: boolean;
  movement: StockMovementInput;
}

/**
 * Insert one row into stock_movements inside the caller's transaction and
 * return its id. Only StockService calls this, right after the change it
 * records and under the stock row's lock, so quantity_before is the
 * row's quantity at that moment and rows for one stock row are in seq
 * order. The table's CHECKs, foreign keys and unique indexes refuse a
 * malformed or repeated row; that error propagates and rolls back the
 * whole transaction, change included.
 */
export async function insertStockMovement(
  manager: EntityManager,
  row: StockMovementRow,
): Promise<string> {
  const { movement } = row;
  const rows: { id: string }[] = await manager.query(
    `INSERT INTO "stock_movements" (
       "product_id", "branch_id", "product_unit_id", "movement_type",
       "quantity_delta", "quantity_before", "quantity_after", "stock_managed",
       "unit_status_from", "unit_status_to", "reason_code", "note",
       "reference_type", "reference_id", "reverses_movement_id",
       "created_by_id", "approved_by_id"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING "id"`,
    [
      row.productId,
      row.branchId,
      movement.unit?.id ?? null,
      movement.type,
      row.quantityDelta,
      row.quantityBefore,
      row.quantityBefore + row.quantityDelta,
      row.stockManaged,
      movement.unit?.from ?? null,
      movement.unit?.to ?? null,
      movement.reasonCode ?? null,
      movement.note ?? null,
      movement.referenceType,
      movement.referenceId,
      movement.reversesMovementId ?? null,
      movement.createdById,
      movement.approvedById ?? null,
    ],
  );
  return rows[0].id;
}
