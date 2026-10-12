import { normalizeSlPhone, isValidSlPhone } from './sl-phone';

describe('normalizeSlPhone', () => {
  describe('valid inputs', () => {
    it('accepts local mobile format (077...)', () => {
      expect(normalizeSlPhone('0771234567')).toBe('0771234567');
    });

    it('normalizes international format (+94...)', () => {
      expect(normalizeSlPhone('+94771234567')).toBe('0771234567');
    });

    it('normalizes international-without-plus (94...)', () => {
      expect(normalizeSlPhone('94771234567')).toBe('0771234567');
    });

    it('accepts landlines (011...)', () => {
      expect(normalizeSlPhone('0112345678')).toBe('0112345678');
    });

    it('strips whitespace, dashes, and parens', () => {
      expect(normalizeSlPhone('077-123 4567')).toBe('0771234567');
      expect(normalizeSlPhone('(077) 123-4567')).toBe('0771234567');
      expect(normalizeSlPhone('+94 77 123 4567')).toBe('0771234567');
    });
  });

  describe('invalid inputs', () => {
    it('rejects empty / null / undefined', () => {
      expect(normalizeSlPhone('')).toBeNull();
      expect(normalizeSlPhone('   ')).toBeNull();
      expect(normalizeSlPhone(null)).toBeNull();
      expect(normalizeSlPhone(undefined)).toBeNull();
    });

    it('rejects too-short numbers', () => {
      expect(normalizeSlPhone('077123456')).toBeNull(); // 9 digits
      expect(normalizeSlPhone('12345')).toBeNull();
    });

    it('rejects too-long numbers', () => {
      expect(normalizeSlPhone('07712345678')).toBeNull(); // 11 digits
    });

    it('rejects numbers not starting with 0', () => {
      expect(normalizeSlPhone('1771234567')).toBeNull();
    });

    it('rejects 00 prefix (nonsensical)', () => {
      expect(normalizeSlPhone('0071234567')).toBeNull();
    });

    it('rejects non-numeric characters after stripping cosmetics', () => {
      expect(normalizeSlPhone('077abc4567')).toBeNull();
    });

    it('does not blindly strip a 94 prefix on wrong-length input', () => {
      // 9412345 is only 7 chars — should NOT be interpreted as 041234...
      expect(normalizeSlPhone('9412345')).toBeNull();
    });
  });
});

describe('isValidSlPhone', () => {
  it('returns true for valid inputs', () => {
    expect(isValidSlPhone('0771234567')).toBe(true);
    expect(isValidSlPhone('+94771234567')).toBe(true);
  });

  it('returns false for invalid inputs', () => {
    expect(isValidSlPhone('')).toBe(false);
    expect(isValidSlPhone(null)).toBe(false);
    expect(isValidSlPhone('12345')).toBe(false);
  });
});
