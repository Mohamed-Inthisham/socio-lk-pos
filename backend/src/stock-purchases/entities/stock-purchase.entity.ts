import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Branch } from '../../branches/entities/branch.entity';
import { Supplier } from '../../suppliers/entities/supplier.entity';
import { User } from '../../users/entities/user.entity';
import { StockPurchaseItem } from './stock-purchase-item.entity';
import { StockPurchasePayment } from './stock-purchase-payment.entity';

@Entity('stock_purchases')
export class StockPurchase {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  purchase_number!: string;

  @Column({ type: 'uuid', name: 'supplier_id' })
  supplier_id!: string;

  @ManyToOne(() => Supplier, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'supplier_id' })
  supplier!: Supplier;

  @Column({ type: 'uuid', name: 'branch_id' })
  branch_id!: string;

  @ManyToOne(() => Branch, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch!: Branch;

  @Column({ type: 'uuid', name: 'created_by_id' })
  created_by_id!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  created_by!: User;

  @Column({ type: 'date', name: 'purchase_date' })
  purchase_date!: string;

  @Column({
    type: 'varchar',
    length: 100,
    name: 'supplier_invoice_number',
    nullable: true,
  })
  supplier_invoice_number!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, name: 'total_amount' })
  total_amount!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @OneToMany(() => StockPurchaseItem, (item) => item.purchase)
  items!: StockPurchaseItem[];

  @OneToMany(() => StockPurchasePayment, (payment) => payment.purchase)
  payments!: StockPurchasePayment[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;
}
