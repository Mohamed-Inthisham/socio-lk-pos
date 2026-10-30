import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A staff member's contact number, NIC and address (Task 2.5).
 *
 * Nullable: existing users have none, and POST /users makes them required
 * for new ones. The NIC is unique among users that aren't deleted, so a
 * removed account doesn't block the person from being added again.
 */
export class AddUserContactDetails1793400000000 implements MigrationInterface {
  name = 'AddUserContactDetails1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users"
      ADD COLUMN "phone" varchar(20) NULL,
      ADD COLUMN "nic" varchar(20) NULL,
      ADD COLUMN "address" text NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "idx_users_nic_unique"
      ON "users" ("nic")
      WHERE "nic" IS NOT NULL AND "deleted_at" IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_users_nic_unique"`);
    await queryRunner.query(`ALTER TABLE "users"
      DROP COLUMN "address",
      DROP COLUMN "nic",
      DROP COLUMN "phone"`);
  }
}
