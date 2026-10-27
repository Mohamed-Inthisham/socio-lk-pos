import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStockPurchasePayments1793005000000
  implements MigrationInterface
{
  name = 'CreateStockPurchasePayments1793005000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "stock_purchase_payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "stock_purchase_id" uuid NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "method" varchar(20) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'CLEARED',
        "payment_date" date NOT NULL,
        "reference" varchar(100),
        "cheque_number" varchar(50),
        "cheque_date" date,
        "bank" varchar(100),
        "created_by_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_purchase_payments_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stock_purchase_payments_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_stock_purchase_payments_method" CHECK ("method" IN ('CASH', 'CARD', 'ONLINE_TRANSFER', 'CHEQUE')),
        CONSTRAINT "CHK_stock_purchase_payments_status" CHECK ("status" IN ('CLEARED', 'PENDING', 'BOUNCED')),
        CONSTRAINT "CHK_stock_purchase_payments_cheque_fields" CHECK (
          ("method" = 'CHEQUE' AND "cheque_number" IS NOT NULL AND "cheque_date" IS NOT NULL AND "bank" IS NOT NULL)
          OR ("method" <> 'CHEQUE' AND "cheque_number" IS NULL AND "cheque_date" IS NULL AND "bank" IS NULL AND "status" = 'CLEARED')
        ),
        CONSTRAINT "FK_stock_purchase_payments_purchase" FOREIGN KEY ("stock_purchase_id") REFERENCES "stock_purchases"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_stock_purchase_payments_creator" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_stock_purchase_payments_purchase_date" ON "stock_purchase_payments" ("stock_purchase_id", "payment_date" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_stock_purchase_payments_purchase_date"`);
    await queryRunner.query(`DROP TABLE "stock_purchase_payments"`);
  }
}
