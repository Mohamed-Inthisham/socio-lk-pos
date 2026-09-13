import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductUnits1789305844556 implements MigrationInterface {
  name = 'CreateProductUnits1789305844556';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "product_units" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "product_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "imei" varchar(50) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'IN_STOCK',
        "buying_price" numeric(12,2) NOT NULL,
        "selling_price" numeric(12,2),
        "phone_purchase_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_units_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_product_units_status" CHECK ("status" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF')),
        CONSTRAINT "CHK_product_units_buying_price_nonneg" CHECK ("buying_price" >= 0),
        CONSTRAINT "CHK_product_units_selling_price_nonneg" CHECK ("selling_price" IS NULL OR "selling_price" >= 0),
        CONSTRAINT "FK_product_units_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "FK_product_units_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_product_units_imei" ON "product_units" ("imei")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_product_units_product_branch_status" ON "product_units" ("product_id", "branch_id", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_product_units_product_branch_status"`,
    );
    await queryRunner.query(`DROP INDEX "idx_product_units_imei"`);
    await queryRunner.query(`DROP TABLE "product_units"`);
  }
}
