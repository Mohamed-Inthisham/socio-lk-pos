import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Check,
  Index,
} from 'typeorm';
import { Sale } from './sale.entity';
import { PaymentMethod } from '../enums/payment-method.enum';

/**
 * A single tender on a Sale. Sales support multi-tender: one sale can
 * have N payments (e.g. Rs. 400 on card + Rs. 550 cash). Sale.amount_paid
 * is SUM(payments.amount), maintained by SalesService.
 *
 * DRAFT-only mutations. Once the parent Sale is COMPLETED or VOIDED,
 * payments are immutable financial records. Void is sale-level (Slice G).
 * Hard-deleted only when the parent Sale is a DRAFT being discarded
 * (ON DELETE CASCADE from sales).
 *
 * The `amount` field is money applied to this sale — SUM(amount) must
 * equal Sale.total before the sale can complete (enforced in Slice F).
 * A DB CHECK on Sale (amount_paid <= total) backstops the service.
 *
 * `cash_received` is only meaningful for CASH payments: it's the physical
 * cash the customer handed over. cash_received - amount = change owed
 * back. Computed at receipt time, not stored, so there's no risk of the
 * two fields drifting. Sale.change_due accumulates from here.
 *
 * `reference_number` is nullable at the schema level so future payment
 * methods don't need a migration if they're reference-less, but it's
 * REQUIRED at the service layer for all methods except CASH — a card
 * or KOKO payment without a reference is a reconciliation nightmare.
 *
 * No payment_status column. Payments are immediately final when recorded
 * in 6.3. Sale-level void handles reversal for the SOCIO.LK business.
 * If gateway integration later requires PENDING/CONFIRMED, add then.
 */
@Entity('payments')
@Check(
  'CHK_payments_method',
  `payment_method IN ('CASH', 'CARD', 'BANK_TRANSFER', 'KOKO', 'MINTPAY')`,
)
@Check('CHK_payments_amount_positive', `amount > 0`)
@Check(
  'CHK_payments_cash_received_only_for_cash',
  `(payment_method = 'CASH') = (cash_received IS NOT NULL)`,
)
@Check(
  'CHK_payments_cash_received_covers_amount',
  `cash_received IS NULL OR cash_received >= amount`,
)
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_payments_sale_id')
  @Column({ type: 'uuid', name: 'sale_id' })
  sale_id!: string;

  @ManyToOne(() => Sale, (sale) => sale.payments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sale_id' })
  sale?: Sale;

  @Column({ type: 'varchar', length: 20, name: 'payment_method' })
  payment_method!: PaymentMethod;

  // Money applied to the sale. Bounded above by Sale.total - SUM(other
  // payments) at the service layer, with a Sale-level CHECK
  // (amount_paid <= total) as backstop.
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string;

  // CASH only: physical cash handed over by the customer. Must be
  // >= amount. Change = cash_received - amount (computed on receipt).
  // NULL for all other methods (enforced by CHK).
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'cash_received',
  })
  cash_received!: string | null;

  // Required at service layer for all methods except CASH. Terminal auth
  // code (CARD), bank slip reference (BANK_TRANSFER), or provider txn ID
  // (KOKO/MINTPAY). Nullable at DB level for future-flexibility.
  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    name: 'reference_number',
  })
  reference_number!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;
}
