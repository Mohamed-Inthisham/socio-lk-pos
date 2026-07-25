import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBranchesTable1784870930702 implements MigrationInterface {
  name = 'CreateBranchesTable1784870930702';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "branches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(100) NOT NULL,
        "address" text,
        "phone" character varying(20),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_branches_id" PRIMARY KEY ("id")
      )`,
    );

    // Seed the first branch. Required: Products need a valid branch_id FK.
    await queryRunner.query(
      `INSERT INTO "branches" ("name", "is_active")
       VALUES ('Main Shop', true)
       ON CONFLICT DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "branches"`);
  }
}
