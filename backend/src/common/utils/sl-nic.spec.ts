import { isValidSlNic, normalizeSlNic } from './sl-nic';

describe('normalizeSlNic', () => {
  it('trims and uppercases', () => {
    expect(normalizeSlNic(' 901234567v ')).toBe('901234567V');
    expect(normalizeSlNic('199012345678')).toBe('199012345678');
  });

  it('leaves anything that is not a string alone', () => {
    expect(normalizeSlNic(null)).toBeNull();
    expect(normalizeSlNic(undefined)).toBeUndefined();
    expect(normalizeSlNic(901234567)).toBe(901234567);
  });
});

describe('isValidSlNic', () => {
  it.each([
    ['old format, V', '901234567V'],
    ['old format, X', '901234567X'],
    ['old format, lowercase letter', '901234567v'],
    ['new format', '199012345678'],
    ['surrounding spaces', '  199012345678 '],
  ])('accepts %s', (_, nic) => {
    expect(isValidSlNic(nic)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['8 digits + V', '90123456V'],
    ['10 digits + V', '9012345678V'],
    ['9 digits, no letter', '901234567'],
    ['9 digits + another letter', '901234567A'],
    ['11 digits', '19901234567'],
    ['13 digits', '1990123456789'],
    ['12 digits + V', '199012345678V'],
    ['inner spaces', '1990 1234 5678'],
    ['dashes', '199012-345678'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_, nic) => {
    expect(isValidSlNic(nic)).toBe(false);
  });
});
