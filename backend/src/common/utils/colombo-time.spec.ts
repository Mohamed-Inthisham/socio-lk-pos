import { formatColomboTime } from './colombo-time';

// U+00A0 (no-break space) and U+202F (narrow no-break space)
const NO_BREAK_SPACES = [
  String.fromCharCode(0xa0),
  String.fromCharCode(0x202f),
];

describe('formatColomboTime', () => {
  it('formats a moment as a 12-hour Colombo time', () => {
    expect(formatColomboTime(new Date('2026-10-22T09:15:00.000Z'))).toBe(
      '2:45 PM',
    );
    expect(formatColomboTime(new Date('2026-10-22T02:05:00.000Z'))).toBe(
      '7:35 AM',
    );
  });

  it('reads midnight and noon as 12 AM and 12 PM', () => {
    expect(formatColomboTime(new Date('2026-10-21T18:30:00.000Z'))).toBe(
      '12:00 AM',
    );
    expect(formatColomboTime(new Date('2026-10-22T06:30:00.000Z'))).toBe(
      '12:00 PM',
    );
  });

  it('uses a plain space before an uppercase AM / PM', () => {
    const text = formatColomboTime(new Date('2026-10-22T09:15:00.000Z'));
    expect(NO_BREAK_SPACES.some((s) => text.includes(s))).toBe(false);
    expect(text).toMatch(/^\d{1,2}:\d\d (AM|PM)$/);
  });
});
