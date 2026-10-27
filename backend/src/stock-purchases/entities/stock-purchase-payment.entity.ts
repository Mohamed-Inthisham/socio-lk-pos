import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { StockPurchase } from './stock-purchase.entity';
import { StockPurchasePaymentMethod } from '../enums/stock-purchase-payment-method.enum';
import { StockPurchasePaymentStatus } from '../enums/stock-purchase-payment-status.enum';

@Entity('stock_purchase_payments')
@Check('CHK_stock_purchase_payments_amount', 'amount > 0')
@Check(
  'CHK_stock_purchase_payments_method',
  `method IN ('CASH', 'CARD', 'ONLINE_TRANSFER', 'CHEQUE')`,
)
@Check(
  'CHK_stock_purchase_payments_status',
  `status IN ('CLEARED', 'PENDING', 'BOUNCED')`,
)
export class StockPurchasePayment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'stock_purchase_id' })
  stock_purchase_id!: string;

  @ManyToOne(() => StockPurchase, (purchase) => purchase.payments, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'stock_purchase_id' })
  purchase!: StockPurchase;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 20 })
  method!: StockPurchasePaymentMethod;

  @Column({ type: 'varchar', length: 20, default: StockPurchasePaymentStatus.CLEARED })
  status!: StockPurchasePaymentStatus;

  @Column({ type: 'date', name: 'payment_date' })
  payment_date!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  reference!: string | null;

  @Column({ type: 'varchar', length: 50, name: 'cheque_number', nullable: true })
  cheque_number!: string | null;

  @Column({ type: 'date', name: 'cheque_date', nullable: true })
  cheque_date!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  bank!: string | null;

  @Column({ type: 'uuid', name: 'created_by_id' })
  created_by_id!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  created_by!: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;
}
