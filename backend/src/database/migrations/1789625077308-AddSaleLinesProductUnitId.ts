import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Slice E — wire sale_lines to ProductUnit for serialized in-house lines.
 *
 * Adds sale_lines.product_unit_id:
 *   - nullable uuid (populated only for serialized in-house lines;
 *     external-sourced serialized and non-serialized lines leave it NULL)
 *   - FK to product_units.id ON DELETE RESTRICT — a ProductUnit that has
 *     ever appeared on a sale line cannot be deleted. ProductUnits are
 *     state-machined (IN_STOCK / SOLD / RETURNED / WRITTEN_OFF), never
 *     hard-deleted, so RESTRICT is the right onDelete.
 *   - Single-column index for reverse lookups ("what sale sold IMEI X?"
 *     and the complete-time defensive read on the row).
 *
 * CHECK constraint CHK_sale_lines_product_unit_snapshot:
 *   product_unit_id IS NULL OR imei_snapshot IS NOT NULL
 *
 * A ProductUnit link without a snapshotted IMEI is a service-layer bug we
 * never want landing in the DB — the receipt would show a serialized line
 * with no IMEI on it. The full three-way legality (external vs in-house)
 * stays at the service layer per codebase convention (business rules
 * belong there, not in DDL).
 */
export class AddSaleLinesProductUnitId1789625077308 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add the column (nullable — existing rows stay NULL, which is
    //    correct: they are all non-serialized or external-sourced).
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       ADD COLUMN "product_unit_id" uuid NULL`,
    );

    // 2. FK to product_units.id, RESTRICT on delete (see docstring).
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       ADD CONSTRAINT "FK_sale_lines_product_unit_id"
       FOREIGN KEY ("product_unit_id")
       REFERENCES "product_units"("id")
       ON DELETE RESTRICT
       ON UPDATE CASCADE`,
    );

    // 3. Index for reverse-lookup queries.
    await queryRunner.query(
      `CREATE INDEX "idx_sale_lines_product_unit_id"
       ON "sale_lines" ("product_unit_id")`,
    );

    // 4. Snapshot consistency CHECK — if a PU is linked, imei_snapshot
    //    must also be set. Defends against service-layer bugs.
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       ADD CONSTRAINT "CHK_sale_lines_product_unit_snapshot"
       CHECK ("product_unit_id" IS NULL OR "imei_snapshot" IS NOT NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse in strict inverse order: CHECK, INDEX, FK, COLUMN.
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       DROP CONSTRAINT "CHK_sale_lines_product_unit_snapshot"`,
    );
    await queryRunner.query(`DROP INDEX "idx_sale_lines_product_unit_id"`);
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       DROP CONSTRAINT "FK_sale_lines_product_unit_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       DROP COLUMN "product_unit_id"`,
    );
  }
}
