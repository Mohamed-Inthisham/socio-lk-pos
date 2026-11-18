import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replace generated SLP/SLU labels with random, eight digit Code 128 values.
 * Product codes use 10,000,000–54,999,999 and unit codes 55,000,000–99,999,999
 * so the POS can tell a unit label from a product label after a scan.
 * The backup tables let `down` restore the previous database values.
 */
export class UseNumericProductAndUnitBarcodes1793900000000
  implements MigrationInterface
{
  name = 'UseNumericProductAndUnitBarcodes1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "product_barcode_legacy_backup" AS
      SELECT "id", "barcode" FROM "products"
    `);
    await queryRunner.query(`
      CREATE TABLE "unit_code_legacy_backup" AS
      SELECT "id", "unit_code" FROM "product_units"
    `);
    await queryRunner.query(`
      CREATE FUNCTION "next_numeric_product_barcode"() RETURNS varchar
      LANGUAGE plpgsql VOLATILE AS $$
      DECLARE candidate text;
      BEGIN
        PERFORM pg_advisory_xact_lock(73190422);
        LOOP
          candidate := (10000000 + floor(random() * 45000000)::bigint)::text;
          EXIT WHEN NOT EXISTS (SELECT 1 FROM "products" WHERE "barcode" = candidate)
            AND NOT EXISTS (SELECT 1 FROM "product_barcode_legacy_backup" WHERE "barcode" = candidate)
            AND NOT EXISTS (SELECT 1 FROM "product_units" WHERE "unit_code" = candidate)
            AND NOT EXISTS (SELECT 1 FROM "product_units"
              WHERE "imei" = candidate OR "imei_number" = candidate OR "serial_number" = candidate);
        END LOOP;
        RETURN candidate;
      END $$
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "next_product_unit_code"() RETURNS text
      LANGUAGE plpgsql VOLATILE AS $$
      DECLARE candidate text;
      BEGIN
        PERFORM pg_advisory_xact_lock(73190422);
        LOOP
          candidate := (55000000 + floor(random() * 45000000)::bigint)::text;
          EXIT WHEN NOT EXISTS (SELECT 1 FROM "products" WHERE "barcode" = candidate)
            AND NOT EXISTS (SELECT 1 FROM "product_barcode_legacy_backup" WHERE "barcode" = candidate)
            AND NOT EXISTS (SELECT 1 FROM "product_units" WHERE "unit_code" = candidate)
            AND NOT EXISTS (SELECT 1 FROM "product_units"
              WHERE "imei" = candidate OR "imei_number" = candidate OR "serial_number" = candidate);
        END LOOP;
        RETURN candidate;
      END $$
    `);

    await queryRunner.query(`ALTER TABLE "product_units"
      DROP CONSTRAINT "CHK_product_units_unit_code"`);
    await queryRunner.query(`ALTER TABLE "product_units"
      ALTER COLUMN "unit_code" DROP DEFAULT`);
    await queryRunner.query(`UPDATE "products" SET "barcode" = "next_numeric_product_barcode"()`);
    await queryRunner.query(`UPDATE "product_units" SET "unit_code" = "next_product_unit_code"()`);
    await queryRunner.query(`ALTER TABLE "products"
      ALTER COLUMN "barcode" SET DEFAULT "next_numeric_product_barcode"()`);
    await queryRunner.query(`ALTER TABLE "product_units"
      ALTER COLUMN "unit_code" SET DEFAULT "next_product_unit_code"()`);
    await queryRunner.query(`ALTER TABLE "product_units"
      ADD CONSTRAINT "CHK_product_units_unit_code"
      CHECK ("unit_code" ~ '^[0-9]{8}$')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product_units"
      DROP CONSTRAINT "CHK_product_units_unit_code"`);
    await queryRunner.query(`ALTER TABLE "products" ALTER COLUMN "barcode" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "product_units" ALTER COLUMN "unit_code" DROP DEFAULT`);
    await queryRunner.query(`DROP FUNCTION "next_product_unit_code"()`);
    await queryRunner.query(`CREATE FUNCTION "next_product_unit_code"() RETURNS text
      LANGUAGE sql VOLATILE AS $$
        SELECT 'SLU' || lpad(n::text, GREATEST(8, length(n::text)), '0')
        FROM nextval('product_unit_code_seq') AS n
      $$`);
    await queryRunner.query(`UPDATE "product_units" u
      SET "unit_code" = next_product_unit_code()
      WHERE NOT EXISTS (SELECT 1 FROM "unit_code_legacy_backup" b WHERE b."id" = u."id")`);
    await queryRunner.query(`UPDATE "products" p SET "barcode" = b."barcode"
      FROM "product_barcode_legacy_backup" b WHERE p."id" = b."id"`);
    await queryRunner.query(`UPDATE "product_units" u SET "unit_code" = b."unit_code"
      FROM "unit_code_legacy_backup" b WHERE u."id" = b."id"`);
    await queryRunner.query(`DROP FUNCTION "next_numeric_product_barcode"()`);
    await queryRunner.query(`ALTER TABLE "product_units"
      ALTER COLUMN "unit_code" SET DEFAULT next_product_unit_code()`);
    await queryRunner.query(`ALTER TABLE "product_units"
      ADD CONSTRAINT "CHK_product_units_unit_code"
      CHECK ("unit_code" ~ '^SLU[0-9]{8,}$')`);
    await queryRunner.query(`DROP TABLE "product_barcode_legacy_backup"`);
    await queryRunner.query(`DROP TABLE "unit_code_legacy_backup"`);
  }
}
