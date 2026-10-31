import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * The opening-balance backfill's completion marker (Phase 1 T1b): one row,
 * written in the same transaction as the opening balances by
 * backfill_stock_opening_balances() (BackfillStockOpeningBalances
 * migration). While it exists the backfill does nothing: stock rows
 * created since go-live begin their ledger at 0 by design.
 *
 * Immutable: a trigger refuses UPDATE and DELETE, and TRUNCATE unless the
 * session sets socio.allow_ledger_truncate (the e2e reset does). Declared
 * as an entity so that reset finds and clears it.
 */
@Entity('stock_ledger_backfill')
@Check('CHK_stock_ledger_backfill_single', `"id" = 1`)
export class StockLedgerBackfill {
  @PrimaryColumn({
    type: 'smallint',
    default: 1,
    primaryKeyConstraintName: 'PK_stock_ledger_backfill_id',
  })
  id!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  completed_at!: Date;

  /** Stock rows when the backfill ran; equals opening_rows. */
  @Column({ type: 'integer' })
  stock_rows!: number;

  @Column({ type: 'integer' })
  opening_rows!: number;
}
