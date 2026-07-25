import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBrandsTable1784956995475 implements MigrationInterface {
  name = 'CreateBrandsTable1784956995475';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "brands" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(100) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_brands_id" PRIMARY KEY ("id")
      )`,
    );

    // Case-insensitive unique index on name. Prevents "Apple" and "apple" from
    // coexisting as separate brands. Postgres functional index — the LOWER()
    // expression is evaluated at insert/update time and compared for uniqueness.
    // The WHERE clause excludes soft-deleted rows so a brand can be re-created
    // with the same name after being soft-deleted.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_brands_name_lower" ON "brands" (LOWER("name")) WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_brands_name_lower"`);
    await queryRunner.query(`DROP TABLE "brands"`);
  }
}
