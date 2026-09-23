import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Slice G — Trade-ins.
 *
 * Adds trade-in payment support. A TRADE_IN payment references a
 * ProductUnit (via its PhonePurchase) that is materialized at
 * completeSale time — during DRAFT, all trade-in state lives on the
 * payment row itself (Q1 lifecycle: nested + lazy).
 *
 * Schema changes:
 *
 * 1. Extend CHK_payments_method to include 'TRADE_IN'. Drop-and-recreate
 *    rather than a second overlapping CHK, matching the pattern from
 *    AddVoidReasonAndPaymentReversal (single-source invariant).
 *
 * 2. Add six columns to payments:
 *    - trade_in_product_id       uuid, FK → products.id (RESTRICT)
 *    - trade_in_imei             varchar(50)
 *    - trade_in_buying_price     numeric(12,2)
 *    - trade_in_selling_price    numeric(12,2)
 *    - trade_in_notes            text
 *    - trade_in_phone_purchase_id uuid, FK → phone_purchases.id
 *                                  (RESTRICT), NULL until completeSale
 *    All nullable — non-TRADE_IN payments leave them NULL. Enforcement
 *    is via CHK constraints below.
 *
 * 3. CHK_payments_trade_in_fields_consistent: if method is TRADE_IN,
 *    product_id + imei + buying_price MUST be set (Q3 nullability lock:
 *    notes and selling_price are nullable either way).
 *
 * 4. CHK_payments_trade_in_fields_null_when_not_trade_in: if method is
 *    NOT TRADE_IN, ALL six trade-in columns MUST be NULL. Together with
 *    (3), this fully partitions the payment space: TRADE_IN payments
 *    carry trade-in data, other methods carry none.
 *
 * 5. CHK_payments_trade_in_amount_matches: for TRADE_IN payments, the
 *    payment.amount MUST equal trade_in_buying_price. This is the
 *    schema-level backstop for the Q2 service-layer invariant. Postgres
 *    numeric equality is exact, so this is safe.
 *
 * 6. CHK_payments_trade_in_pp_reference: trade_in_phone_purchase_id may
 *    only be populated when method is TRADE_IN. Belt-and-braces — the
 *    partial unique index below assumes this and (4) would already fire
 *    on a non-TRADE_IN payment with a PP id, but an explicit CHK makes
 *    intent readable.
 *
 * 7. Partial unique index on trade_in_phone_purchase_id (WHERE NOT NULL):
 *    enforces "a PhonePurchase can be used as a trade-in on at most one
 *    sale, ever." Q4 lock — defense against future flows and bugs; not
 *    reachable via the normal Slice G completeSale path (each PP is
 *    created FOR one specific payment inside the same transaction).
 *
 * Down migration reverses in strict inverse order. Note: restoring
 * CHK_payments_method to its pre-Slice-G shape fails if any TRADE_IN
 * payment rows exist. Operator must delete/convert them first — same
 * destructive-down pattern as Slice E's product_unit_id drop.
 */
export class AddTradeInColumnsToPayments1790147324351 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Extend CHK_payments_method to allow 'TRADE_IN'.
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "CHK_payments_method"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "CHK_payments_method"
       CHECK ("payment_method" IN ('CASH', 'CARD', 'BANK_TRANSFER', 'KOKO', 'MINTPAY', 'TRADE_IN'))`,
    );

    // 2. Add trade-in columns (all nullable).
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "trade_in_product_id" uuid NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "trade_in_imei" varchar(50) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "trade_in_buying_price" numeric(12,2) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "trade_in_selling_price" numeric(12,2) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "trade_in_notes" text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "trade_in_phone_purchase_id" uuid NULL`,
    );

    // FK: trade_in_product_id → products.id
    await queryRunner.query(
      `ALTER TABLE "payments"
       ADD CONSTRAINT "FK_payments_trade_in_product_id"
       FOREIGN KEY ("trade_in_product_id")
       REFERENCES "products"("id")
       ON DELETE RESTRICT
       ON UPDATE CASCADE`,
    );

    // FK: trade_in_phone_purchase_id → phone_purchases.id
    await queryRunner.query(
      `ALTER TABLE "payments"
       ADD CONSTRAINT "FK_payments_trade_in_phone_purchase_id"
       FOREIGN KEY ("trade_in_phone_purchase_id")
       REFERENCES "phone_purchases"("id")
       ON DELETE RESTRICT
       ON UPDATE CASCADE`,
    );

    // 3. TRADE_IN payments require product_id + imei + buying_price.
    //    Uses the (LHS boolean) = (RHS boolean) idiom for iff, mirroring
    //    CHK_payments_cash_received_only_for_cash on the same table.
    //    Note: this ONLY enforces the forward direction (TRADE_IN =>
    //    required fields present). The reverse (non-TRADE_IN =>
    //    required fields absent) is only partially enforced here (at
    //    least one of the three must be NULL); constraint (4) enforces
    //    the full "all NULL" invariant for non-TRADE_IN.
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "CHK_payments_trade_in_fields_consistent"
       CHECK (
         ("payment_method" = 'TRADE_IN') = (
           "trade_in_product_id" IS NOT NULL
           AND "trade_in_imei" IS NOT NULL
           AND "trade_in_buying_price" IS NOT NULL
         )
       )`,
    );

    // 4. Non-TRADE_IN payments must have ALL trade-in columns NULL
    //    (including notes, selling_price, and phone_purchase_id which
    //    constraint (3) does not cover).
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "CHK_payments_trade_in_fields_null_when_not_trade_in"
       CHECK (
         "payment_method" = 'TRADE_IN'
         OR (
           "trade_in_product_id" IS NULL
           AND "trade_in_imei" IS NULL
           AND "trade_in_buying_price" IS NULL
           AND "trade_in_selling_price" IS NULL
           AND "trade_in_notes" IS NULL
           AND "trade_in_phone_purchase_id" IS NULL
         )
       )`,
    );

    // 5. TRADE_IN amount MUST equal trade_in_buying_price.
    //    Numeric equality is exact in Postgres, so this is safe.
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "CHK_payments_trade_in_amount_matches"
       CHECK (
         "payment_method" != 'TRADE_IN'
         OR "amount" = "trade_in_buying_price"
       )`,
    );

    // 6. trade_in_phone_purchase_id may only be populated for TRADE_IN.
    //    Redundant with (4) for non-TRADE_IN payments, but reads as a
    //    direct statement of intent.
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "CHK_payments_trade_in_pp_reference"
       CHECK (
         "trade_in_phone_purchase_id" IS NULL
         OR "payment_method" = 'TRADE_IN'
       )`,
    );

    // 7. Partial unique index: one PP can be used as trade-in on at
    //    most one sale. Only indexes rows where PP id is populated.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payments_trade_in_phone_purchase_id"
       ON "payments" ("trade_in_phone_purchase_id")
       WHERE "trade_in_phone_purchase_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse in strict inverse order: index, CHKs, FKs, columns,
    // then CHK_payments_method restoration.
    //
    // WARNING: the final step (restore CHK_payments_method without
    // 'TRADE_IN') will fail if any TRADE_IN payment rows exist. The
    // operator must delete or convert them before running this down.

    await queryRunner.query(
      `DROP INDEX "uq_payments_trade_in_phone_purchase_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "CHK_payments_trade_in_pp_reference"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "CHK_payments_trade_in_amount_matches"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "CHK_payments_trade_in_fields_null_when_not_trade_in"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "CHK_payments_trade_in_fields_consistent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_payments_trade_in_phone_purchase_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_payments_trade_in_product_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "trade_in_phone_purchase_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "trade_in_notes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "trade_in_selling_price"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "trade_in_buying_price"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "trade_in_imei"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "trade_in_product_id"`,
    );

    // Restore original CHK_payments_method (no TRADE_IN).
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "CHK_payments_method"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "CHK_payments_method"
       CHECK ("payment_method" IN ('CASH', 'CARD', 'BANK_TRANSFER', 'KOKO', 'MINTPAY'))`,
    );
  }
}
