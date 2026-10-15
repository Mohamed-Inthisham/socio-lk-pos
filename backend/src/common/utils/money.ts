/**
 * Convert a 2-decimal money value to integer cents.
 *
 * Accepts the numeric(_,2) strings TypeORM returns for Postgres money
 * columns and the numbers the DTOs carry (validated to at most 2
 * decimal places). Math.round absorbs the representation error of the
 * float multiply (e.g. 50.2 * 100 = 5020.000000000001), so the result
 * is exact for every such input.
 *
 * Compare and subtract money in cents, never in floats: 100.30 - 50.10
 * is 50.199999... in floats, which is < 50.20.
 */
export function toCents(value: string | number): number {
  return Math.round(Number(value) * 100);
}
