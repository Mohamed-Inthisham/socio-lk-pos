import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6.4 P5 (P5-1) — snapshot each line's warranty when the sale is
 * completed, so the printed receipt (and any reprint, months later) shows
 * the warranty the customer bought, not whatever the product says today.
 *
 * Adds two nullable integer columns to sale_lines:
 *   - warranty_months_snapshot        (copied from products.warranty_months)
 *   - checking_warranty_days_snapshot (copied from products.checking_warranty_days)
 *
 * Set by SalesService.completeSale inside its transaction. NULL means "not
 * snapshotted": a DRAFT line, or a sale completed before this migration.
 * No backfill — copying today's product values onto old sales would record
 * a warranty that may never have applied.
 */
export class AddSaleLinesWarrantySnapshot1792486535847 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       ADD COLUMN "warranty_months_snapshot" integer NULL,
       ADD COLUMN "checking_warranty_days_snapshot" integer NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       DROP COLUMN "checking_warranty_days_snapshot",
       DROP COLUMN "warranty_months_snapshot"`,
    );
  }
}
