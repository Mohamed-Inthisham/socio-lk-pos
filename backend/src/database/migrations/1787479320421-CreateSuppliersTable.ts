import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSuppliersTable1787479320421 implements MigrationInterface {
  name = 'CreateSuppliersTable1787479320421';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "suppliers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(150) NOT NULL,
        "contact_person" character varying(100),
        "phone" character varying(15),
        "email" character varying(255),
        "address" text,
        "notes" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_suppliers_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_suppliers_phone_format" CHECK ("phone" IS NULL OR "phone" ~ '^0\\d{9}$')
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_suppliers_name_lower_unique"
       ON "suppliers" (LOWER("name"))
       WHERE "deleted_at" IS NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_suppliers_is_active" ON "suppliers" ("is_active")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_suppliers_is_active"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_suppliers_name_lower_unique"`,
    );
    await queryRunner.query(`DROP TABLE "suppliers"`);
  }
}
