import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Check,
  Unique,
  Index,
} from 'typeorm';

/**
 * Row-locked counter that generates INV-YYYYMMDD-NNNN per branch per day.
 *
 * One row exists per (branch_id, counter_date) pair. Rows are created
 * on-demand at first sale of the day for each branch (via ON CONFLICT
 * DO UPDATE), not seeded upfront.
 *
 * Internal implementation detail — no HTTP surface. Injected into
 * SalesService for use during the completion transaction.
 */
@Entity('sale_number_counters')
@Unique('UQ_sale_counter_branch_date', ['branch_id', 'counter_date'])
@Check('CHK_sale_counter_last_number_nonneg', `last_number >= 0`)
export class SaleNumberCounter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_sale_number_counters_branch_id')
  @Column({ type: 'uuid', name: 'branch_id' })
  branch_id!: string;

  @Column({ type: 'date', name: 'counter_date' })
  counter_date!: string;

  @Column({ type: 'integer', default: 0, name: 'last_number' })
  last_number!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;
}
