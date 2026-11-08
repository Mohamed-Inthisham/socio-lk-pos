import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * product_units.unit_code: a short, permanent code for each unit row, such
 * as SLU00000123, for barcode labels. It reveals no IMEI or serial number.
 * A row is one acquisition, so a bought-back phone gets a new code.
 *
 * The database generates it: every intake path leaves the column out of
 * its INSERT and the default fills it, so no service generates a code.
 *
 * - next_product_unit_code() is a function so the default is stored exactly
 *   as the entity declares it, and generated migrations see no drift. The
 *   same goes for text: a length limit would make Postgres wrap the default
 *   in a cast. CHK_product_units_unit_code bounds the value instead.
 * - The number is padded to at least 8 digits and grows past them. lpad
 *   alone would truncate a longer number, so the pad width follows it.
 * - The backfill numbers rows with row_number() over created_at, id, not
 *   nextval, so the order is defined. setval then moves the sequence past
 *   the last code. Every row is covered, SOLD and RETURNED included:
 *   ProductUnit has no soft delete, so no row is hidden from the UPDATE.
 * - ALTER TABLE holds its lock until the migration's transaction commits,
 *   so no unit can be inserted between the backfill and the default.
 * - The sequence is owned by the column so TRUNCATE ... RESTART IDENTITY
 *   resets it, as the e2e reset does. Production never truncates this table.
 *
 * FORWARD-ONLY ONCE LABELS ARE PRINTED. `down` deletes every code, so each
 * printed label stops scanning. Running `up` again renumbers from 1, and
 * the sequence's gaps (a rolled-back insert still uses a number) mean a
 * row can get a different code than before: an old label could then
 * identify a different unit. After the first label is printed, fix forward
 * instead of reverting.
 */
export class AddProductUnitCodes1793800000000 implements MigrationInterface {
  name = 'AddProductUnitCodes1793800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE "product_unit_code_seq"`);
    await queryRunner.query(`
      CREATE FUNCTION "next_product_unit_code"() RETURNS text
      LANGUAGE sql VOLATILE AS $$
        SELECT 'SLU' || lpad(n::text, GREATEST(8, length(n::text)), '0')
        FROM nextval('product_unit_code_seq') AS n
      $$`);
    await queryRunner.query(`ALTER TABLE "product_units"
      ADD COLUMN "unit_code" text NULL`);
    await queryRunner.query(`UPDATE "product_units" unit
      SET "unit_code" = 'SLU' || lpad(
        numbered.n::text, GREATEST(8, length(numbered.n::text)), '0'
      )
      FROM (
        SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n
        FROM "product_units"
      ) numbered
      WHERE unit."id" = numbered."id"`);
    // An empty table leaves the sequence at 1, not yet used.
    await queryRunner.query(`SELECT setval(
      'product_unit_code_seq', GREATEST(count(*), 1), count(*) > 0
    ) FROM "product_units"`);
    await queryRunner.query(`ALTER TABLE "product_units"
      ALTER COLUMN "unit_code" SET DEFAULT next_product_unit_code()`);
    await queryRunner.query(`ALTER TABLE "product_units"
      ALTER COLUMN "unit_code" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "product_units"
      ADD CONSTRAINT "CHK_product_units_unit_code"
      CHECK ("unit_code" ~ '^SLU[0-9]{8,}$')`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_product_units_unit_code"
      ON "product_units" ("unit_code")`);
    await queryRunner.query(`ALTER SEQUENCE "product_unit_code_seq"
      OWNED BY "product_units"."unit_code"`);
  }

  /** Deletes every code: see FORWARD-ONLY above before running this. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_product_units_unit_code"`);
    await queryRunner.query(`ALTER TABLE "product_units"
      DROP CONSTRAINT "CHK_product_units_unit_code"`);
    // Also drops the sequence, which the column owns.
    await queryRunner.query(`ALTER TABLE "product_units"
      DROP COLUMN "unit_code"`);
    await queryRunner.query(`DROP FUNCTION "next_product_unit_code"()`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "product_unit_code_seq"`);
  }
}
