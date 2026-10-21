import { fromCents, percentOfCentsHalfUp, toCents } from './money';

describe('toCents', () => {
  it('converts numeric strings from Postgres', () => {
    expect(toCents('100.30')).toBe(10030);
    expect(toCents('0.00')).toBe(0);
    expect(toCents('0')).toBe(0);
    expect(toCents('400')).toBe(40000);
    expect(toCents('9999999999.99')).toBe(999999999999);
  });

  it('converts DTO numbers', () => {
    expect(toCents(50.2)).toBe(5020);
    expect(toCents(0.01)).toBe(1);
    expect(toCents(1765.2)).toBe(176520);
  });

  it('rounds away float multiply error', () => {
    // 1.15 * 100 = 114.99999999999999, 4.35 * 100 = 434.99999999999994
    expect(toCents(1.15)).toBe(115);
    expect(toCents(4.35)).toBe(435);
    expect(toCents(0.29)).toBe(29);
  });

  it.each([
    ['100.30', '50.10', 5020],
    ['2000.00', '1765.20', 23480],
    ['150.60', '50.20', 10040],
  ])(
    'subtracts %s - %s exactly in cents (B1 repro)',
    (total, paid, remaining) => {
      // The float subtraction lands below the exact remainder...
      expect(Number(total) - Number(paid)).toBeLessThan(remaining / 100);
      // ...the cents subtraction does not.
      expect(toCents(total) - toCents(paid)).toBe(remaining);
    },
  );
});

describe('fromCents', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [123450, '1234.50'],
    [999999999999, '9999999999.99'],
    [-250, '-2.50'],
  ])('%i → %s', (cents, text) => {
    expect(fromCents(cents)).toBe(text);
  });
});

describe('percentOfCentsHalfUp (FOLLOWUP F3)', () => {
  it.each([
    // the F3 case: the float path gave 2.17
    [435, 50, 218],
    // 10% of 333.33 = 33.333 → 33.33
    [33333, 10, 3333],
    // 12.5% of 0.20 = 0.025 → 0.03 (half-up)
    [20, 12.5, 3],
    // 33.33% of 100.00 = 33.33
    [10000, 33.33, 3333],
    [10000, 100, 10000],
    [10000, 0, 0],
    // a huge line stays exact (BigInt)
    [999999999999, 99.99, 999899999999],
  ])('%i cents × %s%% = %i cents', (base, percent, expected) => {
    expect(percentOfCentsHalfUp(base, percent)).toBe(expected);
  });
});
