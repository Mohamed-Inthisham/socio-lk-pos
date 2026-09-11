import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentsTable1788941439032 implements MigrationInterface {
  name = 'CreatePaymentsTable1788941439032';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sale_id" uuid NOT NULL,
        "payment_method" character varying(20) NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "cash_received" numeric(12,2),
        "reference_number" character varying(100),
        "notes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payments_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_payments_method"
          CHECK ("payment_method" IN ('CASH', 'CARD', 'BANK_TRANSFER', 'KOKO', 'MINTPAY')),
        CONSTRAINT "CHK_payments_amount_positive"
          CHECK ("amount" > 0),
        CONSTRAINT "CHK_payments_cash_received_only_for_cash"
          CHECK (("payment_method" = 'CASH') = ("cash_received" IS NOT NULL)),
        CONSTRAINT "CHK_payments_cash_received_covers_amount"
          CHECK ("cash_received" IS NULL OR "cash_received" >= "amount"),
        CONSTRAINT "FK_payments_sale_id"
          FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_payments_sale_id" ON "payments" ("sale_id")`,
    );

    // Add the amount_paid <= total invariant to the existing sales table.
    // Service enforces this per-payment; this CHECK is the DB backstop
    // that catches any bug that lets amount_paid corruption through.
    await queryRunner.query(
      `ALTER TABLE "sales"
       ADD CONSTRAINT "CHK_sales_amount_paid_bounded"
       CHECK ("amount_paid" <= "total")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse in reverse order of creation
    await queryRunner.query(
      `ALTER TABLE "sales" DROP CONSTRAINT "CHK_sales_amount_paid_bounded"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_payments_sale_id"`);
    await queryRunner.query(`DROP TABLE "payments"`);
  }
}
