import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSaleLinesTable1788762237436 implements MigrationInterface {
  name = 'CreateSaleLinesTable1788762237436';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sale_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sale_id" uuid NOT NULL,
        "line_number" smallint NOT NULL,
        "product_id" uuid NOT NULL,
        "product_sku_snapshot" character varying(30) NOT NULL,
        "product_name_snapshot" character varying(200) NOT NULL,
        "unit_price" numeric(12,2) NOT NULL,
        "cost_price_snapshot" numeric(12,2) NOT NULL,
        "quantity" integer NOT NULL,
        "discount_type" character varying(10),
        "discount_value" numeric(12,2),
        "discount_amount" numeric(12,2) NOT NULL DEFAULT 0,
        "line_total" numeric(12,2) NOT NULL,
        "external_supplier_id" uuid,
        "imei_snapshot" character varying(50),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sale_lines_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sale_lines_sale_line_number" UNIQUE ("sale_id", "line_number"),
        CONSTRAINT "CHK_sale_lines_qty_positive"
          CHECK ("quantity" > 0),
        CONSTRAINT "CHK_sale_lines_line_number_positive"
          CHECK ("line_number" > 0),
        CONSTRAINT "CHK_sale_lines_unit_price_nonneg"
          CHECK ("unit_price" >= 0),
        CONSTRAINT "CHK_sale_lines_cost_price_nonneg"
          CHECK ("cost_price_snapshot" >= 0),
        CONSTRAINT "CHK_sale_lines_discount_amount_nonneg"
          CHECK ("discount_amount" >= 0),
        CONSTRAINT "CHK_sale_lines_discount_bounded"
          CHECK ("discount_amount" <= "unit_price" * "quantity"),
        CONSTRAINT "CHK_sale_lines_discount_consistency"
          CHECK (("discount_type" IS NULL) = ("discount_value" IS NULL)),
        CONSTRAINT "CHK_sale_lines_discount_type"
          CHECK ("discount_type" IS NULL OR "discount_type" IN ('AMOUNT', 'PERCENT')),
        CONSTRAINT "CHK_sale_lines_discount_percent_range"
          CHECK ("discount_type" != 'PERCENT' OR ("discount_value" >= 0 AND "discount_value" <= 100)),
        CONSTRAINT "CHK_sale_lines_discount_amount_value_nonneg"
          CHECK ("discount_type" != 'AMOUNT' OR "discount_value" >= 0),
        CONSTRAINT "CHK_sale_lines_line_total"
          CHECK ("line_total" = ROUND("unit_price" * "quantity" - "discount_amount", 2)),
        CONSTRAINT "FK_sale_lines_sale_id"
          FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_sale_lines_product_id"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_sale_lines_external_supplier_id"
          FOREIGN KEY ("external_supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_sale_lines_sale_id" ON "sale_lines" ("sale_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sale_lines_product_id" ON "sale_lines" ("product_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sale_lines_external_supplier_id" ON "sale_lines" ("external_supplier_id") WHERE "external_supplier_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_sale_lines_external_supplier_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_sale_lines_product_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sale_lines_sale_id"`);
    await queryRunner.query(`DROP TABLE "sale_lines"`);
  }
}
