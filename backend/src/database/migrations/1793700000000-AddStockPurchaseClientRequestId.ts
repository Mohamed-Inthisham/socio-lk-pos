import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The stock purchase page's id for one submission (Phase 1 T1c). POST
 * /stock-purchases inserts the purchase row with it as the first write of
 * its transaction, so a resend of the same submission waits on this unique
 * constraint and then replays the recorded purchase instead of receiving
 * the stock a second time.
 *
 * Nullable: purchases recorded before T1c have none, and PostgreSQL allows
 * any number of NULLs under a unique constraint. No backfill.
 */
export class AddStockPurchaseClientRequestId1793700000000 implements MigrationInterface {
  name = 'AddStockPurchaseClientRequestId1793700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stock_purchases"
      ADD COLUMN "client_request_id" uuid NULL`);
    await queryRunner.query(`ALTER TABLE "stock_purchases"
      ADD CONSTRAINT "UQ_stock_purchases_client_request_id"
      UNIQUE ("client_request_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stock_purchases"
      DROP CONSTRAINT "UQ_stock_purchases_client_request_id"`);
    await queryRunner.query(`ALTER TABLE "stock_purchases"
      DROP COLUMN "client_request_id"`);
  }
}
