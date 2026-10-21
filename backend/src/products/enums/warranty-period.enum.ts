/**
 * The warranty periods the shop offers (Phase 6.4 P5-18). One per sale
 * line, chosen at the till; each product has a default from the same list.
 *
 * - CHECKING: the customer checks the item in the shop; there is no
 *   warranty once they leave. Also used for items sold without a
 *   warranty (cables etc.) — there is no separate "no warranty".
 * - WEEK_n: n × 7 days. MONTH_n: n calendar months.
 *
 * Stored as varchar(20) with a CHECK (CHK_products_default_warranty,
 * CHK_sale_lines_warranty); keep the migrations' lists in step.
 */
export enum WarrantyPeriod {
  CHECKING = 'CHECKING',
  WEEK_1 = 'WEEK_1',
  WEEK_2 = 'WEEK_2',
  MONTH_1 = 'MONTH_1',
  MONTH_2 = 'MONTH_2',
  MONTH_3 = 'MONTH_3',
  MONTH_6 = 'MONTH_6',
  MONTH_12 = 'MONTH_12',
  MONTH_18 = 'MONTH_18',
  MONTH_24 = 'MONTH_24',
}
