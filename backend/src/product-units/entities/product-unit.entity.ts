import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { Branch } from '../../branches/entities/branch.entity';
import { ProductUnitStatus } from '../enums/product-unit-status.enum';
import { PhonePurchase } from '../../phone-purchases/entities/phone-purchase.entity';
import { SaleLine } from '../../sales/entities/sale-line.entity';

@Entity('product_units')
// Named as in the migrations, so generated migrations see no drift.
@Check(
  'CHK_product_units_status',
  `"status" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF', 'INSPECTION')`,
)
@Check('CHK_product_units_buying_price_nonneg', `"buying_price" >= 0`)
@Check(
  'CHK_product_units_selling_price_nonneg',
  `"selling_price" IS NULL OR "selling_price" >= 0`,
)
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

  // One row per acquired unit: its identifier is unique among units
  // the shop holds (IN_STOCK, WRITTEN_OFF, INSPECTION). SOLD and RETURNED
  // rows are history and may repeat an identifier after reacquisition.
  // Mirrors uq_product_units_imei_live and LIVE_UNIT_STATUSES; the plain
  // index serves lookups across all statuses.
  @Index('uq_product_units_imei_live', {
    unique: true,
    where: `"status" IN ('IN_STOCK', 'WRITTEN_OFF', 'INSPECTION')`,
  })
  @Index('idx_product_units_imei')
  // Legacy column name. Stores the product's chosen per-unit identifier:
  // IMEI for IMEI-tracked products, serial number for serial-tracked ones.
  @Column({ type: 'varchar', length: 100 })
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

  /**
   * All sale lines that have referenced this ProductUnit. A PU can
   * appear on more than one sale line across its lifetime — e.g. sold
   * on sale A (status → SOLD), then sale A voided (status → IN_STOCK
   * again, but sale A's line still legitimately references the PU
   * historically), then sold again on sale B. Both sale_line rows are
   * valid steady state.
   *
   * Populated only on explicit load — not eagerly hydrated (see Slice E
   * Q9). Kept as an inverse-side declaration to enable typed joins from
   * ProductUnit queries when analytics or reporting need it.
   */
  @OneToMany(() => SaleLine, (line) => line.product_unit)
  sale_lines?: SaleLine[];
}
