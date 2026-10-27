import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { StockPurchase } from './stock-purchase.entity';

@Entity('stock_purchase_items')
@Check('CHK_stock_purchase_items_quantity', 'quantity > 0')
@Check('CHK_stock_purchase_items_buying_price', 'unit_buying_price >= 0')
@Check(
  'CHK_stock_purchase_items_selling_price',
  'unit_selling_price IS NULL OR unit_selling_price >= 0',
)
export class StockPurchaseItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'stock_purchase_id' })
  stock_purchase_id!: string;

  @ManyToOne(() => StockPurchase, (purchase) => purchase.items, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'stock_purchase_id' })
  purchase!: StockPurchase;

  @Column({ type: 'uuid', name: 'product_id' })
  product_id!: string;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Column({ type: 'varchar', length: 200, name: 'product_name_snapshot' })
  product_name_snapshot!: string;

  @Column({ type: 'varchar', length: 30, name: 'product_sku_snapshot' })
  product_sku_snapshot!: string;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'unit_buying_price' })
  unit_buying_price!: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    name: 'unit_selling_price',
    nullable: true,
  })
  unit_selling_price!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, name: 'line_total' })
  line_total!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  imei_numbers!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  serial_numbers!: string[];
}
