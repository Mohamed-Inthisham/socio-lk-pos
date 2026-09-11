import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Slice G — Void support.
 *
 * Three coupled changes, all in service of the sale-void flow:
 *
 * 1. Add `sales.void_reason TEXT NULL`. Required at the service/DTO
 *    layer for every void, but nullable at the DB because every
 *    existing (and future non-VOIDED) sale has no reason. The
 *    presence/absence is bound to sale status via the extended
 *    CHK_sales_voided_consistency check below.
 *
 * 2. Extend CHK_sales_voided_consistency to include void_reason.
 *    Before: (status = 'VOIDED') = (voided_at IS NOT NULL AND voided_by IS NOT NULL)
 *    After:  same, plus void_reason must be non-null and non-blank
 *            iff status = VOIDED.
 *    We drop and recreate rather than adding a second overlapping CHK,
 *    so the invariant lives in one place. length(trim(...)) > 0 catches
 *    both empty strings and whitespace-only strings; the DTO trims on
 *    input as a first line of defense.
 *
 * 3. Add `payments.reversed_at TIMESTAMPTZ NULL` and
 *    `payments.reversal_reason TEXT NULL`. Both set together when the
 *    parent sale is voided (populated from sale.void_reason). No DB
 *    CHK linking them to sale.status — cross-table CHECKs aren't
 *    supported in Postgres. The service transaction enforces the
 *    invariant: reversed_at/reversal_reason are set iff parent sale
 *    transitions to VOIDED, in the same atomic operation. A same-row
 *    CHK still enforces both-or-neither: they must be consistently
 *    NULL or consistently populated.
 *
 * Reversible: down() drops the payment columns, restores the original
 * CHK_sales_voided_consistency (without void_reason), then drops the
 * void_reason column. Order matters — restore the CHK before dropping
 * the column it references.
 */
export class AddVoidReasonAndPaymentReversal1789104759106 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add void_reason column to sales
    await queryRunner.query(
      `ALTER TABLE "sales" ADD COLUMN "void_reason" TEXT`,
    );

    // 2. Replace CHK_sales_voided_consistency with an extended version
    //    that also binds void_reason to status = VOIDED.
    await queryRunner.query(
      `ALTER TABLE "sales" DROP CONSTRAINT "CHK_sales_voided_consistency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales" ADD CONSTRAINT "CHK_sales_voided_consistency"
       CHECK (
         ("status" = 'VOIDED') = (
           "voided_at" IS NOT NULL
           AND "voided_by" IS NOT NULL
           AND "void_reason" IS NOT NULL
           AND length(trim("void_reason")) > 0
         )
       )`,
    );

    // 3. Add reversal columns to payments
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "reversed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "reversal_reason" TEXT`,
    );

    // Same-row consistency: both reversal columns are set together, or
    // both null. The cross-table invariant (reversed iff parent sale
    // VOIDED) is enforced at the service layer since Postgres CHECKs
    // can't span tables.
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "CHK_payments_reversal_consistency"
       CHECK (
         ("reversed_at" IS NOT NULL) = ("reversal_reason" IS NOT NULL
           AND length(trim("reversal_reason")) > 0)
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 3. Drop payment reversal constraint and columns
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "CHK_payments_reversal_consistency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "reversal_reason"`,
    );
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "reversed_at"`);

    // 2. Restore original CHK_sales_voided_consistency (without void_reason).
    //    Must be done BEFORE dropping void_reason column.
    await queryRunner.query(
      `ALTER TABLE "sales" DROP CONSTRAINT "CHK_sales_voided_consistency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales" ADD CONSTRAINT "CHK_sales_voided_consistency"
       CHECK (("status" = 'VOIDED') = ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL))`,
    );

    // 1. Drop void_reason column
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN "void_reason"`);
  }
}
