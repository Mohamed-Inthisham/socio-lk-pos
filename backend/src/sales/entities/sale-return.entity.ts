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
import { Sale } from './sale.entity';
import { SaleReturnLine } from './sale-return-line.entity';
import { SaleRefund } from './sale-refund.entity';
import { Branch } from '../../branches/entities/branch.entity';
import { User } from '../../users/entities/user.entity';

/**
 * A return on a COMPLETED sale (Phase 6.4 P7-1): some of its items came
 * back and some money may have gone back. The sale stays COMPLETED; its
 * lines only gain returned_quantity. Final once made, like a void: there
 * is no status and no undo.
 *
 * return_number is RET-YYYYMMDD-NNNN, per branch and Colombo day, from
 * sale_number_counters (kind RETURN), issued in the return's transaction.
 *
 * refund_due is the most this return may refund: the sum of its lines'
 * refund_share (P7-3). refund_total is what it did refund, the sum of its
 * refund rows; it may be lower, never higher (CHK_sale_returns_refund_total).
 *
 * out_of_warranty is true when any returned line was outside warranty
 * (P7-22); override_reason is then required (CHK_sale_returns_override,
 * P7-23). approved_by is the manager or admin whose PIN approved it;
 * requested_by the session user (P7-9).
 *
 * client_request_id is the till's id for the attempt (P7-15, P7-24):
 * unique, so a resend finds the recorded return instead of making a
 * second one.
 *
 * Constraint and index names match the CreateSaleReturns migration.
 */
@Entity('sale_returns')
@Unique('UQ_sale_returns_branch_number', ['branch_id', 'return_number'])
@Unique('UQ_sale_returns_client_request_id', ['client_request_id'])
@Check('CHK_sale_returns_reason', `length(trim("reason")) >= 3`)
@Check('CHK_sale_returns_refund_due_nonneg', `"refund_due" >= 0`)
@Check(
  'CHK_sale_returns_refund_total',
  `"refund_total" >= 0 AND "refund_total" <= "refund_due"`,
)
@Check(
  'CHK_sale_returns_override',
  `"out_of_warranty" = ("override_reason" IS NOT NULL AND length(trim("override_reason")) >= 3)`,
)
@Index('idx_sale_returns_branch_created_at', ['branch_id', 'created_at'])
export class SaleReturn {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20, name: 'return_number' })
  return_number!: string;

  @Index('idx_sale_returns_sale_id')
  @Column({ type: 'uuid', name: 'sale_id' })
  sale_id!: string;

  // No inverse on Sale: SalesService.findOne loads returns with their own
  // query and attaches a read-only view (SaleReturnView).
  @ManyToOne(() => Sale, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'sale_id',
    foreignKeyConstraintName: 'FK_sale_returns_sale',
  })
  sale?: Sale;

  // Always the sale's branch.
  @Column({ type: 'uuid', name: 'branch_id' })
  branch_id!: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'branch_id',
    foreignKeyConstraintName: 'FK_sale_returns_branch',
  })
  branch?: Branch;

  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'refund_due' })
  refund_due!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'refund_total' })
  refund_total!: string;

  @Column({ type: 'boolean', name: 'out_of_warranty' })
  out_of_warranty!: boolean;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
    name: 'override_reason',
  })
  override_reason!: string | null;

  @Column({ type: 'uuid', name: 'approved_by' })
  approved_by!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'approved_by',
    foreignKeyConstraintName: 'FK_sale_returns_approved_by',
  })
  approver?: User;

  @Column({ type: 'uuid', name: 'requested_by' })
  requested_by!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'requested_by',
    foreignKeyConstraintName: 'FK_sale_returns_requested_by',
  })
  requester?: User;

  @Column({ type: 'uuid', name: 'client_request_id' })
  client_request_id!: string;

  @OneToMany(() => SaleReturnLine, (line) => line.sale_return)
  lines?: SaleReturnLine[];

  @OneToMany(() => SaleRefund, (refund) => refund.sale_return)
  refunds?: SaleRefund[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;
}
