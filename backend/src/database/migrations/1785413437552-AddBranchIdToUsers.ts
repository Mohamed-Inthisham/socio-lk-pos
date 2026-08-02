import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBranchIdToUsers1785413437552 implements MigrationInterface {
  name = 'AddBranchIdToUsers1785413437552';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add nullable branch_id column with FK to branches.
    //    ON DELETE RESTRICT: never let a branch delete orphan its users
    //    (protects audit trail integrity — same logic as Products/Stock in 6.1).
    await queryRunner.query(
      `ALTER TABLE "users"
       ADD COLUMN "branch_id" uuid,
       ADD CONSTRAINT "FK_users_branch_id"
         FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
         ON DELETE RESTRICT ON UPDATE CASCADE`,
    );

    // 2. Index the FK column. Postgres does NOT auto-index FKs,
    //    and every "list users in my branch" query will filter on this.
    await queryRunner.query(
      `CREATE INDEX "idx_users_branch_id" ON "users" ("branch_id")`,
    );

    // 3. Backfill: assign every non-admin user to Main Shop.
    //    Admins stay NULL — they're the un-branched role.
    //    Must run BEFORE the CHECK constraint, or it rejects itself.
    await queryRunner.query(
      `UPDATE "users"
       SET "branch_id" = (
         SELECT "id" FROM "branches" WHERE "name" = 'Main Shop' LIMIT 1
       )
       WHERE "role" <> 'admin' AND "branch_id" IS NULL`,
    );

    // 4. Enforce the invariant: managers/cashiers MUST have a branch.
    //    Admins MAY have NULL (see note on strict vs permissive below).
    await queryRunner.query(
      `ALTER TABLE "users"
       ADD CONSTRAINT "CHK_users_branch_role"
         CHECK ("role" = 'admin' OR "branch_id" IS NOT NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse order: drop constraint, index, FK, column.
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_branch_role"`,
    );
    await queryRunner.query(`DROP INDEX "idx_users_branch_id"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_users_branch_id"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "branch_id"`);
  }
}
