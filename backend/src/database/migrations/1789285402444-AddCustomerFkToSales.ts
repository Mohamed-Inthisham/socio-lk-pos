import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6.3.5 Slice B: wire Sale.customer_id to the customers table.
 *
 * Prior state (Phase 6.3):
 * - sales.customer_id existed as a bare nullable UUID with no FK
 *   and no index. The column was pre-added deliberately so this
 *   migration wouldn't need to alter the column type.
 *
 * This migration:
 * - Adds a foreign key constraint referencing customers(id).
 *   ON DELETE RESTRICT: soft-delete on Customer already blocks the row
 *   from being touched (deleted_at); a hard delete of a customer with
 *   sales history would corrupt reports, so RESTRICT protects history.
 *   No customer will ever be hard-deleted through the API, but defense
 *   in depth against manual DB fixes gone wrong.
 * - Adds an index for lookup (e.g. GET /customers/:id/sales in a future
 *   phase, or joining sales -> customer in reports).
 *
 * Preflight verified on dev: SELECT COUNT(*) FROM sales WHERE
 * customer_id IS NOT NULL returned 0, so the FK will not fail on
 * existing rows.
 */
export class AddCustomerFkToSales1789285402444 implements MigrationInterface {
  name = 'AddCustomerFkToSales1789285402444';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sales"
      ADD CONSTRAINT "FK_sales_customer_id"
      FOREIGN KEY ("customer_id")
      REFERENCES "customers"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_sales_customer_id"
      ON "sales" ("customer_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_sales_customer_id"`);
    await queryRunner.query(`
      ALTER TABLE "sales"
      DROP CONSTRAINT "FK_sales_customer_id"
    `);
  }
}
