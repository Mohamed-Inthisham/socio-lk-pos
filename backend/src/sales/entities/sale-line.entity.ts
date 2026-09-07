import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Check,
  Unique,
  Index,
} from 'typeorm';
import { Sale } from './sale.entity';
import { Product } from '../../products/entities/product.entity';
import { Supplier } from '../../suppliers/entities/supplier.entity';
import { DiscountType } from '../enums/discount-type.enum';

/**
 * A single line on a Sale — one product, one quantity, one optional discount.
 *
 * Snapshot columns (product_sku_snapshot, product_name_snapshot, unit_price,
 * cost_price_snapshot) freeze the product's identity and pricing AT SALE TIME.
 * If the product is later renamed, repriced, or reSKU'd, historical sales
 * still show what the cashier actually rang up. Reports never need to
 * time-travel the products table.
 *
 * Discount model: client sends {discount_type, discount_value} — server
 * resolves that into an absolute LKR discount_amount. Never trust the
 * client's discount_amount. Line-level discounts only; no sale-level
 * discount. Sale.discount_total = SUM(sale_lines.discount_amount).
 *
 * line_total is stored (not computed on read) for consistency with Sale's
 * snapshot-style totals and to keep reporting queries cheap. A CHECK
 * constraint enforces line_total = round(unit_price * qty - discount_amount, 2).
 *
 * line_number is per-sale and assigned as max+1 by the service. Gaps are
 * allowed (removes don't renumber). UNIQUE(sale_id, line_number) enforced
 * at the DB.
 *
 * Immutable once the parent Sale is COMPLETED or VOIDED — enforced at the
 * service layer (Slice D2). Hard-deleted only when the parent Sale is a
 * DRAFT being discarded (ON DELETE CASCADE from sales).
 *
 * external_supplier_id marks a line sourced from a friendly shop rather
 * than our own stock. Nullable, indexed partially (WHERE NOT NULL) since
 * it's sparse. Stock hooks in Slice F skip decrementing our stock when
 * this is set.
 *
 * imei_snapshot is free-text in 6.3. In Phase 6.3.5 it will be validated
 * against ProductUnit for serialized products.
 */
@Entity('sale_lines')
@Unique('UQ_sale_lines_sale_line_number', ['sale_id', 'line_number'])
@Check('CHK_sale_lines_qty_positive', `quantity > 0`)
@Check('CHK_sale_lines_line_number_positive', `line_number > 0`)
@Check('CHK_sale_lines_unit_price_nonneg', `unit_price >= 0`)
@Check('CHK_sale_lines_cost_price_nonneg', `cost_price_snapshot >= 0`)
@Check('CHK_sale_lines_discount_amount_nonneg', `discount_amount >= 0`)
@Check(
  'CHK_sale_lines_discount_bounded',
  `discount_amount <= unit_price * quantity`,
)
@Check(
  'CHK_sale_lines_discount_consistency',
  `(discount_type IS NULL) = (discount_value IS NULL)`,
)
@Check(
  'CHK_sale_lines_discount_type',
  `discount_type IS NULL OR discount_type IN ('AMOUNT', 'PERCENT')`,
)
@Check(
  'CHK_sale_lines_discount_percent_range',
  `discount_type != 'PERCENT' OR (discount_value >= 0 AND discount_value <= 100)`,
)
@Check(
  'CHK_sale_lines_discount_amount_value_nonneg',
  `discount_type != 'AMOUNT' OR discount_value >= 0`,
)
@Check(
  'CHK_sale_lines_line_total',
  `line_total = ROUND(unit_price * quantity - discount_amount, 2)`,
)
export class SaleLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_sale_lines_sale_id')
  @Column({ type: 'uuid', name: 'sale_id' })
  sale_id!: string;

  @ManyToOne(() => Sale, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sale_id' })
  sale?: Sale;

  @Column({ type: 'smallint', name: 'line_number' })
  line_number!: number;

  @Index('idx_sale_lines_product_id')
  @Column({ type: 'uuid', name: 'product_id' })
  product_id!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  // ---- Snapshot columns (frozen at add-time) ----

  @Column({ type: 'varchar', length: 30, name: 'product_sku_snapshot' })
  product_sku_snapshot!: string;

  @Column({ type: 'varchar', length: 200, name: 'product_name_snapshot' })
  product_name_snapshot!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'unit_price' })
  unit_price!: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    name: 'cost_price_snapshot',
  })
  cost_price_snapshot!: string;

  // ---- Quantity + discount ----

  @Column({ type: 'integer' })
  quantity!: number;

  // Both discount_type and discount_value are NULL together (no discount),
  // or both set together (a discount was applied). See CHK_..._consistency.
  @Column({
    type: 'varchar',
    length: 10,
    nullable: true,
    name: 'discount_type',
  })
  discount_type!: DiscountType | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'discount_value',
  })
  discount_value!: string | null;

  // Server-resolved absolute LKR value. Defaults to 0 for lines with no discount.
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    name: 'discount_amount',
  })
  discount_amount!: string;

  // Server-computed: round(unit_price * quantity - discount_amount, 2).
  // Enforced by CHK_sale_lines_line_total.
  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'line_total' })
  line_total!: string;

  // ---- Sourcing + serialization ----

  @Column({ type: 'uuid', nullable: true, name: 'external_supplier_id' })
  external_supplier_id!: string | null;

  @ManyToOne(() => Supplier, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'external_supplier_id' })
  external_supplier?: Supplier;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    name: 'imei_snapshot',
  })
  imei_snapshot!: string | null;

  // ---- Timestamps ----

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;
}
