import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6.4 P5-18 — one warranty period per sale line, chosen at the till.
 *
 * Products: `default_warranty` (varchar code, default CHECKING) replaces
 * `warranty_months` + `checking_warranty_days`. Sale lines: `warranty`
 * (the code the line was sold with, NOT NULL) and `warranty_until` (its
 * last day, set when the sale completes; NULL for CHECKING), replacing
 * #32's `warranty_months_snapshot` + `checking_warranty_days_snapshot`.
 *
 * Codes: CHECKING (no warranty after leaving the shop), WEEK_1, WEEK_2,
 * MONTH_1, MONTH_2, MONTH_3, MONTH_6, MONTH_12, MONTH_18, MONTH_24. Kept in
 * step with WarrantyPeriod (products/enums/warranty-period.enum.ts);
 * repeated here because a migration must not depend on app code.
 *
 * Old values map to a code by rounding DOWN to the nearest listed period
 * (never promise more than before): months 4–5 → MONTH_3, 6–11 → MONTH_6,
 * 12–17 → MONTH_12, 18–23 → MONTH_18, 24+ → MONTH_24; with 0 months,
 * checking days 7–13 → WEEK_1, 14–29 → WEEK_2, 30+ → MONTH_1, else
 * CHECKING. Months win when both are set.
 *
 * Backfill (dev/test data only — no production data yet): DRAFT lines take
 * their product's new default; completed and voided lines take their #32
 * snapshot's code (CHECKING when there is none), and `warranty_until` from
 * their own completion date (Colombo).
 *
 * down() restores the four old columns from the codes (MONTH_n → n months;
 * WEEK_1/WEEK_2 → 7/14 checking days; CHECKING → 0/0).
 */

const CODES = `'CHECKING', 'WEEK_1', 'WEEK_2', 'MONTH_1', 'MONTH_2', 'MONTH_3', 'MONTH_6', 'MONTH_12', 'MONTH_18', 'MONTH_24'`;

/** Old (months, days) SQL expressions → code. */
const toCode = (months: string, days: string) => `CASE
  WHEN ${months} >= 24 THEN 'MONTH_24'
  WHEN ${months} >= 18 THEN 'MONTH_18'
  WHEN ${months} >= 12 THEN 'MONTH_12'
  WHEN ${months} >= 6 THEN 'MONTH_6'
  WHEN ${months} >= 3 THEN 'MONTH_3'
  WHEN ${months} = 2 THEN 'MONTH_2'
  WHEN ${months} = 1 THEN 'MONTH_1'
  WHEN ${days} >= 30 THEN 'MONTH_1'
  WHEN ${days} >= 14 THEN 'WEEK_2'
  WHEN ${days} >= 7 THEN 'WEEK_1'
  ELSE 'CHECKING'
END`;

/** A code column → its last day of warranty from `baseDate`. */
const untilFrom = (code: string, baseDate: string) => `CASE ${code}
  WHEN 'WEEK_1' THEN ${baseDate} + 7
  WHEN 'WEEK_2' THEN ${baseDate} + 14
  WHEN 'MONTH_1' THEN (${baseDate} + interval '1 months')::date
  WHEN 'MONTH_2' THEN (${baseDate} + interval '2 months')::date
  WHEN 'MONTH_3' THEN (${baseDate} + interval '3 months')::date
  WHEN 'MONTH_6' THEN (${baseDate} + interval '6 months')::date
  WHEN 'MONTH_12' THEN (${baseDate} + interval '12 months')::date
  WHEN 'MONTH_18' THEN (${baseDate} + interval '18 months')::date
  WHEN 'MONTH_24' THEN (${baseDate} + interval '24 months')::date
  ELSE NULL
END`;

/** A code column → old warranty_months / checking_warranty_days (for down()). */
const monthsOf = (code: string) =>
  `CASE WHEN ${code} LIKE 'MONTH_%' THEN substring(${code} from 7)::integer ELSE 0 END`;
const daysOf = (code: string) =>
  `CASE ${code} WHEN 'WEEK_1' THEN 7 WHEN 'WEEK_2' THEN 14 ELSE 0 END`;

export class WarrantyPeriodPerLine1792511071479 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Products: the default, mapped from the old numbers.
    await queryRunner.query(
      `ALTER TABLE "products"
       ADD COLUMN "default_warranty" varchar(20) NOT NULL DEFAULT 'CHECKING'`,
    );
    await queryRunner.query(
      `UPDATE "products"
       SET "default_warranty" = ${toCode('"warranty_months"', '"checking_warranty_days"')}`,
    );
    await queryRunner.query(
      `ALTER TABLE "products"
       ADD CONSTRAINT "CHK_products_default_warranty"
       CHECK ("default_warranty" IN (${CODES}))`,
    );

    // 2. Sale lines: the period sold, and its last day.
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       ADD COLUMN "warranty" varchar(20) NULL,
       ADD COLUMN "warranty_until" date NULL`,
    );
    await queryRunner.query(
      `UPDATE "sale_lines" AS line
       SET "warranty" = product."default_warranty"
       FROM "products" AS product, "sales" AS sale
       WHERE product.id = line.product_id
         AND sale.id = line.sale_id
         AND sale.status = 'DRAFT'`,
    );
    await queryRunner.query(
      `UPDATE "sale_lines" AS line
       SET "warranty" = ${toCode(
         'COALESCE(line."warranty_months_snapshot", 0)',
         'COALESCE(line."checking_warranty_days_snapshot", 0)',
       )},
           "warranty_until" = ${untilFrom(
             toCode(
               'COALESCE(line."warranty_months_snapshot", 0)',
               'COALESCE(line."checking_warranty_days_snapshot", 0)',
             ),
             `(sale.completed_at AT TIME ZONE 'Asia/Colombo')::date`,
           )}
       FROM "sales" AS sale
       WHERE sale.id = line.sale_id
         AND sale.status <> 'DRAFT'`,
    );
    // Safety net: nothing may stay without a period.
    await queryRunner.query(
      `UPDATE "sale_lines" SET "warranty" = 'CHECKING' WHERE "warranty" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       ALTER COLUMN "warranty" SET NOT NULL,
       ADD CONSTRAINT "CHK_sale_lines_warranty"
       CHECK ("warranty" IN (${CODES}))`,
    );

    // 3. Drop what the codes replace.
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       DROP COLUMN "warranty_months_snapshot",
       DROP COLUMN "checking_warranty_days_snapshot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products"
       DROP CONSTRAINT "CHK_products_warranty_months_nonneg",
       DROP CONSTRAINT "CHK_products_checking_warranty_days_nonneg",
       DROP COLUMN "warranty_months",
       DROP COLUMN "checking_warranty_days"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Products: the old numbers back, from the code.
    await queryRunner.query(
      `ALTER TABLE "products"
       ADD COLUMN "warranty_months" integer NOT NULL DEFAULT 0,
       ADD COLUMN "checking_warranty_days" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `UPDATE "products"
       SET "warranty_months" = ${monthsOf('"default_warranty"')},
           "checking_warranty_days" = ${daysOf('"default_warranty"')}`,
    );
    await queryRunner.query(
      `ALTER TABLE "products"
       ADD CONSTRAINT "CHK_products_warranty_months_nonneg" CHECK ("warranty_months" >= 0),
       ADD CONSTRAINT "CHK_products_checking_warranty_days_nonneg"
         CHECK ("checking_warranty_days" >= 0)`,
    );

    // Sale lines: #32's snapshot back for completed / voided lines.
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       ADD COLUMN "warranty_months_snapshot" integer NULL,
       ADD COLUMN "checking_warranty_days_snapshot" integer NULL`,
    );
    await queryRunner.query(
      `UPDATE "sale_lines" AS line
       SET "warranty_months_snapshot" = ${monthsOf('line."warranty"')},
           "checking_warranty_days_snapshot" = ${daysOf('line."warranty"')}
       FROM "sales" AS sale
       WHERE sale.id = line.sale_id
         AND sale.status <> 'DRAFT'`,
    );

    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       DROP CONSTRAINT "CHK_sale_lines_warranty",
       DROP COLUMN "warranty_until",
       DROP COLUMN "warranty"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products"
       DROP CONSTRAINT "CHK_products_default_warranty",
       DROP COLUMN "default_warranty"`,
    );
  }
}
