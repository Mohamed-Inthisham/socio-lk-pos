import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWriteOffStockMovement1794000000000 implements MigrationInterface {
  name = 'AddWriteOffStockMovement1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stock_movements" DROP CONSTRAINT "CHK_stock_movements_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" ADD CONSTRAINT "CHK_stock_movements_type" CHECK ("movement_type" IN ('OPENING_BALANCE', 'PURCHASE', 'TRADE_IN', 'SALE', 'REVERSAL', 'CUSTOMER_RETURN', 'INSPECTION_PASSED', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'WRITE_OFF'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stock_movements" DROP CONSTRAINT "CHK_stock_movements_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" ADD CONSTRAINT "CHK_stock_movements_type" CHECK ("movement_type" IN ('OPENING_BALANCE', 'PURCHASE', 'TRADE_IN', 'SALE', 'REVERSAL', 'CUSTOMER_RETURN', 'INSPECTION_PASSED', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'))`,
    );
  }
}
