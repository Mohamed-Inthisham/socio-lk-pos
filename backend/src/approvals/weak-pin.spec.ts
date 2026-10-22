import { isWeakPin, PIN_PATTERN } from './weak-pin';

describe('weak-pin (Phase 6.4 P6-15)', () => {
  const REJECTED = [
    // all one digit
    '000000',
    '111111',
    '222222',
    '333333',
    '444444',
    '555555',
    '666666',
    '777777',
    '888888',
    '999999',
    // ascending runs
    '012345',
    '123456',
    '234567',
    '345678',
    '456789',
    // descending runs
    '543210',
    '654321',
    '765432',
    '876543',
    '987654',
  ];

  it('rejects exactly the 20 listed PINs', () => {
    expect(REJECTED).toHaveLength(20);
    for (const pin of REJECTED) {
      expect(isWeakPin(pin)).toBe(true);
    }
  });

  it('rejects no other 6-digit PIN (all 1,000,000 checked)', () => {
    let weak = 0;
    for (let n = 0; n < 1_000_000; n++) {
      if (isWeakPin(String(n).padStart(6, '0'))) weak++;
    }
    expect(weak).toBe(20);
  });

  it('allows near misses and wrap-around runs', () => {
    for (const pin of ['890123', '012346', '135790', '112233', '482916']) {
      expect(isWeakPin(pin)).toBe(false);
    }
  });

  it('PIN_PATTERN accepts only exactly 6 digits', () => {
    expect(PIN_PATTERN.test('482916')).toBe(true);
    for (const bad of ['48291', '4829160', '48291a', ' 482916', '']) {
      expect(PIN_PATTERN.test(bad)).toBe(false);
    }
  });
});
