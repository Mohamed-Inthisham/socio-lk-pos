import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBrandCategory1793001000000 implements MigrationInterface {
  name = 'AddBrandCategory1793001000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "brands" ADD COLUMN "category_id" uuid`);
    await queryRunner.query(`UPDATE "brands" b SET "category_id" = x.category_id
      FROM (
        SELECT "brand_id", min("category_id"::text)::uuid AS category_id
        FROM "products" WHERE "deleted_at" IS NULL
        GROUP BY "brand_id" HAVING count(DISTINCT "category_id") = 1
      ) x WHERE b."id" = x."brand_id"`);
    await queryRunner.query(`ALTER TABLE "brands"
      ADD CONSTRAINT "FK_brands_category_id" FOREIGN KEY ("category_id")
      REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    await queryRunner.query(`CREATE INDEX "idx_brands_category_id" ON "brands" ("category_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_brands_category_id"`);
    await queryRunner.query(`ALTER TABLE "brands" DROP CONSTRAINT "FK_brands_category_id"`);
    await queryRunner.query(`ALTER TABLE "brands" DROP COLUMN "category_id"`);
  }
}
