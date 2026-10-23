import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6.4 P7-6 (step 0a): the INSPECTION unit status.
 *
 * A phone a customer returns (P7 returns, step 0b) goes from SOLD to
 * INSPECTION: the shop holds it again, but it can't be sold until a
 * manager or admin checks it and passes it back to IN_STOCK. Because the
 * shop holds it, INSPECTION is live: it joins uq_product_units_imei_live,
 * so the same IMEI can't be taken in again (trade-in, phone purchase)
 * while it waits.
 *
 *   - CHK_product_units_status gains INSPECTION.
 *   - uq_product_units_imei_live becomes
 *     UNIQUE (imei) WHERE status IN ('IN_STOCK', 'WRITTEN_OFF', 'INSPECTION').
 *
 * down() refuses while any unit is INSPECTION and changes nothing: those
 * rows are real returned phones, and the old CHECK would reject them.
 * They must be passed (or otherwise resolved) first; this migration never
 * changes a unit's status to make a revert pass.
 */
export class AddProductUnitInspectionStatus1792735000000 implements MigrationInterface {
  name = 'AddProductUnitInspectionStatus1792735000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_units" DROP CONSTRAINT "CHK_product_units_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE "product_units" ADD CONSTRAINT "CHK_product_units_status"
      CHECK ("status" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF', 'INSPECTION'))
    `);

    await queryRunner.query(`DROP INDEX "uq_product_units_imei_live"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_product_units_imei_live"
      ON "product_units" ("imei")
      WHERE "status" IN ('IN_STOCK', 'WRITTEN_OFF', 'INSPECTION')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows: { count: number }[] = await queryRunner.query(
      `SELECT count(*)::int AS count FROM "product_units" WHERE "status" = 'INSPECTION'`,
    );
    const inspecting = rows[0]?.count ?? 0;
    if (inspecting > 0) {
      throw new Error(
        `Cannot revert AddProductUnitInspectionStatus: ${inspecting} product ` +
          `unit(s) are INSPECTION (returned phones waiting for a check). ` +
          `Pass or resolve them first; this migration does not change them.`,
      );
    }

    await queryRunner.query(`DROP INDEX "uq_product_units_imei_live"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_product_units_imei_live"
      ON "product_units" ("imei")
      WHERE "status" IN ('IN_STOCK', 'WRITTEN_OFF')
    `);

    await queryRunner.query(
      `ALTER TABLE "product_units" DROP CONSTRAINT "CHK_product_units_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE "product_units" ADD CONSTRAINT "CHK_product_units_status"
      CHECK ("status" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF'))
    `);
  }
}
