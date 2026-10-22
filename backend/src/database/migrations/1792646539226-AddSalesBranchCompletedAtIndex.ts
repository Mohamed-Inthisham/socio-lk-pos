import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recent sales at the till (Phase 6.4 P6-2) lists one branch's sales
 * completed within one Colombo day, newest first: GET /sales with
 * branchId + completedFrom/completedTo + sort=completed_at. The composite
 * index serves both the filter and the order. Plain CREATE INDEX (not
 * CONCURRENTLY): migrations run in a transaction and the table is small.
 */
export class AddSalesBranchCompletedAtIndex1792646539226 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_sales_branch_completed_at" ON "sales" ("branch_id", "completed_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_sales_branch_completed_at"`);
  }
}
