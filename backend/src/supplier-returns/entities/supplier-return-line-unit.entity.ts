import { Entity, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { ProductUnit } from '../../product-units/entities/product-unit.entity';
import { SupplierReturnLine } from './supplier-return-line.entity';

@Entity('supplier_return_line_units')
@Unique('UQ_supplier_return_line_units_product_unit', ['product_unit_id'])
export class SupplierReturnLineUnit {
  @PrimaryColumn({
    type: 'uuid',
    name: 'supplier_return_line_id',
    primaryKeyConstraintName: 'PK_supplier_return_line_units',
  })
  supplier_return_line_id!: string;

  @ManyToOne(() => SupplierReturnLine, (line) => line.units, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'supplier_return_line_id',
    foreignKeyConstraintName: 'FK_supplier_return_line_units_line',
  })
  supplier_return_line!: SupplierReturnLine;

  @PrimaryColumn({
    type: 'uuid',
    name: 'product_unit_id',
    primaryKeyConstraintName: 'PK_supplier_return_line_units',
  })
  product_unit_id!: string;

  @ManyToOne(() => ProductUnit, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'product_unit_id',
    foreignKeyConstraintName: 'FK_supplier_return_line_units_product_unit',
  })
  product_unit!: ProductUnit;
}
