import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6.4 P7 (step 0b): returns and refunds.
 *
 *   - sale_number_counters.kind ('SALE' | 'RETURN'): RET- numbers come
 *     from the same counters as INV- numbers, per branch, kind and
 *     Colombo day. UQ_sale_counter_branch_date becomes
 *     UQ_sale_counter_branch_kind_date; existing rows are SALE.
 *   - sale_lines.returned_quantity: how many of the line have come back,
 *     never more than were sold (CHK_sale_lines_returned_qty, the backstop
 *     against an over-return under a race). The only column a return
 *     writes on a completed sale.
 *   - sale_returns: one row per return (P7-1): its RET- number, reason,
 *     refund_due (the most it may refund) and refund_total (what it did
 *     refund, never more than refund_due), the outside-warranty override
 *     (present exactly when a line is outside warranty, P7-23), who
 *     approved and whose session asked, and the till's client_request_id
 *     (unique, P7-15, P7-24). No status: a return is final.
 *   - sale_return_lines: what came back from each sale line, its share of
 *     what was paid, and where it went (disposition); a returned phone
 *     goes to INSPECTION and the line names its unit.
 *   - sale_refunds: how the money went back. CASH, or back to a non-cash
 *     payment of the sale (original_payment_id) with the reference of the
 *     reversal; never TRADE_IN (P7-4).
 *
 * The rules that span tables (refunds add up to refund_total, a refund's
 * payment belongs to the sale, the per-payment cap) are the service's,
 * inside the return's transaction with the sale row locked.
 *
 * down() refuses while any return exists (a sale_returns row, or a RETURN
 * counter row) and changes nothing: those rows are real returns and
 * refunds, and dropping them would lose them. This migration never
 * deletes them to make a revert pass.
 */
export class CreateSaleReturns1792821000000 implements MigrationInterface {
  name = 'CreateSaleReturns1792821000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- sale_number_counters.kind ----
    await queryRunner.query(
      `ALTER TABLE "sale_number_counters"
         ADD COLUMN "kind" varchar(10) NOT NULL DEFAULT 'SALE',
         ADD CONSTRAINT "CHK_sale_counter_kind" CHECK ("kind" IN ('SALE', 'RETURN'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_number_counters"
         DROP CONSTRAINT "UQ_sale_counter_branch_date",
         ADD CONSTRAINT "UQ_sale_counter_branch_kind_date"
           UNIQUE ("branch_id", "kind", "counter_date")`,
    );

    // ---- sale_lines.returned_quantity ----
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
         ADD COLUMN "returned_quantity" integer NOT NULL DEFAULT 0,
         ADD CONSTRAINT "CHK_sale_lines_returned_qty"
           CHECK ("returned_quantity" >= 0 AND "returned_quantity" <= "quantity")`,
    );

    // ---- sale_returns ----
    await queryRunner.query(
      `CREATE TABLE "sale_returns" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "return_number" varchar(20) NOT NULL,
        "sale_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "reason" varchar(500) NOT NULL,
        "refund_due" numeric(12,2) NOT NULL,
        "refund_total" numeric(12,2) NOT NULL,
        "out_of_warranty" boolean NOT NULL,
        "override_reason" varchar(500) NULL,
        "approved_by" uuid NOT NULL,
        "requested_by" uuid NOT NULL,
        "client_request_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sale_returns_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sale_returns_branch_number" UNIQUE ("branch_id", "return_number"),
        CONSTRAINT "UQ_sale_returns_client_request_id" UNIQUE ("client_request_id"),
        CONSTRAINT "CHK_sale_returns_reason" CHECK (length(trim("reason")) >= 3),
        CONSTRAINT "CHK_sale_returns_refund_due_nonneg" CHECK ("refund_due" >= 0),
        CONSTRAINT "CHK_sale_returns_refund_total"
          CHECK ("refund_total" >= 0 AND "refund_total" <= "refund_due"),
        CONSTRAINT "CHK_sale_returns_override"
          CHECK ("out_of_warranty" = ("override_reason" IS NOT NULL AND length(trim("override_reason")) >= 3)),
        CONSTRAINT "FK_sale_returns_sale"
          FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_sale_returns_branch"
          FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_sale_returns_approved_by"
          FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_sale_returns_requested_by"
          FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sale_returns_sale_id" ON "sale_returns" ("sale_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sale_returns_branch_created_at"
       ON "sale_returns" ("branch_id", "created_at")`,
    );

    // ---- sale_return_lines ----
    await queryRunner.query(
      `CREATE TABLE "sale_return_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sale_return_id" uuid NOT NULL,
        "sale_line_id" uuid NOT NULL,
        "quantity" integer NOT NULL,
        "refund_share" numeric(12,2) NOT NULL,
        "out_of_warranty" boolean NOT NULL,
        "disposition" varchar(20) NOT NULL,
        "product_unit_id" uuid NULL,
        CONSTRAINT "PK_sale_return_lines_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sale_return_lines_return_line" UNIQUE ("sale_return_id", "sale_line_id"),
        CONSTRAINT "CHK_sale_return_lines_qty_positive" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_sale_return_lines_refund_share_nonneg" CHECK ("refund_share" >= 0),
        CONSTRAINT "CHK_sale_return_lines_disposition"
          CHECK ("disposition" IN ('RESTOCKED', 'DAMAGED', 'INSPECTION', 'NOT_OUR_STOCK', 'UNTRACKED')),
        CONSTRAINT "CHK_sale_return_lines_unit"
          CHECK (("disposition" = 'INSPECTION') = ("product_unit_id" IS NOT NULL)),
        CONSTRAINT "FK_sale_return_lines_return"
          FOREIGN KEY ("sale_return_id") REFERENCES "sale_returns"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_sale_return_lines_sale_line"
          FOREIGN KEY ("sale_line_id") REFERENCES "sale_lines"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_sale_return_lines_product_unit"
          FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sale_return_lines_sale_line_id"
       ON "sale_return_lines" ("sale_line_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sale_return_lines_product_unit_id"
       ON "sale_return_lines" ("product_unit_id")
       WHERE "product_unit_id" IS NOT NULL`,
    );

    // ---- sale_refunds ----
    await queryRunner.query(
      `CREATE TABLE "sale_refunds" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sale_return_id" uuid NOT NULL,
        "method" varchar(20) NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "original_payment_id" uuid NULL,
        "reference_number" varchar(100) NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sale_refunds_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_sale_refunds_method"
          CHECK ("method" IN ('CASH', 'CARD', 'BANK_TRANSFER', 'KOKO', 'MINTPAY')),
        CONSTRAINT "CHK_sale_refunds_amount_positive" CHECK ("amount" > 0),
        CONSTRAINT "CHK_sale_refunds_original_payment"
          CHECK (("method" = 'CASH') = ("original_payment_id" IS NULL)),
        CONSTRAINT "CHK_sale_refunds_reference"
          CHECK ("method" = 'CASH' OR ("reference_number" IS NOT NULL AND length(trim("reference_number")) > 0)),
        CONSTRAINT "FK_sale_refunds_return"
          FOREIGN KEY ("sale_return_id") REFERENCES "sale_returns"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_sale_refunds_original_payment"
          FOREIGN KEY ("original_payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sale_refunds_sale_return_id"
       ON "sale_refunds" ("sale_return_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sale_refunds_original_payment_id"
       ON "sale_refunds" ("original_payment_id")
       WHERE "original_payment_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows: { returns: number; counters: number }[] =
      await queryRunner.query(
        `SELECT (SELECT count(*)::int FROM "sale_returns") AS returns,
                (SELECT count(*)::int FROM "sale_number_counters"
                  WHERE "kind" = 'RETURN') AS counters`,
      );
    const returns = rows[0]?.returns ?? 0;
    const counters = rows[0]?.counters ?? 0;
    if (returns > 0 || counters > 0) {
      throw new Error(
        `Cannot revert CreateSaleReturns: ${returns} sale return(s) and ` +
          `${counters} RETURN counter row(s) exist. They are real returns ` +
          `and refunds; this migration does not delete them.`,
      );
    }

    await queryRunner.query(`DROP TABLE "sale_refunds"`);
    await queryRunner.query(`DROP TABLE "sale_return_lines"`);
    await queryRunner.query(`DROP TABLE "sale_returns"`);

    await queryRunner.query(
      `ALTER TABLE "sale_lines"
         DROP CONSTRAINT "CHK_sale_lines_returned_qty",
         DROP COLUMN "returned_quantity"`,
    );

    await queryRunner.query(
      `ALTER TABLE "sale_number_counters"
         DROP CONSTRAINT "UQ_sale_counter_branch_kind_date",
         ADD CONSTRAINT "UQ_sale_counter_branch_date"
           UNIQUE ("branch_id", "counter_date")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_number_counters"
         DROP CONSTRAINT "CHK_sale_counter_kind",
         DROP COLUMN "kind"`,
    );
  }
}
