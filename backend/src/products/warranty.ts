import { WarrantyPeriod } from './enums/warranty-period.enum';

/**
 * How long each warranty period lasts (P5-18). `null` = no warranty after
 * the customer leaves the shop (CHECKING).
 */
export const WARRANTY_LENGTHS: Record<
  WarrantyPeriod,
  { days: number } | { months: number } | null
> = {
  [WarrantyPeriod.CHECKING]: null,
  [WarrantyPeriod.WEEK_1]: { days: 7 },
  [WarrantyPeriod.WEEK_2]: { days: 14 },
  [WarrantyPeriod.MONTH_1]: { months: 1 },
  [WarrantyPeriod.MONTH_2]: { months: 2 },
  [WarrantyPeriod.MONTH_3]: { months: 3 },
  [WarrantyPeriod.MONTH_6]: { months: 6 },
  [WarrantyPeriod.MONTH_12]: { months: 12 },
  [WarrantyPeriod.MONTH_18]: { months: 18 },
  [WarrantyPeriod.MONTH_24]: { months: 24 },
};

/**
 * SQL for the last day of warranty of a sale line, given `baseDate` (an SQL
 * date expression: the completion day). Reads the line's `warranty`
 * column. Days are added as days; months as calendar months, which
 * Postgres clamps to the month's end (31 Jan + 1 month = 28/29 Feb).
 * CHECKING (or anything unknown) gives NULL.
 */
export const warrantyUntilSql = (baseDate: string): string => {
  const whens: string[] = [];
  for (const [code, length] of Object.entries(WARRANTY_LENGTHS)) {
    if (length === null) continue;
    whens.push(
      'days' in length
        ? `WHEN '${code}' THEN (${baseDate}) + ${length.days}`
        : `WHEN '${code}' THEN ((${baseDate}) + interval '${length.months} months')::date`,
    );
  }
  return `CASE warranty ${whens.join(' ')} ELSE NULL END`;
};
