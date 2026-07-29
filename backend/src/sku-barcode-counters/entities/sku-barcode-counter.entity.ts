import { Entity, PrimaryGeneratedColumn, Column, Check } from 'typeorm';
import { CounterType } from '../enums/counter-type.enum';

@Entity('sku_barcode_counters')
@Check('CHK_sku_barcode_counters_type', `counter_type IN ('SKU', 'BARCODE')`)
export class SkuBarcodeCounter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20, name: 'counter_type', unique: true })
  counter_type!: CounterType;

  @Column({ type: 'varchar', length: 20 })
  prefix!: string;

  @Column({ type: 'integer', default: 0, name: 'current_value' })
  current_value!: number;
}
