import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SkuBarcodeCounter } from './entities/sku-barcode-counter.entity';
import { CounterType } from './enums/counter-type.enum';

@Injectable()
export class SkuBarcodeCountersService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Atomically increment a counter and return the next formatted value.
   *
   * Wrapped in a transaction with row-level locking:
   *   SELECT ... FOR UPDATE
   *
   * This means: if two callers hit this method at the exact same instant,
   * the second one waits for the first's transaction to commit before
   * reading the row. Guarantees each caller gets a unique next number
   * even under concurrent product creation.
   *
   * Returns the formatted string, e.g. 'SKU-000047' or 'SLP-000132'.
   * The integer is zero-padded to 6 digits so labels have consistent width.
   */
  async next(counterType: CounterType): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const counter = await manager
        .createQueryBuilder(SkuBarcodeCounter, 'counter')
        .setLock('pessimistic_write') // adds "FOR UPDATE" to the SELECT
        .where('counter.counter_type = :type', { type: counterType })
        .getOne();

      if (!counter) {
        // Should be impossible — the migration seeds both rows. If this
        // ever fires, the seed is missing or someone hard-deleted a row.
        throw new InternalServerErrorException(
          `Counter row for type "${counterType}" is missing. ` +
            `Check that CreateSkuBarcodeCountersTable migration ran and seeded both rows.`,
        );
      }

      counter.current_value += 1;
      await manager.save(counter);

      return this.format(counter.prefix, counter.current_value);
    });
  }

  /**
   * Read a counter's current value without incrementing. Useful for
   * admin dashboards ("last SKU issued: SKU-000047") or debugging.
   * Does not take a lock — read-only.
   */
  async peek(counterType: CounterType): Promise<{
    prefix: string;
    current_value: number;
    next_formatted: string;
  }> {
    const counter = await this.dataSource
      .getRepository(SkuBarcodeCounter)
      .findOne({ where: { counter_type: counterType } });

    if (!counter) {
      throw new InternalServerErrorException(
        `Counter row for type "${counterType}" is missing.`,
      );
    }

    return {
      prefix: counter.prefix,
      current_value: counter.current_value,
      next_formatted: this.format(counter.prefix, counter.current_value + 1),
    };
  }

  /**
   * Zero-pad the integer to 6 digits and prepend the prefix.
   * 47 → '000047', combined with prefix 'SKU-' → 'SKU-000047'.
   *
   * Six digits handles up to 999,999 products. Far beyond your business
   * horizon; comfortable margin.
   */
  private format(prefix: string, value: number): string {
    return `${prefix}${value.toString().padStart(6, '0')}`;
  }
}
