import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCategoriesTable1784962636347 implements MigrationInterface {
  name = 'CreateCategoriesTable1784962636347';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "categories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(100) NOT NULL,
        "parent_id" uuid,
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_categories_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_categories_parent_id" FOREIGN KEY ("parent_id")
          REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`,
    );

    // Case-insensitive unique index scoped to siblings.
    //
    // (LOWER(name), parent_id) means "Cables" under "Accessories" and
    // "Cables" under "Phones" can coexist — they are different rows because
    // parent_id differs. But two "Cables" siblings under the same parent
    // collide.
    //
    // COALESCE handles NULL parent_id (top-level categories). Postgres
    // treats NULL != NULL in unique constraints, so two top-level "Phones"
    // categories would otherwise be allowed. Coercing to a fixed sentinel
    // UUID inside the index makes NULL parents compare equal.
    //
    // WHERE deleted_at IS NULL excludes soft-deleted rows so a category
    // can be re-created with the same name after deletion.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_categories_name_parent_lower"
       ON "categories" (LOWER("name"), COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid))
       WHERE "deleted_at" IS NULL`,
    );

    // Index on parent_id for fast "get children of X" queries.
    await queryRunner.query(
      `CREATE INDEX "idx_categories_parent_id" ON "categories" ("parent_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_categories_parent_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_categories_name_parent_lower"`,
    );
    await queryRunner.query(`DROP TABLE "categories"`);
  }
}
