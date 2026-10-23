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
import { SaleNumberKind } from '../enums/sale-number-kind.enum';

/**
 * Row-locked counter that generates INV-YYYYMMDD-NNNN (kind SALE) and
 * RET-YYYYMMDD-NNNN (kind RETURN, Phase 6.4 P7-10) per branch per day.
 *
 * One row exists per (branch_id, kind, counter_date). Rows are created
 * on-demand at the first number of the day for each branch and kind (via
 * ON CONFLICT DO UPDATE), not seeded upfront.
 *
 * Internal implementation detail — no HTTP surface. Injected into
 * SalesService for use during the completion transaction, and into the
 * return's transaction.
 */
@Entity('sale_number_counters')
@Unique('UQ_sale_counter_branch_kind_date', [
  'branch_id',
  'kind',
  'counter_date',
])
@Check('CHK_sale_counter_last_number_nonneg', `last_number >= 0`)
@Check('CHK_sale_counter_kind', `"kind" IN ('SALE', 'RETURN')`)
export class SaleNumberCounter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_sale_number_counters_branch_id')
  @Column({ type: 'uuid', name: 'branch_id' })
  branch_id!: string;

  @Column({
    type: 'varchar',
    length: 10,
    default: SaleNumberKind.SALE,
    name: 'kind',
  })
  kind!: SaleNumberKind;

  @Column({ type: 'date', name: 'counter_date' })
  counter_date!: string;

  @Column({ type: 'integer', default: 0, name: 'last_number' })
  last_number!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;
}
