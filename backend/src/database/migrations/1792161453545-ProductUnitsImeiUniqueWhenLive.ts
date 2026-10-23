import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Buy-back: one ProductUnit row per acquisition.
 *
 * The global unique index on product_units.imei allowed one row per
 * physical phone for all time, so a phone the shop sold (SOLD) or whose
 * trade-in was voided (RETURNED) could never be acquired again. IMEI
 * uniqueness is now scoped to the statuses that mean "the shop has it":
 *
 *   - IN_STOCK: held and sellable
 *   - WRITTEN_OFF: reserved status; kept blocking so a written-off phone
 *     turning up again needs a manager, not a silent re-intake
 *
 * SOLD (with the buyer) and RETURNED (trade-in reversed, phone back
 * with the customer) rows stay as history; a new acquisition of the
 * same IMEI inserts a new row. The customer-return flow uses a new
 * status, INSPECTION, added to this WHERE clause by
 * AddProductUnitInspectionStatus (Phase 6.4 P7-6).
 *
 * The old unique index name is reused for a plain lookup index, so it is
 * dropped first.
 *
 * down() restores the global unique index. It FAILS if any IMEI has more
 * than one row by then (a buy-back happened); those rows are real history
 * and must not be deleted to make the revert pass.
 */
export class ProductUnitsImeiUniqueWhenLive1792161453545 implements MigrationInterface {
  name = 'ProductUnitsImeiUniqueWhenLive1792161453545';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_product_units_imei"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_product_units_imei_live"
      ON "product_units" ("imei")
      WHERE "status" IN ('IN_STOCK', 'WRITTEN_OFF')
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_product_units_imei"
      ON "product_units" ("imei")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_product_units_imei"`);
    await queryRunner.query(`DROP INDEX "uq_product_units_imei_live"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_product_units_imei"
      ON "product_units" ("imei")
    `);
  }
}
