import { toCents } from './money';

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
