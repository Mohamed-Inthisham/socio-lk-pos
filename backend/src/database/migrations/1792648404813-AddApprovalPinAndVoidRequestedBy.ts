import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Manager approval PIN (Phase 6.4 P6-15 – P6-21).
 *
 * users: the PIN's bcrypt hash, when it was set, and the wrong-PIN count
 * and lock (P6-19). CHECKs: only admins and managers hold a PIN (so a
 * future route that makes someone a cashier must clear it first), the set
 * time is present exactly when the hash is, and the count is never
 * negative.
 *
 * sales: void_requested_by, the user whose session asked for the void;
 * voided_by stays the admin or manager who authorized it (the approver).
 * Before this migration only admins and managers could void, on their own
 * session, so existing voided sales are backfilled with
 * void_requested_by = voided_by before the CHECK requires it on every
 * VOIDED sale.
 */
export class AddApprovalPinAndVoidRequestedBy1792648404813 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users"
         ADD COLUMN "approval_pin_hash" varchar(255) NULL,
         ADD COLUMN "approval_pin_set_at" timestamptz NULL,
         ADD COLUMN "approval_pin_failed_attempts" smallint NOT NULL DEFAULT 0,
         ADD COLUMN "approval_pin_locked_until" timestamptz NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users"
         ADD CONSTRAINT "CHK_users_approval_pin_role"
           CHECK ("approval_pin_hash" IS NULL OR "role" IN ('admin', 'manager')),
         ADD CONSTRAINT "CHK_users_approval_pin_set_at"
           CHECK (("approval_pin_hash" IS NULL) = ("approval_pin_set_at" IS NULL)),
         ADD CONSTRAINT "CHK_users_approval_pin_attempts"
           CHECK ("approval_pin_failed_attempts" >= 0)`,
    );

    await queryRunner.query(
      `ALTER TABLE "sales"
         ADD COLUMN "void_requested_by" uuid NULL,
         ADD CONSTRAINT "FK_sales_void_requested_by"
           FOREIGN KEY ("void_requested_by") REFERENCES "users"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `UPDATE "sales" SET "void_requested_by" = "voided_by" WHERE "status" = 'VOIDED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales"
         ADD CONSTRAINT "CHK_sales_void_requested_consistency"
           CHECK (("status" = 'VOIDED') = ("void_requested_by" IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales"
         DROP CONSTRAINT "CHK_sales_void_requested_consistency",
         DROP CONSTRAINT "FK_sales_void_requested_by",
         DROP COLUMN "void_requested_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users"
         DROP CONSTRAINT "CHK_users_approval_pin_attempts",
         DROP CONSTRAINT "CHK_users_approval_pin_set_at",
         DROP CONSTRAINT "CHK_users_approval_pin_role",
         DROP COLUMN "approval_pin_locked_until",
         DROP COLUMN "approval_pin_failed_attempts",
         DROP COLUMN "approval_pin_set_at",
         DROP COLUMN "approval_pin_hash"`,
    );
  }
}
