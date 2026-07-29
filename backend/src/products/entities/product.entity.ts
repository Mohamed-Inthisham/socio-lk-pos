import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  Check,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ProductType } from '../enums/product-type.enum';
import { BarcodeType } from '../enums/barcode-type.enum';
import { PhoneCondition } from '../enums/phone-condition.enum';
import { Brand } from '../../brands/entities/brand.entity';
import { Category } from '../../categories/entities/category.entity';
import { Branch } from '../../branches/entities/branch.entity';

@Entity('products')
@Check(
  'CHK_products_type',
  `product_type IN ('PHONE', 'ACCESSORY', 'WATCH', 'SPEAKER')`,
)
@Check('CHK_products_barcode_type', `barcode_type IN ('CODE_128', 'EAN_13')`)
@Check(
  'CHK_products_phone_condition',
  `phone_condition IS NULL OR phone_condition IN ('NEW', 'USED')`,
)
@Check('CHK_products_buying_price_nonneg', `buying_price >= 0`)
@Check('CHK_products_selling_price_nonneg', `selling_price >= 0`)
@Check('CHK_products_warranty_months_nonneg', `warranty_months >= 0`)
@Check(
  'CHK_products_checking_warranty_days_nonneg',
  `checking_warranty_days >= 0`,
)
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20, name: 'product_type' })
  product_type!: ProductType;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Index('idx_products_sku', { unique: true })
  @Column({ type: 'varchar', length: 30 })
  sku!: string;

  @Index('idx_products_barcode', { unique: true })
  @Column({ type: 'varchar', length: 100 })
  barcode!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: BarcodeType.CODE_128,
    name: 'barcode_type',
  })
  barcode_type!: BarcodeType;

  @Column({ type: 'uuid', name: 'brand_id' })
  brand_id!: string;

  @ManyToOne(() => Brand, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'brand_id' })
  brand!: Brand;

  @Column({ type: 'uuid', name: 'category_id' })
  category_id!: string;

  @ManyToOne(() => Category, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category!: Category;

  @Column({ type: 'uuid', name: 'branch_id' })
  branch_id!: string;

  @ManyToOne(() => Branch, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch!: Branch;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'buying_price' })
  buying_price!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'selling_price' })
  selling_price!: string;

  @Column({ type: 'integer', default: 0, name: 'warranty_months' })
  warranty_months!: number;

  @Column({ type: 'integer', default: 0, name: 'checking_warranty_days' })
  checking_warranty_days!: number;

  @Column({ type: 'boolean', default: false, name: 'is_serialized' })
  is_serialized!: boolean;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  is_active!: boolean;

  // ---- Phone-specific fields ----
  // Nullable — only meaningful when product_type = 'PHONE'.
  // Enforced at UI level, not blocked at API level (lax) so admin can
  // create phones fast and fill in details later.

  @Column({
    type: 'varchar',
    length: 10,
    nullable: true,
    name: 'phone_condition',
  })
  phone_condition!: PhoneCondition | null;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'phone_model' })
  phone_model!: string | null;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    name: 'phone_storage',
  })
  phone_storage!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'phone_color' })
  phone_color!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'phone_ram' })
  phone_ram!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deleted_at!: Date | null;
}
