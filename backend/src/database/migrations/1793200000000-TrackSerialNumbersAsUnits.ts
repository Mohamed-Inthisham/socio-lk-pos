import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extend per-unit inventory and sales history from IMEIs to serial numbers.
 * ProductUnit.imei remains the legacy storage column for either identifier;
 * identifier_type_snapshot records which value a sale line contains.
 */
export class TrackSerialNumbersAsUnits1793200000000
  implements MigrationInterface
{
  name = 'TrackSerialNumbersAsUnits1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products"
      DROP CONSTRAINT "CHK_products_tracking_serialized"`);
    await queryRunner.query(`UPDATE "products"
      SET "is_serialized" = ("tracking_method" <> 'QUANTITY')`);
    await queryRunner.query(`ALTER TABLE "products"
      ADD CONSTRAINT "CHK_products_tracking_serialized"
      CHECK ("is_serialized" = ("tracking_method" <> 'QUANTITY'))`);
    await queryRunner.query(`ALTER TABLE "product_units"
      ALTER COLUMN "imei" TYPE varchar(100)`);
    await queryRunner.query(`ALTER TABLE "sale_lines"
      ALTER COLUMN "imei_snapshot" TYPE varchar(100)`);
    await queryRunner.query(`ALTER TABLE "sale_lines"
      ADD COLUMN "identifier_type_snapshot" varchar(20) NULL`);
    await queryRunner.query(`UPDATE "sale_lines" line
      SET "identifier_type_snapshot" = product."tracking_method"
      FROM "products" product
      WHERE product."id" = line."product_id"
        AND line."imei_snapshot" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sale_lines"
      DROP COLUMN "identifier_type_snapshot"`);
    await queryRunner.query(`ALTER TABLE "sale_lines"
      ALTER COLUMN "imei_snapshot" TYPE varchar(50)`);
    await queryRunner.query(`ALTER TABLE "product_units"
      ALTER COLUMN "imei" TYPE varchar(50)`);
    await queryRunner.query(`ALTER TABLE "products"
      DROP CONSTRAINT "CHK_products_tracking_serialized"`);
    await queryRunner.query(`UPDATE "products"
      SET "is_serialized" = ("tracking_method" = 'IMEI')`);
    await queryRunner.query(`ALTER TABLE "products"
      ADD CONSTRAINT "CHK_products_tracking_serialized"
      CHECK ("is_serialized" = ("tracking_method" = 'IMEI'))`);
  }
}
