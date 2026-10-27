import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryProductTracking1793000000000 implements MigrationInterface {
  name = 'AddCategoryProductTracking1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Keep legacy type/model values for compatibility and rollback. New forms
    // use category settings, model and tracking_method instead.
    await queryRunner.query(`ALTER TABLE "products"
      ALTER COLUMN "product_type" DROP NOT NULL,
      ADD COLUMN "model" varchar(100),
      ADD COLUMN "tracking_method" varchar(20) NOT NULL DEFAULT 'QUANTITY',
      ADD CONSTRAINT "CHK_products_tracking_method"
        CHECK ("tracking_method" IN ('QUANTITY', 'IMEI', 'SERIAL_NUMBER'))`);
    await queryRunner.query(`UPDATE "products" SET "model" = "phone_model",
      "tracking_method" = CASE WHEN "is_serialized" THEN 'IMEI' ELSE 'QUANTITY' END`);
    await queryRunner.query(`ALTER TABLE "categories"
      ADD COLUMN "show_phone_specs" boolean NOT NULL DEFAULT false,
      ADD COLUMN "default_tracking_method" varchar(20) NOT NULL DEFAULT 'QUANTITY',
      ADD CONSTRAINT "CHK_categories_tracking_method"
        CHECK ("default_tracking_method" IN ('QUANTITY', 'IMEI', 'SERIAL_NUMBER'))`);
    // Names are deliberately not used to infer category behavior. Mixed
    // categories retain each product's own tracking choice.
    await queryRunner.query(`UPDATE "categories" c SET "show_phone_specs" = true
      WHERE EXISTS (SELECT 1 FROM "products" p
        WHERE p."category_id" = c."id" AND p."product_type" = 'PHONE')`);
    await queryRunner.query(`UPDATE "categories" c SET "default_tracking_method" = x.method
      FROM (SELECT "category_id", min("tracking_method") AS method
        FROM "products" WHERE "deleted_at" IS NULL
        GROUP BY "category_id" HAVING count(DISTINCT "tracking_method") = 1) x
      WHERE c."id" = x."category_id"`);
    await queryRunner.query(`ALTER TABLE "products"
      ADD CONSTRAINT "CHK_products_tracking_serialized"
      CHECK ("is_serialized" = ("tracking_method" <> 'QUANTITY'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Do not invent legacy classifications or discard newly entered models.
    const incompatible: { count: number }[] =
      await queryRunner.query(`SELECT count(*)::int AS count
      FROM "products" WHERE "product_type" IS NULL OR "model" IS DISTINCT FROM "phone_model"`);
    if (incompatible[0]?.count) {
      throw new Error(
        'Cannot revert category product tracking: new or edited products need an explicit legacy type/model mapping first.',
      );
    }
    await queryRunner.query(`ALTER TABLE "products"
      DROP CONSTRAINT "CHK_products_tracking_serialized",
      DROP CONSTRAINT "CHK_products_tracking_method",
      DROP COLUMN "tracking_method", DROP COLUMN "model",
      ALTER COLUMN "product_type" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "categories"
      DROP CONSTRAINT "CHK_categories_tracking_method",
      DROP COLUMN "default_tracking_method", DROP COLUMN "show_phone_specs"`);
  }
}
