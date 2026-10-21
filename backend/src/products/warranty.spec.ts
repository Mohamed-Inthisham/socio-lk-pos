import { WarrantyPeriod } from './enums/warranty-period.enum';
import { WARRANTY_LENGTHS, warrantyUntilSql } from './warranty';

describe('warranty periods (P5-18)', () => {
  it('has a length for every period, and none for CHECKING', () => {
    expect(Object.keys(WARRANTY_LENGTHS).sort()).toEqual(
      Object.values(WarrantyPeriod).sort(),
    );
    expect(WARRANTY_LENGTHS[WarrantyPeriod.CHECKING]).toBeNull();
    expect(WARRANTY_LENGTHS[WarrantyPeriod.WEEK_2]).toEqual({ days: 14 });
    expect(WARRANTY_LENGTHS[WarrantyPeriod.MONTH_18]).toEqual({ months: 18 });
  });

  describe('warrantyUntilSql', () => {
    const sql = warrantyUntilSql('base_date');

    it('adds days for weeks', () => {
      expect(sql).toContain("WHEN 'WEEK_1' THEN (base_date) + 7");
      expect(sql).toContain("WHEN 'WEEK_2' THEN (base_date) + 14");
    });

    it('adds calendar months for months, as a date', () => {
      expect(sql).toContain(
        "WHEN 'MONTH_1' THEN ((base_date) + interval '1 months')::date",
      );
      expect(sql).toContain(
        "WHEN 'MONTH_24' THEN ((base_date) + interval '24 months')::date",
      );
    });

    it('gives NULL for CHECKING (no branch for it)', () => {
      expect(sql).not.toContain("'CHECKING'");
      expect(sql.startsWith('CASE warranty ')).toBe(true);
      expect(sql.endsWith(' ELSE NULL END')).toBe(true);
    });

    it('covers every period except CHECKING', () => {
      const branches = sql.match(/WHEN '/g) ?? [];
      expect(branches).toHaveLength(Object.values(WarrantyPeriod).length - 1);
    });
  });
});
