import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Check,
  Unique,
  Index,
} from 'typeorm';
import { Branch } from '../../branches/entities/branch.entity';
import { User } from '../../users/entities/user.entity';
import { SaleType } from '../enums/sale-type.enum';
import { SaleStatus } from '../enums/sale-status.enum';
import { SaleLine } from './sale-line.entity';
import { Payment } from './payment.entity';

/**
 * A Sale is a financial transaction — cart + payments + a lifecycle.
 *
 * Aggregate root. SaleLine and Payment hang off it (defined in Slices D/E).
 *
 * Immutable once COMPLETED (except for the VOID transition). Voided sales
 * stay in the ledger forever with their reversal marked — never hard-deleted.
 * Only DRAFT sales can be discarded via DELETE.
 *
 * sale_number is per-branch, per-day: e.g. INV-20260825-0001. Two branches
 * on the same day both have -0001. Receipts/exports must always pair
 * sale_number with a branch code to be globally unique.
 */
@Entity('sales')
@Unique('UQ_sales_branch_sale_number', ['branch_id', 'sale_number'])
@Check(
  'CHK_sales_totals_nonneg',
  `subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0
   AND total >= 0 AND amount_paid >= 0 AND change_due >= 0`,
)
@Check(
  'CHK_sales_voided_consistency',
  `(status = 'VOIDED') = (voided_at IS NOT NULL AND voided_by IS NOT NULL)`,
)
@Check(
  'CHK_sales_completed_consistency',
  `(status IN ('COMPLETED', 'VOIDED')) = (completed_at IS NOT NULL)`,
)
@Check(
  'CHK_sales_sale_number_when_completed',
  `(status IN ('COMPLETED', 'VOIDED')) = (sale_number IS NOT NULL)`,
)
@Check('CHK_sales_amount_paid_bounded', `amount_paid <= total`)
export class Sale {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Null while DRAFT — issued atomically during transition to COMPLETED.
  // Uniqueness enforced per-branch (see @Unique above).
  @Column({ type: 'varchar', length: 20, nullable: true })
  sale_number!: string | null;

  @Column({ type: 'varchar', length: 20, default: SaleType.RETAIL })
  sale_type!: SaleType;

  @Column({ type: 'varchar', length: 20, default: SaleStatus.DRAFT })
  status!: SaleStatus;

  @Index('idx_sales_branch_id')
  @Column({ type: 'uuid', name: 'branch_id' })
  branch_id!: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Index('idx_sales_cashier_id')
  @Column({ type: 'uuid', name: 'cashier_id' })
  cashier_id!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cashier_id' })
  cashier?: User;

  // Nullable, no FK yet. Customer entity lands in Phase 6.3.5.
  // Column added now so schema doesn't need migration then.
  @Column({ type: 'uuid', name: 'customer_id', nullable: true })
  customer_id!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  subtotal!: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    name: 'discount_total',
  })
  discount_total!: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    name: 'tax_total',
  })
  tax_total!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total!: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    name: 'amount_paid',
  })
  amount_paid!: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    name: 'change_due',
  })
  change_due!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'completed_at' })
  completed_at!: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'voided_at' })
  voided_at!: Date | null;

  @Column({ type: 'uuid', nullable: true, name: 'voided_by' })
  voided_by!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'voided_by' })
  voider?: User;

  @OneToMany(() => SaleLine, (line) => line.sale)
  lines?: SaleLine[];

  @OneToMany(() => Payment, (payment) => payment.sale)
  payments?: Payment[];

  @Index('idx_sales_created_at')
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;
}
