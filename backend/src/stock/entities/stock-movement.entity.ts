import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { Branch } from '../../branches/entities/branch.entity';
import { ProductUnit } from '../../product-units/entities/product-unit.entity';
import { User } from '../../users/entities/user.entity';
import { ProductUnitStatus } from '../../product-units/enums/product-unit-status.enum';
import {
  StockMovementReferenceType,
  StockMovementType,
} from '../enums/stock-movement-type.enum';

/**
 * The stock movement ledger (Phase 1 T1): one append-only row per change
 * to a stock row's quantity or to a product unit's status, written by
 * StockService inside the same transaction as the change, under the stock
 * row's lock. See the CreateStockMovements migration for the constraints
 * and the append-only trigger; names here match it so generated
 * migrations see no drift.
 *
 * quantity_before / quantity_after are the stock row's quantity around
 * this change (equal for a status-only change); for each stock row,
 * ordered by seq, each row's quantity_before is the previous row's
 * quantity_after. stock_managed is the row's manage_stock at the time: an
 * untracked row's unit events are recorded with quantity_delta 0.
 *
 * No prices: the ledger never carries cost.
 */
@Entity('stock_movements')
@Unique('UQ_stock_movements_seq', ['seq'])
@Check(
  'CHK_stock_movements_type',
  `"movement_type" IN ('OPENING_BALANCE', 'PURCHASE', 'TRADE_IN', 'SALE', 'REVERSAL', 'CUSTOMER_RETURN', 'INSPECTION_PASSED', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT')`,
)
@Check(
  'CHK_stock_movements_reference_type',
  `"reference_type" IN ('STOCK', 'STOCK_ADJUSTMENT', 'STOCK_PURCHASE_ITEM', 'PHONE_PURCHASE', 'PAYMENT', 'SALE_LINE', 'SALE_RETURN_LINE')`,
)
@Check(
  'CHK_stock_movements_chain',
  `"quantity_after" = "quantity_before" + "quantity_delta" AND "quantity_before" >= 0 AND "quantity_after" >= 0`,
)
@Check(
  'CHK_stock_movements_unit_status',
  `("unit_status_from" IS NULL OR "unit_status_from" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF', 'INSPECTION')) AND ("unit_status_to" IS NULL OR "unit_status_to" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF', 'INSPECTION'))`,
)
@Check(
  'CHK_stock_movements_unit',
  `CASE WHEN "product_unit_id" IS NULL THEN "unit_status_from" IS NULL AND "unit_status_to" IS NULL ELSE "unit_status_to" IS NOT NULL END`,
)
@Check(
  'CHK_stock_movements_nonzero',
  `"quantity_delta" <> 0 OR "unit_status_from" IS DISTINCT FROM "unit_status_to" OR "movement_type" = 'OPENING_BALANCE'`,
)
@Check(
  'CHK_stock_movements_adjustment',
  `("movement_type" NOT IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT') OR length(trim(coalesce("reason_code", ''))) > 0) AND ("movement_type" <> 'ADJUSTMENT_IN' OR "quantity_delta" > 0) AND ("movement_type" <> 'ADJUSTMENT_OUT' OR "quantity_delta" < 0)`,
)
@Check(
  'CHK_stock_movements_reverses',
  `"reverses_movement_id" IS NULL OR "movement_type" = 'REVERSAL'`,
)
@Check(
  'CHK_stock_movements_created_by',
  `"created_by_id" IS NOT NULL OR "movement_type" = 'OPENING_BALANCE'`,
)
@Check(
  'CHK_stock_movements_approved_by',
  `("movement_type" IN ('REVERSAL', 'CUSTOMER_RETURN')) = ("approved_by_id" IS NOT NULL)`,
)
@Index('idx_stock_movements_product_branch_seq', [
  'product_id',
  'branch_id',
  'seq',
])
@Index('idx_stock_movements_unit_seq', ['product_unit_id', 'seq'], {
  where: `"product_unit_id" IS NOT NULL`,
})
@Index('idx_stock_movements_reference', ['reference_type', 'reference_id'])
@Index('idx_stock_movements_branch_created_at', ['branch_id', 'created_at'])
// One row per business event: per stock row for quantity movements, per
// unit for unit movements (two partial indexes, so no key column is NULL).
@Index(
  'uq_stock_movements_event_quantity',
  ['movement_type', 'reference_type', 'reference_id'],
  { unique: true, where: `"product_unit_id" IS NULL` },
)
@Index(
  'uq_stock_movements_event_unit',
  ['movement_type', 'reference_type', 'reference_id', 'product_unit_id'],
  { unique: true, where: `"product_unit_id" IS NOT NULL` },
)
export class StockMovement {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_stock_movements_id',
  })
  id!: string;

  /** Insertion order (bigint identity, so a string in JS). */
  @Column({
    type: 'bigint',
    generated: 'identity',
    generatedIdentity: 'ALWAYS',
  })
  seq!: string;

  @Column({ type: 'uuid' })
  product_id!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'FK_stock_movements_product',
  })
  product?: Product;

  @Column({ type: 'uuid' })
  branch_id!: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'branch_id',
    foreignKeyConstraintName: 'FK_stock_movements_branch',
  })
  branch?: Branch;

  @Column({ type: 'uuid', nullable: true })
  product_unit_id!: string | null;

  @ManyToOne(() => ProductUnit, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'product_unit_id',
    foreignKeyConstraintName: 'FK_stock_movements_product_unit',
  })
  product_unit?: ProductUnit | null;

  @Column({ type: 'varchar', length: 30 })
  movement_type!: StockMovementType;

  @Column({ type: 'integer' })
  quantity_delta!: number;

  @Column({ type: 'integer' })
  quantity_before!: number;

  @Column({ type: 'integer' })
  quantity_after!: number;

  @Column({ type: 'boolean' })
  stock_managed!: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  unit_status_from!: ProductUnitStatus | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  unit_status_to!: ProductUnitStatus | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  reason_code!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 40 })
  reference_type!: StockMovementReferenceType;

  @Column({ type: 'uuid' })
  reference_id!: string;

  @Column({ type: 'uuid', nullable: true })
  reverses_movement_id!: string | null;

  @ManyToOne(() => StockMovement, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'reverses_movement_id',
    foreignKeyConstraintName: 'FK_stock_movements_reverses',
  })
  reverses_movement?: StockMovement | null;

  /** Who did it (the requester for approved movements). */
  @Column({ type: 'uuid', nullable: true })
  created_by_id!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_stock_movements_created_by',
  })
  created_by?: User | null;

  /** The manager or admin whose PIN approved it (voids and returns). */
  @Column({ type: 'uuid', nullable: true })
  approved_by_id!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'approved_by_id',
    foreignKeyConstraintName: 'FK_stock_movements_approved_by',
  })
  approved_by?: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
