import { formatColomboDateTime, formatColomboDayTime, formatColomboTime } from "./colomboTime";

// U+00A0 (no-break space) and U+202F (narrow no-break space)
const NO_BREAK_SPACES = [String.fromCharCode(0xa0), String.fromCharCode(0x202f)];
const hasNoBreakSpace = (text) => NO_BREAK_SPACES.some((s) => text.includes(s));

describe("formatColomboTime", () => {
  it("shows a UTC timestamp in Colombo time, 12-hour with AM / PM", () => {
    // 09:02 UTC = 2:32 PM in Colombo (UTC+5:30)
    expect(formatColomboTime("2026-10-22T09:02:00.000Z")).toBe("2:32 PM");
    expect(formatColomboTime("2026-10-22T04:30:00.000Z")).toBe("10:00 AM");
  });

  it("reads midnight and noon as 12 AM and 12 PM", () => {
    expect(formatColomboTime("2026-10-21T18:30:00.000Z")).toBe("12:00 AM");
    expect(formatColomboTime("2026-10-21T18:31:00.000Z")).toBe("12:01 AM");
    expect(formatColomboTime("2026-10-22T06:30:00.000Z")).toBe("12:00 PM");
    expect(formatColomboTime("2026-10-22T07:30:00.000Z")).toBe("1:00 PM");
  });

  it("uses a plain space before an uppercase AM / PM: no no-break or narrow no-break space", () => {
    const text = formatColomboTime("2026-10-22T09:02:00.000Z");
    expect(hasNoBreakSpace(text)).toBe(false);
    expect(text).toMatch(/^\d{1,2}:\d\d (AM|PM)$/);
  });

  it("is empty for no timestamp", () => {
    expect(formatColomboTime(null)).toBe("");
  });
});

describe("formatColomboDateTime", () => {
  it("shows the Colombo date and the 12-hour time", () => {
    expect(formatColomboDateTime("2026-10-23T09:05:00.000Z")).toBe("23 Oct 2026, 2:35 PM");
  });

  it("takes the date in Colombo too: 20:00 UTC on 31 Jan is 1:30 AM on 1 Feb", () => {
    expect(formatColomboDateTime("2026-01-31T20:00:00.000Z")).toBe("01 Feb 2026, 1:30 AM");
  });

  it("has no no-break or narrow no-break space", () => {
    expect(hasNoBreakSpace(formatColomboDateTime("2026-10-23T09:05:00.000Z"))).toBe(false);
  });

  it("is empty for no timestamp", () => {
    expect(formatColomboDateTime(undefined)).toBe("");
  });
});

describe("formatColomboDayTime", () => {
  it("shows the Colombo day and month (no year) and the 12-hour time", () => {
    expect(formatColomboDayTime("2026-10-20T09:15:00.000Z")).toBe("20 Oct, 2:45 PM");
    expect(formatColomboDayTime("2026-10-02T03:00:00.000Z")).toBe("2 Oct, 8:30 AM");
    expect(formatColomboDayTime(null)).toBe("");
  });
});
