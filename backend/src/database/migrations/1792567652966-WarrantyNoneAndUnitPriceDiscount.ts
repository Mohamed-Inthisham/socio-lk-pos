import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6.4 P5-19 / P5-20.
 *
 * P5-19 — NO_WARRANTY: a new warranty code, "sold without any warranty",
 * listed first. It becomes the column default for NEW products only;
 * existing products and sale lines keep their codes (no data change).
 *
 * P5-20 — UNIT_PRICE: a new line discount type whose discount_value is the
 * final price per unit (0 to unit_price), so the discount follows the
 * quantity. CHK_sale_lines_discount_unit_price_range bounds the value.
 *
 * Codes are repeated here (not imported) because a migration must not
 * depend on app code.
 *
 * down() turns UNIT_PRICE lines into AMOUNT lines with the same
 * discount_amount (the money is unchanged), and NO_WARRANTY back into
 * CHECKING (the nearest old code: no warranty after leaving the shop).
 */

const OLD_CODES = `'CHECKING', 'WEEK_1', 'WEEK_2', 'MONTH_1', 'MONTH_2', 'MONTH_3', 'MONTH_6', 'MONTH_12', 'MONTH_18', 'MONTH_24'`;
const NEW_CODES = `'NO_WARRANTY', ${OLD_CODES}`;

export class WarrantyNoneAndUnitPriceDiscount1792567652966 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // P5-19: NO_WARRANTY allowed, and the default for new products.
    await queryRunner.query(
      `ALTER TABLE "products"
       DROP CONSTRAINT "CHK_products_default_warranty",
       ADD CONSTRAINT "CHK_products_default_warranty"
         CHECK ("default_warranty" IN (${NEW_CODES})),
       ALTER COLUMN "default_warranty" SET DEFAULT 'NO_WARRANTY'`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       DROP CONSTRAINT "CHK_sale_lines_warranty",
       ADD CONSTRAINT "CHK_sale_lines_warranty"
         CHECK ("warranty" IN (${NEW_CODES}))`,
    );

    // P5-20: the UNIT_PRICE discount type and its range.
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       DROP CONSTRAINT "CHK_sale_lines_discount_type",
       ADD CONSTRAINT "CHK_sale_lines_discount_type"
         CHECK (discount_type IS NULL OR discount_type IN ('AMOUNT', 'PERCENT', 'UNIT_PRICE')),
       ADD CONSTRAINT "CHK_sale_lines_discount_unit_price_range"
         CHECK (discount_type != 'UNIT_PRICE' OR (discount_value >= 0 AND discount_value <= unit_price))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // UNIT_PRICE lines → AMOUNT lines with the same money off.
    await queryRunner.query(
      `UPDATE "sale_lines"
       SET "discount_type" = 'AMOUNT', "discount_value" = "discount_amount"
       WHERE "discount_type" = 'UNIT_PRICE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       DROP CONSTRAINT "CHK_sale_lines_discount_unit_price_range",
       DROP CONSTRAINT "CHK_sale_lines_discount_type",
       ADD CONSTRAINT "CHK_sale_lines_discount_type"
         CHECK (discount_type IS NULL OR discount_type IN ('AMOUNT', 'PERCENT'))`,
    );

    // NO_WARRANTY → CHECKING.
    await queryRunner.query(
      `UPDATE "sale_lines" SET "warranty" = 'CHECKING' WHERE "warranty" = 'NO_WARRANTY'`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_lines"
       DROP CONSTRAINT "CHK_sale_lines_warranty",
       ADD CONSTRAINT "CHK_sale_lines_warranty"
         CHECK ("warranty" IN (${OLD_CODES}))`,
    );
    await queryRunner.query(
      `UPDATE "products" SET "default_warranty" = 'CHECKING'
       WHERE "default_warranty" = 'NO_WARRANTY'`,
    );
    await queryRunner.query(
      `ALTER TABLE "products"
       ALTER COLUMN "default_warranty" SET DEFAULT 'CHECKING',
       DROP CONSTRAINT "CHK_products_default_warranty",
       ADD CONSTRAINT "CHK_products_default_warranty"
         CHECK ("default_warranty" IN (${OLD_CODES}))`,
    );
  }
}
