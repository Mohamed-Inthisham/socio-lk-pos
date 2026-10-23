import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { DateTime } from 'luxon';
import { SaleNumberCounter } from './entities/sale-number-counter.entity';
import { SaleNumberKind } from './enums/sale-number-kind.enum';

/** The number's prefix per kind (Phase 6.4 P7-10). */
const PREFIX: Record<SaleNumberKind, string> = {
  [SaleNumberKind.SALE]: 'INV',
  [SaleNumberKind.RETURN]: 'RET',
};

/**
 * Sri Lankan timezone. Sale numbers reset at midnight Colombo time,
 * NOT midnight UTC. A sale rung up at 11 PM local should land on
 * today's counter, not tomorrow's.
 */
const SL_TIMEZONE = 'Asia/Colombo';

@Injectable()
export class SaleNumberCountersService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Generate the next INV-YYYYMMDD-NNNN for the given branch on the
   * current Sri Lankan date, or RET-YYYYMMDD-NNNN with kind RETURN
   * (Phase 6.4 P7-10). Each kind has its own counter row, so returns
   * never take an invoice number and vice versa.
   *
   * Two entry points:
   *  - Called standalone: opens its own short-lived transaction with
   *    row-level locking to increment atomically.
   *  - Called from within a larger transaction (e.g. SalesService's
   *    complete-sale transaction): pass in the outer transaction's
   *    EntityManager so the counter increment enlists in the same
   *    transaction. If the outer transaction rolls back, the counter
   *    increment rolls back with it.
   *
   * Concurrency guarantees:
   *  - Two callers hitting the same branch at the same instant: the
   *    second waits on FOR UPDATE, gets the next incremented value.
   *  - Two callers hitting different branches: no contention, both
   *    proceed in parallel (row-level lock).
   *  - First sale of the day at a branch (no counter row exists yet):
   *    handled by INSERT ... ON CONFLICT ... DO UPDATE, atomic even
   *    if two callers arrive simultaneously.
   *
   * Gaps: when enlisted, a rollback of the outer transaction undoes the
   * increment too, so a failed complete leaves no gap and the next
   * successful complete reuses the number. Only a standalone call commits
   * the increment on its own; if its caller then fails, the number is
   * consumed. Never reusing an issued number matters more than gaps,
   * which are normal and auditable (a voided sale keeps its number).
   *
   * Returns e.g. 'INV-20260825-0001' (or 'RET-20260825-0001').
   */
  async generateNext(
    branchId: string,
    manager?: EntityManager,
    kind: SaleNumberKind = SaleNumberKind.SALE,
  ): Promise<string> {
    const today = this.currentColomboDate();

    if (manager) {
      // Enlist in caller's transaction
      return this.incrementInTransaction(manager, branchId, kind, today);
    }

    // Standalone: open our own transaction
    return this.dataSource.transaction((tx) =>
      this.incrementInTransaction(tx, branchId, kind, today),
    );
  }

  /**
   * Read-only peek at the next number that WOULD be issued for a
   * branch today. Does not increment or take a lock. Useful for
   * admin dashboards, but never for actual sale numbering — the
   * value returned here is not reserved.
   */
  async peekNext(
    branchId: string,
    kind: SaleNumberKind = SaleNumberKind.SALE,
  ): Promise<string> {
    const today = this.currentColomboDate();
    const counter = await this.dataSource
      .getRepository(SaleNumberCounter)
      .findOne({ where: { branch_id: branchId, kind, counter_date: today } });

    const nextNumber = counter ? counter.last_number + 1 : 1;
    return this.format(kind, today, nextNumber);
  }

  /**
   * Core logic: INSERT the counter row for (branch, kind, date), or if it
   * already exists, atomically increment last_number. Returns the
   * newly-issued number.
   *
   * Uses PostgreSQL's ON CONFLICT DO UPDATE (upsert) so the "first
   * sale of the day" race is handled atomically in one round trip
   * rather than a try-insert-catch-conflict-then-update dance.
   *
   * The RETURNING clause gives us the incremented value in the same
   * statement — no second SELECT needed.
   */
  private async incrementInTransaction(
    manager: EntityManager,
    branchId: string,
    kind: SaleNumberKind,
    counterDate: string,
  ): Promise<string> {
    // First, try to lock the existing row if any. This makes the
    // increment path serialized per (branch, kind, date). If no row
    // exists yet, this returns nothing and we fall through to the upsert.
    await manager
      .createQueryBuilder(SaleNumberCounter, 'counter')
      .setLock('pessimistic_write')
      .where('counter.branch_id = :branchId', { branchId })
      .andWhere('counter.kind = :kind', { kind })
      .andWhere('counter.counter_date = :counterDate', { counterDate })
      .getOne();

    // Atomic upsert. If the row exists, increment. If not, insert with
    // last_number=1. Either way, RETURNING gives us the new value.
    const result = await manager.query<{ last_number: number }[]>(
      `INSERT INTO sale_number_counters (branch_id, kind, counter_date, last_number)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT ON CONSTRAINT "UQ_sale_counter_branch_kind_date"
       DO UPDATE SET last_number = sale_number_counters.last_number + 1,
                     updated_at = now()
       RETURNING last_number`,
      [branchId, kind, counterDate],
    );

    const lastNumber = result[0].last_number;
    return this.format(kind, counterDate, lastNumber);
  }

  /**
   * Resolve "today" in Sri Lankan local time, returned as ISO date
   * string 'YYYY-MM-DD' matching Postgres date column format.
   */
  private currentColomboDate(): string {
    const date = DateTime.now().setZone(SL_TIMEZONE).toISODate();
    if (!date) {
      // Practically impossible — luxon returns null only for invalid
      // DateTimes, and DateTime.now() is always valid. Defensive.
      throw new Error('Failed to resolve current Colombo date');
    }
    return date;
  }

  /**
   * Format counter into INV-YYYYMMDD-NNNN (RET- for returns).
   * counterDate is 'YYYY-MM-DD'; strip the hyphens for the invoice segment.
   * lastNumber is zero-padded to 4 digits.
   *
   * Four digits handles up to 9,999 sales per branch per day. Beyond
   * that we'd need to widen — but SOCIO.LK doing >9,999 sales/day is
   * a nice problem to have.
   */
  private format(
    kind: SaleNumberKind,
    counterDate: string,
    lastNumber: number,
  ): string {
    const dateSegment = counterDate.replace(/-/g, '');
    const numberSegment = lastNumber.toString().padStart(4, '0');
    return `${PREFIX[kind]}-${dateSegment}-${numberSegment}`;
  }
}
