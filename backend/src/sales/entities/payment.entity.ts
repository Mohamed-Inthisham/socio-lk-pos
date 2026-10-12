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
import { Product } from '../../products/entities/product.entity';
import { PhonePurchase } from '../../phone-purchases/entities/phone-purchase.entity';

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
 * TRADE_IN payments carry six additional nullable columns (see the
 * trade-in fields block below) — populated only when payment_method =
 * TRADE_IN, all NULL otherwise. The related PhonePurchase materializes
 * at completeSale; during DRAFT the trade-in data lives on the payment
 * row alone. Voiding a sale with TRADE_IN reverses the incoming
 * ProductUnit (IN_STOCK -> RETURNED) and Stock — see SalesService.voidSale.
 *
 * No payment_status column. Payments are immediately final when recorded
 * in 6.3. Sale-level void handles reversal for the SOCIO.LK business.
 * If gateway integration later requires PENDING/CONFIRMED, add then.
 */
@Entity('payments')
@Check(
  'CHK_payments_method',
  `payment_method IN ('CASH', 'CARD', 'BANK_TRANSFER', 'KOKO', 'MINTPAY', 'TRADE_IN')`,
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
@Check(
  'CHK_payments_reversal_consistency',
  `(reversed_at IS NOT NULL) = (reversal_reason IS NOT NULL AND length(trim(reversal_reason)) > 0)`,
)
@Check(
  'CHK_payments_trade_in_fields_consistent',
  `(payment_method = 'TRADE_IN') = (trade_in_product_id IS NOT NULL AND trade_in_imei IS NOT NULL AND trade_in_buying_price IS NOT NULL)`,
)
@Check(
  'CHK_payments_trade_in_fields_null_when_not_trade_in',
  `payment_method = 'TRADE_IN' OR (trade_in_product_id IS NULL AND trade_in_imei IS NULL AND trade_in_buying_price IS NULL AND trade_in_selling_price IS NULL AND trade_in_notes IS NULL AND trade_in_phone_purchase_id IS NULL)`,
)
@Check(
  'CHK_payments_trade_in_amount_matches',
  `payment_method != 'TRADE_IN' OR amount = trade_in_buying_price`,
)
@Check(
  'CHK_payments_trade_in_pp_reference',
  `trade_in_phone_purchase_id IS NULL OR payment_method = 'TRADE_IN'`,
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

  // Set together (both NULL, or both populated) when the parent Sale
  // is voided in Slice G. reversal_reason mirrors sale.void_reason at
  // void time — the cashier enters the reason once at the sale level,
  // and the void transaction stamps it onto every payment. The
  // both-or-neither invariant is enforced by CHK_payments_reversal_consistency;
  // the "iff parent sale is VOIDED" invariant lives at the service
  // layer (cross-table CHECKs aren't supported in Postgres).
  @Column({ type: 'timestamptz', nullable: true, name: 'reversed_at' })
  reversed_at!: Date | null;

  @Column({ type: 'text', nullable: true, name: 'reversal_reason' })
  reversal_reason!: string | null;

  // ---- Trade-in fields (populated only when payment_method = TRADE_IN) ----
  //
  // These six columns hold trade-in intake data. During DRAFT, they carry
  // the cashier's intent (which product, which IMEI, agreed value).
  // At completeSale, phonePurchasesService.createForTradeIn materializes
  // a PhonePurchase + ProductUnit (IN_STOCK) + Stock increment atomically
  // and stamps the resulting PhonePurchase id onto
  // trade_in_phone_purchase_id.
  //
  // On void: the ProductUnit flips IN_STOCK -> RETURNED and Stock is
  // decremented. If the ProductUnit has since been SOLD on a subsequent
  // sale, the void is blocked with 409 (Q7 lock).
  //
  // CHK constraints enforce:
  //   - required trio (product_id, imei, buying_price) IFF method = TRADE_IN
  //   - all six fields NULL when method != TRADE_IN
  //   - amount = trade_in_buying_price when method = TRADE_IN
  //   - trade_in_phone_purchase_id populated only when method = TRADE_IN

  @Column({ type: 'uuid', nullable: true, name: 'trade_in_product_id' })
  trade_in_product_id!: string | null;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trade_in_product_id' })
  trade_in_product?: Product;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    name: 'trade_in_imei',
  })
  trade_in_imei!: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'trade_in_buying_price',
  })
  trade_in_buying_price!: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'trade_in_selling_price',
  })
  trade_in_selling_price!: string | null;

  @Column({ type: 'text', nullable: true, name: 'trade_in_notes' })
  trade_in_notes!: string | null;

  @Column({
    type: 'uuid',
    nullable: true,
    name: 'trade_in_phone_purchase_id',
  })
  trade_in_phone_purchase_id!: string | null;

  @ManyToOne(() => PhonePurchase, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trade_in_phone_purchase_id' })
  trade_in_phone_purchase?: PhonePurchase;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;
}
