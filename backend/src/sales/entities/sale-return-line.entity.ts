import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Check,
  Unique,
  Index,
} from 'typeorm';
import { SaleReturn } from './sale-return.entity';
import { SaleLine } from './sale-line.entity';
import { ProductUnit } from '../../product-units/entities/product-unit.entity';
import { ReturnDisposition } from '../enums/return-disposition.enum';

/**
 * What one return took back from one sale line (Phase 6.4 P7-2, P7-8).
 *
 * refund_share is this line's share of what the customer paid for these
 * units (P7-3): every return on a line adds up exactly to its line_total.
 * out_of_warranty is the server's verdict when the return was made
 * (P7-22). disposition says where the items went; a returned phone
 * (INSPECTION) names its unit, and only then
 * (CHK_sale_return_lines_unit).
 *
 * No timestamps: the return's created_at is when it was made.
 * Constraint and index names match the CreateSaleReturns migration.
 */
@Entity('sale_return_lines')
@Unique('UQ_sale_return_lines_return_line', ['sale_return_id', 'sale_line_id'])
@Check('CHK_sale_return_lines_qty_positive', `"quantity" > 0`)
@Check('CHK_sale_return_lines_refund_share_nonneg', `"refund_share" >= 0`)
@Check(
  'CHK_sale_return_lines_disposition',
  `"disposition" IN ('RESTOCKED', 'DAMAGED', 'INSPECTION', 'NOT_OUR_STOCK', 'UNTRACKED')`,
)
@Check(
  'CHK_sale_return_lines_unit',
  `("disposition" = 'INSPECTION') = ("product_unit_id" IS NOT NULL)`,
)
export class SaleReturnLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'sale_return_id' })
  sale_return_id!: string;

  @ManyToOne(() => SaleReturn, (saleReturn) => saleReturn.lines, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'sale_return_id',
    foreignKeyConstraintName: 'FK_sale_return_lines_return',
  })
  sale_return?: SaleReturn;

  @Index('idx_sale_return_lines_sale_line_id')
  @Column({ type: 'uuid', name: 'sale_line_id' })
  sale_line_id!: string;

  @ManyToOne(() => SaleLine, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'sale_line_id',
    foreignKeyConstraintName: 'FK_sale_return_lines_sale_line',
  })
  sale_line?: SaleLine;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'refund_share' })
  refund_share!: string;

  @Column({ type: 'boolean', name: 'out_of_warranty' })
  out_of_warranty!: boolean;

  @Column({ type: 'varchar', length: 20 })
  disposition!: ReturnDisposition;

  // The returned phone (INSPECTION lines only); the inspection list
  // finds a unit's latest return through it.
  @Index('idx_sale_return_lines_product_unit_id', {
    where: `"product_unit_id" IS NOT NULL`,
  })
  @Column({ type: 'uuid', nullable: true, name: 'product_unit_id' })
  product_unit_id!: string | null;

  @ManyToOne(() => ProductUnit, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'product_unit_id',
    foreignKeyConstraintName: 'FK_sale_return_lines_product_unit',
  })
  product_unit?: ProductUnit;
}
