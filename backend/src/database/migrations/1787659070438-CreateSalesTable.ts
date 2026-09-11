import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSalesTable1787659070438 implements MigrationInterface {
  name = 'CreateSalesTable1787659070438';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sales" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sale_number" character varying(20),
        "sale_type" character varying(20) NOT NULL DEFAULT 'RETAIL',
        "status" character varying(20) NOT NULL DEFAULT 'DRAFT',
        "branch_id" uuid NOT NULL,
        "cashier_id" uuid NOT NULL,
        "customer_id" uuid,
        "subtotal" numeric(12,2) NOT NULL DEFAULT 0,
        "discount_total" numeric(12,2) NOT NULL DEFAULT 0,
        "tax_total" numeric(12,2) NOT NULL DEFAULT 0,
        "total" numeric(12,2) NOT NULL DEFAULT 0,
        "amount_paid" numeric(12,2) NOT NULL DEFAULT 0,
        "change_due" numeric(12,2) NOT NULL DEFAULT 0,
        "notes" text,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sales_branch_sale_number" UNIQUE ("branch_id", "sale_number"),
        CONSTRAINT "CHK_sales_sale_type"
          CHECK ("sale_type" IN ('RETAIL', 'USED_PHONE', 'REPAIR', 'CUSTOM_PRINT', 'RELOAD')),
        CONSTRAINT "CHK_sales_status"
          CHECK ("status" IN ('DRAFT', 'COMPLETED', 'VOIDED')),
        CONSTRAINT "CHK_sales_totals_nonneg"
          CHECK ("subtotal" >= 0 AND "discount_total" >= 0 AND "tax_total" >= 0
                 AND "total" >= 0 AND "amount_paid" >= 0 AND "change_due" >= 0),
        CONSTRAINT "CHK_sales_voided_consistency"
          CHECK (("status" = 'VOIDED') = ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL)),
        CONSTRAINT "CHK_sales_completed_consistency"
          CHECK (("status" IN ('COMPLETED', 'VOIDED')) = ("completed_at" IS NOT NULL)),
        CONSTRAINT "CHK_sales_sale_number_when_completed"
          CHECK (("status" IN ('COMPLETED', 'VOIDED')) = ("sale_number" IS NOT NULL)),
        CONSTRAINT "FK_sales_branch_id"
          FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_sales_cashier_id"
          FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_sales_voided_by"
          FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_sales_branch_id" ON "sales" ("branch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sales_cashier_id" ON "sales" ("cashier_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sales_created_at" ON "sales" ("created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_sales_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sales_cashier_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sales_branch_id"`);
    await queryRunner.query(`DROP TABLE "sales"`);
  }
}
