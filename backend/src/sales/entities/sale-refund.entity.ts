import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Check,
  Index,
} from 'typeorm';
import { SaleReturn } from './sale-return.entity';
import { Payment } from './payment.entity';
import { PaymentMethod } from '../enums/payment-method.enum';

/** A refund goes back as any tender except a trade-in (P7-4). */
export type RefundMethod = Exclude<PaymentMethod, PaymentMethod.TRADE_IN>;

/**
 * Money handed back on a return (Phase 6.4 P7-4). CASH, or back to a
 * non-cash payment of the sale (original_payment_id, same method) with
 * the reference of the reversal done on the card machine or provider
 * portal. Never TRADE_IN; no store credit. A return may split its refund
 * across several rows.
 *
 * The service keeps the rules that span tables: the payment belongs to
 * the return's sale, and the refunds against one payment never exceed
 * its amount.
 *
 * Constraint and index names match the CreateSaleReturns migration.
 */
@Entity('sale_refunds')
@Check(
  'CHK_sale_refunds_method',
  `"method" IN ('CASH', 'CARD', 'BANK_TRANSFER', 'KOKO', 'MINTPAY')`,
)
@Check('CHK_sale_refunds_amount_positive', `"amount" > 0`)
@Check(
  'CHK_sale_refunds_original_payment',
  `("method" = 'CASH') = ("original_payment_id" IS NULL)`,
)
@Check(
  'CHK_sale_refunds_reference',
  `"method" = 'CASH' OR ("reference_number" IS NOT NULL AND length(trim("reference_number")) > 0)`,
)
export class SaleRefund {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_sale_refunds_sale_return_id')
  @Column({ type: 'uuid', name: 'sale_return_id' })
  sale_return_id!: string;

  @ManyToOne(() => SaleReturn, (saleReturn) => saleReturn.refunds, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'sale_return_id',
    foreignKeyConstraintName: 'FK_sale_refunds_return',
  })
  sale_return?: SaleReturn;

  @Column({ type: 'varchar', length: 20 })
  method!: RefundMethod;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string;

  @Index('idx_sale_refunds_original_payment_id', {
    where: `"original_payment_id" IS NOT NULL`,
  })
  @Column({ type: 'uuid', nullable: true, name: 'original_payment_id' })
  original_payment_id!: string | null;

  @ManyToOne(() => Payment, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'original_payment_id',
    foreignKeyConstraintName: 'FK_sale_refunds_original_payment',
  })
  original_payment?: Payment;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    name: 'reference_number',
  })
  reference_number!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;
}
