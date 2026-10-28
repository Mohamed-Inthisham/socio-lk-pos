import { MigrationInterface, QueryRunner } from 'typeorm';

/** Store both identifiers on a unit while retaining the legacy primary key. */
export class StoreBothUnitIdentifiers1793300000000
  implements MigrationInterface
{
  name = 'StoreBothUnitIdentifiers1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product_units"
      ADD COLUMN "imei_number" varchar(100) NULL,
      ADD COLUMN "serial_number" varchar(100) NULL`);
    await queryRunner.query(`UPDATE "product_units" unit
      SET "imei_number" = unit."imei"
      FROM "products" product
      WHERE product."id" = unit."product_id"
        AND product."tracking_method" = 'IMEI'`);
    await queryRunner.query(`UPDATE "product_units" unit
      SET "serial_number" = unit."imei"
      FROM "products" product
      WHERE product."id" = unit."product_id"
        AND product."tracking_method" = 'SERIAL_NUMBER'`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_product_units_imei_number_live"
      ON "product_units" ("imei_number")
      WHERE "imei_number" IS NOT NULL AND "status" IN ('IN_STOCK', 'WRITTEN_OFF', 'INSPECTION')`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_product_units_serial_number_live"
      ON "product_units" ("serial_number")
      WHERE "serial_number" IS NOT NULL AND "status" IN ('IN_STOCK', 'WRITTEN_OFF', 'INSPECTION')`);
    await queryRunner.query(`CREATE INDEX "idx_product_units_imei_number"
      ON "product_units" ("imei_number")`);
    await queryRunner.query(`CREATE INDEX "idx_product_units_serial_number"
      ON "product_units" ("serial_number")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_product_units_serial_number"`);
    await queryRunner.query(`DROP INDEX "idx_product_units_imei_number"`);
    await queryRunner.query(`DROP INDEX "uq_product_units_serial_number_live"`);
    await queryRunner.query(`DROP INDEX "uq_product_units_imei_number_live"`);
    await queryRunner.query(`ALTER TABLE "product_units"
      DROP COLUMN "serial_number",
      DROP COLUMN "imei_number"`);
  }
}
