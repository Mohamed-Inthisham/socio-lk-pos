import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductsTable1785308050748 implements MigrationInterface {
  name = 'CreateProductsTable1785308050748';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "products" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "product_type" character varying(20) NOT NULL,
        "name" character varying(200) NOT NULL,
        "sku" character varying(30) NOT NULL,
        "barcode" character varying(100) NOT NULL,
        "barcode_type" character varying(20) NOT NULL DEFAULT 'CODE_128',
        "brand_id" uuid NOT NULL,
        "category_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "description" text,
        "buying_price" numeric(10,2) NOT NULL,
        "selling_price" numeric(10,2) NOT NULL,
        "warranty_months" integer NOT NULL DEFAULT 0,
        "checking_warranty_days" integer NOT NULL DEFAULT 0,
        "is_serialized" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "phone_condition" character varying(10),
        "phone_model" character varying(100),
        "phone_storage" character varying(50),
        "phone_color" character varying(50),
        "phone_ram" character varying(50),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_products_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_products_type"
          CHECK ("product_type" IN ('PHONE', 'ACCESSORY', 'WATCH', 'SPEAKER')),
        CONSTRAINT "CHK_products_barcode_type"
          CHECK ("barcode_type" IN ('CODE_128', 'EAN_13')),
        CONSTRAINT "CHK_products_phone_condition"
          CHECK ("phone_condition" IS NULL OR "phone_condition" IN ('NEW', 'USED')),
        CONSTRAINT "CHK_products_buying_price_nonneg" CHECK ("buying_price" >= 0),
        CONSTRAINT "CHK_products_selling_price_nonneg" CHECK ("selling_price" >= 0),
        CONSTRAINT "CHK_products_warranty_months_nonneg" CHECK ("warranty_months" >= 0),
        CONSTRAINT "CHK_products_checking_warranty_days_nonneg"
          CHECK ("checking_warranty_days" >= 0)
      )`,
    );

    // Unique indexes on sku and barcode.
    // Partial (WHERE deleted_at IS NULL) so soft-deleted products don't
    // block reuse of their SKU or barcode. Consistent with Brand/Category.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_products_sku"
       ON "products" ("sku") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_products_barcode"
       ON "products" ("barcode") WHERE "deleted_at" IS NULL`,
    );

    // Indexes on FK columns for fast joins and "products by brand/category/branch" queries.
    // Not unique — a brand has many products.
    await queryRunner.query(
      `CREATE INDEX "idx_products_brand_id" ON "products" ("brand_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_products_category_id" ON "products" ("category_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_products_branch_id" ON "products" ("branch_id")`,
    );

    // Foreign keys. RESTRICT on delete so Postgres refuses to hard-delete
    // a brand/category/branch that still has products pointing at it.
    // (Soft-deactivation via is_active=false is the intended everyday path.)
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_products_brand_id"
       FOREIGN KEY ("brand_id") REFERENCES "brands"("id")
       ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_products_category_id"
       FOREIGN KEY ("category_id") REFERENCES "categories"("id")
       ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_products_branch_id"
       FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
       ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_products_branch_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_products_category_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_products_brand_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_products_branch_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_products_category_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_products_brand_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_products_barcode"`);
    await queryRunner.query(`DROP INDEX "public"."idx_products_sku"`);
    await queryRunner.query(`DROP TABLE "products"`);
  }
}
