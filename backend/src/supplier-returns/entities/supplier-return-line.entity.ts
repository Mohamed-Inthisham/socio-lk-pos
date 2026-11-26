import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { StockPurchaseItem } from '../../stock-purchases/entities/stock-purchase-item.entity';
import { ExposeCost } from '../../common/utils/cost-visibility';
import { SupplierReturn } from './supplier-return.entity';
import { SupplierReturnLineUnit } from './supplier-return-line-unit.entity';

@Entity('supplier_return_lines')
@Unique('UQ_supplier_return_lines_return_item', [
  'supplier_return_id',
  'stock_purchase_item_id',
])
@Check('CHK_supplier_return_lines_quantity', '"quantity" > 0')
@Check('CHK_supplier_return_lines_unit_cost', '"unit_cost_snapshot" >= 0')
export class SupplierReturnLine {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_supplier_return_lines_id',
  })
  id!: string;

  @Column({ type: 'uuid', name: 'supplier_return_id' })
  supplier_return_id!: string;

  @ManyToOne(() => SupplierReturn, (supplierReturn) => supplierReturn.lines, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'supplier_return_id',
    foreignKeyConstraintName: 'FK_supplier_return_lines_return',
  })
  supplier_return!: SupplierReturn;

  @Index('idx_supplier_return_lines_purchase_item')
  @Column({ type: 'uuid', name: 'stock_purchase_item_id' })
  stock_purchase_item_id!: string;

  @ManyToOne(() => StockPurchaseItem, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'stock_purchase_item_id',
    foreignKeyConstraintName: 'FK_supplier_return_lines_purchase_item',
  })
  purchase_item!: StockPurchaseItem;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    name: 'unit_cost_snapshot',
  })
  @ExposeCost()
  unit_cost_snapshot!: string;

  @OneToMany(() => SupplierReturnLineUnit, (unit) => unit.supplier_return_line)
  units!: SupplierReturnLineUnit[];
}
