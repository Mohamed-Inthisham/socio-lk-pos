import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { Branch } from '../../branches/entities/branch.entity';

@Entity('stock')
@Index('idx_stock_product_branch', ['product_id', 'branch_id'], {
  unique: true,
})
@Check('CHK_stock_quantity_nonneg', `quantity >= 0`)
@Check('CHK_stock_min_quantity_nonneg', `min_quantity >= 0`)
export class Stock {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'product_id' })
  product_id!: string;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Column({ type: 'uuid', name: 'branch_id' })
  branch_id!: string;

  @ManyToOne(() => Branch, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch!: Branch;

  @Column({ type: 'integer', default: 0 })
  quantity!: number;

  @Column({ type: 'integer', default: 0, name: 'min_quantity' })
  min_quantity!: number;

  @Column({ type: 'boolean', default: true, name: 'manage_stock' })
  manage_stock!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;
}
