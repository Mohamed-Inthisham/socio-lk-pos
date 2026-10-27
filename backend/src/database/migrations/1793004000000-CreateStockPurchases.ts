import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStockPurchases1793004000000
  implements MigrationInterface
{
  name = 'CreateStockPurchases1793004000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "stock_purchases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "purchase_number" varchar(20) NOT NULL,
        "supplier_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "created_by_id" uuid NOT NULL,
        "purchase_date" date NOT NULL,
        "supplier_invoice_number" varchar(100),
        "total_amount" numeric(14,2) NOT NULL,
        "notes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_purchases_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_purchases_number" UNIQUE ("purchase_number"),
        CONSTRAINT "CHK_stock_purchases_total_nonneg" CHECK ("total_amount" >= 0),
        CONSTRAINT "FK_stock_purchases_supplier" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_stock_purchases_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_stock_purchases_creator" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_stock_purchases_supplier_date" ON "stock_purchases" ("supplier_id", "purchase_date" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_stock_purchases_branch_date" ON "stock_purchases" ("branch_id", "purchase_date" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE "stock_purchase_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "stock_purchase_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "product_name_snapshot" varchar(200) NOT NULL,
        "product_sku_snapshot" varchar(30) NOT NULL,
        "quantity" integer NOT NULL,
        "unit_buying_price" numeric(12,2) NOT NULL,
        "unit_selling_price" numeric(12,2),
        "line_total" numeric(14,2) NOT NULL,
        "imei_numbers" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "serial_numbers" jsonb NOT NULL DEFAULT '[]'::jsonb,
        CONSTRAINT "PK_stock_purchase_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_purchase_items_product" UNIQUE ("stock_purchase_id", "product_id"),
        CONSTRAINT "CHK_stock_purchase_items_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_stock_purchase_items_buying_price" CHECK ("unit_buying_price" >= 0),
        CONSTRAINT "CHK_stock_purchase_items_selling_price" CHECK ("unit_selling_price" IS NULL OR "unit_selling_price" >= 0),
        CONSTRAINT "CHK_stock_purchase_items_line_total" CHECK ("line_total" >= 0),
        CONSTRAINT "FK_stock_purchase_items_purchase" FOREIGN KEY ("stock_purchase_id") REFERENCES "stock_purchases"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_stock_purchase_items_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_stock_purchase_items_product" ON "stock_purchase_items" ("product_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_stock_purchase_items_product"`);
    await queryRunner.query(`DROP TABLE "stock_purchase_items"`);
    await queryRunner.query(`DROP INDEX "idx_stock_purchases_branch_date"`);
    await queryRunner.query(`DROP INDEX "idx_stock_purchases_supplier_date"`);
    await queryRunner.query(`DROP TABLE "stock_purchases"`);
  }
}
