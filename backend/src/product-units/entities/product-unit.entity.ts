import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { Branch } from '../../branches/entities/branch.entity';
import { ProductUnitStatus } from '../enums/product-unit-status.enum';
import { PhonePurchase } from '../../phone-purchases/entities/phone-purchase.entity';

@Entity('product_units')
@Check(`"status" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF')`)
@Check(`"buying_price" >= 0`)
@Check(`"selling_price" IS NULL OR "selling_price" >= 0`)
export class ProductUnit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  product_id!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column({ type: 'uuid' })
  branch_id!: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  imei!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: ProductUnitStatus.IN_STOCK,
  })
  status!: ProductUnitStatus;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  buying_price!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  selling_price!: string | null;

  @Column({ type: 'uuid', nullable: true })
  phone_purchase_id!: string | null;

  @ManyToOne(
    () => PhonePurchase,
    (phonePurchase) => phonePurchase.product_units,
    {
      onDelete: 'RESTRICT',
      nullable: true,
    },
  )
  @JoinColumn({ name: 'phone_purchase_id' })
  phone_purchase?: PhonePurchase;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
