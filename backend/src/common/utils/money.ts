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

/** Integer cents → the "1234.50" string Postgres numeric(_,2) columns take. */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * `percent` % of `baseCents`, rounded half-up to whole cents, computed
 * exactly: the percentage (at most 2 decimals, as the DTOs allow) is
 * turned into integer hundredths and the division done in BigInt, so no
 * float ever touches the result. 50% of 4.35 is 2.18, not the float
 * path's 2.17 (FOLLOWUP F3). Non-negative inputs only.
 */
export function percentOfCentsHalfUp(
  baseCents: number,
  percent: string | number,
): number {
  const hundredths = BigInt(Math.round(Number(percent) * 100));
  const numerator = BigInt(baseCents) * hundredths;
  // round half-up: floor((n + d/2) / d) with d = 100% in hundredths
  return Number((numerator + 5000n) / 10000n);
}
