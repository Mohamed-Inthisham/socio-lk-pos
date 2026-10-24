import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6.4 P9 (backend 0a): the daily opening and closing balance.
 *
 *   - cash_days: one row per branch per Colombo business date
 *     (UQ_cash_days_branch_date, P9-1, P9-2). Opened with the opening
 *     balance; at close it gains the snapshot (cash sales, cash refunds,
 *     cash handed back for earlier days' sales voided today, expected,
 *     counted, difference and its reason, the summary jsonb for the
 *     printout) and who closed it. No status column: open is
 *     closed_at IS NULL. Money is numeric(12,2); the service works in
 *     integer cents (P9-3).
 *   - CHK_cash_days_closed_consistency: the closing columns are all null
 *     (open) or all set (closed); difference_reason follows
 *     CHK_cash_days_reason instead.
 *   - CHK_cash_days_reason (the rounding rule): the shop counts whole
 *     rupees while discounts and refund shares make cents, so a difference
 *     under 1.00 either way needs no reason and stores none; from 1.00 a
 *     reason of 3+ characters is required. The difference is stored exactly.
 *   - expected_balance may be negative (a cash refund on an earlier day's
 *     sale with a small opening); nothing forbids it.
 *   - idx_sales_branch_voided_at: the close summary's "earlier sales
 *     voided today" reads one branch's sales voided within one day.
 *     Partial, so it holds only voided sales.
 *
 * down() refuses while any cash_days row exists and changes nothing:
 * those rows are real openings and closings (P9-20).
 */
export class CreateCashDays1792908000000 implements MigrationInterface {
  name = 'CreateCashDays1792908000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "cash_days" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "branch_id" uuid NOT NULL,
        "business_date" date NOT NULL,
        "opening_balance" numeric(12,2) NOT NULL,
        "opened_by" uuid NOT NULL,
        "opened_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "open_client_request_id" uuid NOT NULL,
        "cash_sales" numeric(12,2) NULL,
        "cash_refunds" numeric(12,2) NULL,
        "cash_voids_earlier" numeric(12,2) NULL,
        "expected_balance" numeric(12,2) NULL,
        "counted_balance" numeric(12,2) NULL,
        "difference" numeric(12,2) NULL,
        "difference_reason" varchar(500) NULL,
        "summary" jsonb NULL,
        "closed_by" uuid NULL,
        "closed_at" TIMESTAMP WITH TIME ZONE NULL,
        "close_client_request_id" uuid NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cash_days_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cash_days_branch_date" UNIQUE ("branch_id", "business_date"),
        CONSTRAINT "UQ_cash_days_open_client_request_id" UNIQUE ("open_client_request_id"),
        CONSTRAINT "UQ_cash_days_close_client_request_id" UNIQUE ("close_client_request_id"),
        CONSTRAINT "CHK_cash_days_opening_nonneg" CHECK ("opening_balance" >= 0),
        CONSTRAINT "CHK_cash_days_close_amounts_nonneg"
          CHECK ("cash_sales" >= 0 AND "cash_refunds" >= 0 AND "cash_voids_earlier" >= 0 AND "counted_balance" >= 0),
        CONSTRAINT "CHK_cash_days_expected"
          CHECK ("expected_balance" = "opening_balance" + "cash_sales" - "cash_refunds" - "cash_voids_earlier"),
        CONSTRAINT "CHK_cash_days_difference"
          CHECK ("difference" = "counted_balance" - "expected_balance"),
        CONSTRAINT "CHK_cash_days_reason"
          CHECK (CASE WHEN "difference" IS NULL OR abs("difference") < 1 THEN "difference_reason" IS NULL ELSE "difference_reason" IS NOT NULL AND length(trim("difference_reason")) >= 3 END),
        CONSTRAINT "CHK_cash_days_closed_consistency"
          CHECK (("cash_sales" IS NULL AND "cash_refunds" IS NULL AND "cash_voids_earlier" IS NULL AND "expected_balance" IS NULL AND "counted_balance" IS NULL AND "difference" IS NULL AND "summary" IS NULL AND "closed_by" IS NULL AND "closed_at" IS NULL AND "close_client_request_id" IS NULL) OR ("cash_sales" IS NOT NULL AND "cash_refunds" IS NOT NULL AND "cash_voids_earlier" IS NOT NULL AND "expected_balance" IS NOT NULL AND "counted_balance" IS NOT NULL AND "difference" IS NOT NULL AND "summary" IS NOT NULL AND "closed_by" IS NOT NULL AND "closed_at" IS NOT NULL AND "close_client_request_id" IS NOT NULL)),
        CONSTRAINT "FK_cash_days_branch"
          FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_cash_days_opened_by"
          FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_cash_days_closed_by"
          FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE RESTRICT
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_sales_branch_voided_at"
       ON "sales" ("branch_id", "voided_at")
       WHERE "voided_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows: { days: number }[] = await queryRunner.query(
      `SELECT count(*)::int AS days FROM "cash_days"`,
    );
    const days = rows[0]?.days ?? 0;
    if (days > 0) {
      throw new Error(
        `Cannot revert CreateCashDays: ${days} cash day(s) exist. They are ` +
          `real opening and closing balances; this migration does not ` +
          `delete them.`,
      );
    }

    await queryRunner.query(`DROP INDEX "idx_sales_branch_voided_at"`);
    await queryRunner.query(`DROP TABLE "cash_days"`);
  }
}
