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
} from 'typeorm';
import { Branch } from '../../branches/entities/branch.entity';
import { User } from '../../users/entities/user.entity';
import type { CashDayBreakdown } from '../cash-day-math';

/**
 * One branch's cash for one Colombo business date (Phase 6.4 P9-1, P9-2):
 * the opening balance, and at close the snapshot of what the box should
 * hold, what was counted and the difference. Open is closed_at IS NULL;
 * there is no status column. A closed day is never edited or reopened.
 *
 * The closing columns are written once, together, at close
 * (CHK_cash_days_closed_consistency). difference_reason is required (3+
 * characters after trimming) when the difference is 1.00 or more either
 * way, and null under 1.00, 0 included (CHK_cash_days_reason, the
 * rounding rule: the shop counts whole rupees). expected_balance may be
 * negative.
 *
 * summary is the rest of the printout, frozen at close so a reprint
 * matches the original (P9-15): non-cash tenders, trade-in value, counts.
 *
 * open_client_request_id and close_client_request_id are the till's ids
 * for the open and close attempts (P9-18): unique, so a resend finds the
 * recorded result.
 *
 * Constraint names match the CreateCashDays migration.
 */
@Entity('cash_days')
@Unique('UQ_cash_days_branch_date', ['branch_id', 'business_date'])
@Unique('UQ_cash_days_open_client_request_id', ['open_client_request_id'])
@Unique('UQ_cash_days_close_client_request_id', ['close_client_request_id'])
@Check('CHK_cash_days_opening_nonneg', `"opening_balance" >= 0`)
@Check(
  'CHK_cash_days_close_amounts_nonneg',
  `"cash_sales" >= 0 AND "cash_refunds" >= 0 AND "cash_voids_earlier" >= 0 AND "counted_balance" >= 0`,
)
@Check(
  'CHK_cash_days_expected',
  `"expected_balance" = "opening_balance" + "cash_sales" - "cash_refunds" - "cash_voids_earlier"`,
)
@Check(
  'CHK_cash_days_difference',
  `"difference" = "counted_balance" - "expected_balance"`,
)
@Check(
  'CHK_cash_days_reason',
  `CASE WHEN "difference" IS NULL OR abs("difference") < 1 THEN "difference_reason" IS NULL ELSE "difference_reason" IS NOT NULL AND length(trim("difference_reason")) >= 3 END`,
)
@Check(
  'CHK_cash_days_closed_consistency',
  `("cash_sales" IS NULL AND "cash_refunds" IS NULL AND "cash_voids_earlier" IS NULL AND "expected_balance" IS NULL AND "counted_balance" IS NULL AND "difference" IS NULL AND "summary" IS NULL AND "closed_by" IS NULL AND "closed_at" IS NULL AND "close_client_request_id" IS NULL) OR ("cash_sales" IS NOT NULL AND "cash_refunds" IS NOT NULL AND "cash_voids_earlier" IS NOT NULL AND "expected_balance" IS NOT NULL AND "counted_balance" IS NOT NULL AND "difference" IS NOT NULL AND "summary" IS NOT NULL AND "closed_by" IS NOT NULL AND "closed_at" IS NOT NULL AND "close_client_request_id" IS NOT NULL)`,
)
export class CashDay {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'branch_id' })
  branch_id!: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'branch_id',
    foreignKeyConstraintName: 'FK_cash_days_branch',
  })
  branch?: Branch;

  // The Colombo date, 'YYYY-MM-DD' (pg returns date columns as strings).
  @Column({ type: 'date', name: 'business_date' })
  business_date!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'opening_balance' })
  opening_balance!: string;

  @Column({ type: 'uuid', name: 'opened_by' })
  opened_by!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'opened_by',
    foreignKeyConstraintName: 'FK_cash_days_opened_by',
  })
  opener?: User;

  @Column({ type: 'timestamptz', name: 'opened_at' })
  opened_at!: Date;

  @Column({ type: 'uuid', name: 'open_client_request_id' })
  open_client_request_id!: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'cash_sales',
  })
  cash_sales!: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'cash_refunds',
  })
  cash_refunds!: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'cash_voids_earlier',
  })
  cash_voids_earlier!: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'expected_balance',
  })
  expected_balance!: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'counted_balance',
  })
  counted_balance!: string | null;

  // counted − expected; negative = short.
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'difference',
  })
  difference!: string | null;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
    name: 'difference_reason',
  })
  difference_reason!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  summary!: CashDayBreakdown | null;

  @Column({ type: 'uuid', nullable: true, name: 'closed_by' })
  closed_by!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'closed_by',
    foreignKeyConstraintName: 'FK_cash_days_closed_by',
  })
  closer?: User | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'closed_at' })
  closed_at!: Date | null;

  @Column({ type: 'uuid', nullable: true, name: 'close_client_request_id' })
  close_client_request_id!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;
}
