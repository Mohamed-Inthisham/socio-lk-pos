import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1779124684026 implements MigrationInterface {
  name = 'CreateUsersTable1779124684026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable uuid-ossp for uuid_generate_v4()
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying(255) NOT NULL,
        "password_hash" character varying(255) NOT NULL,
        "full_name" character varying(100) NOT NULL,
        "role" character varying(20) NOT NULL DEFAULT 'cashier',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_users_role" CHECK ("role" IN ('admin', 'manager', 'cashier'))
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
    // Note: we don't drop the uuid-ossp extension because other tables may use it
  }
}
