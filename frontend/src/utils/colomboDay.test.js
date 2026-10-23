import {
  colomboDayBounds,
  colomboDaysSince,
  colomboToday,
  formatColomboDayLabel,
  formatColomboTime,
  shiftColomboDay,
} from "./colomboDay";

describe("formatColomboTime", () => {
  it("shows a UTC timestamp in Colombo time, 24-hour", () => {
    expect(formatColomboTime("2026-10-22T09:02:00.000Z")).toBe("14:32");
    expect(formatColomboTime("2026-10-21T18:30:00.000Z")).toBe("00:00");
  });

  it("is empty for no timestamp", () => {
    expect(formatColomboTime(null)).toBe("");
  });
});

describe("formatColomboDayLabel", () => {
  it("names the day itself, without shifting it", () => {
    expect(formatColomboDayLabel("2026-10-22")).toBe("Thu 22 Oct 2026");
    expect(formatColomboDayLabel("2027-01-01")).toBe("Fri 1 Jan 2027");
  });

  it("throws on a bad day", () => {
    expect(() => formatColomboDayLabel("2026-02-30")).toThrow(RangeError);
  });
});

describe("colomboToday", () => {
  it("is still the same day one second before Colombo midnight (18:29:59Z)", () => {
    expect(colomboToday(new Date("2026-10-21T18:29:59.999Z"))).toBe("2026-10-21");
  });

  it("turns over at Colombo midnight (18:30:00Z)", () => {
    expect(colomboToday(new Date("2026-10-21T18:30:00.000Z"))).toBe("2026-10-22");
  });

  it("reads 00:00Z as 05:30 the same day in Colombo", () => {
    expect(colomboToday(new Date("2026-10-21T00:00:00Z"))).toBe("2026-10-21");
  });

  it("turns over a year in Colombo before UTC does", () => {
    expect(colomboToday(new Date("2026-12-31T19:00:00Z"))).toBe("2027-01-01");
  });

  it("defaults to now", () => {
    expect(colomboToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("shiftColomboDay", () => {
  it.each([
    ["2026-10-21", -1, "2026-10-20"],
    ["2026-10-21", 1, "2026-10-22"],
    ["2026-10-31", 1, "2026-11-01"],
    ["2026-11-01", -1, "2026-10-31"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2027-01-01", -1, "2026-12-31"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2027-02-28", 1, "2027-03-01"],
    ["2026-10-21", 0, "2026-10-21"],
    ["2026-10-21", -30, "2026-09-21"],
  ])("%s %+d → %s", (day, delta, expected) => {
    expect(shiftColomboDay(day, delta)).toBe(expected);
  });
});

describe("colomboDaysSince (P7-7)", () => {
  it("counts Colombo dates, not 24-hour spans", () => {
    // 23:50 Colombo on the 23rd is 18:20 UTC
    expect(colomboDaysSince("2026-10-23T18:20:00.000Z", "2026-10-23")).toBe(0);
    expect(colomboDaysSince("2026-10-23T18:20:00.000Z", "2026-10-24")).toBe(1);
    // 00:10 Colombo on the 24th is 18:40 UTC on the 23rd
    expect(colomboDaysSince("2026-10-23T18:40:00.000Z", "2026-10-24")).toBe(0);
  });

  it("across a month end", () => {
    expect(colomboDaysSince("2026-10-25T05:00:00.000Z", "2026-11-02")).toBe(8);
  });
});

describe("colomboDayBounds", () => {
  it("gives the day's start and the next midnight, with +05:30", () => {
    expect(colomboDayBounds("2026-10-21")).toEqual({
      completedFrom: "2026-10-21T00:00:00+05:30",
      completedTo: "2026-10-22T00:00:00+05:30",
    });
  });

  it("crosses a month and a year end", () => {
    expect(colomboDayBounds("2026-12-31")).toEqual({
      completedFrom: "2026-12-31T00:00:00+05:30",
      completedTo: "2027-01-01T00:00:00+05:30",
    });
  });

  it("covers exactly 24 hours", () => {
    const { completedFrom, completedTo } = colomboDayBounds("2028-02-29");
    expect(Date.parse(completedTo) - Date.parse(completedFrom)).toBe(24 * 60 * 60 * 1000);
  });

  it("starts at the instant colomboToday turns over", () => {
    const { completedFrom } = colomboDayBounds("2026-10-22");
    expect(new Date(completedFrom).toISOString()).toBe("2026-10-21T18:30:00.000Z");
    expect(colomboToday(new Date(completedFrom))).toBe("2026-10-22");
    expect(colomboToday(new Date(Date.parse(completedFrom) - 1))).toBe("2026-10-21");
  });
});

describe("invalid days", () => {
  it.each(["", "2026-10-32", "2026-02-29", "2026-13-01", "21-10-2026", "2026-10-21T00:00", null, undefined])(
    "%s throws",
    (day) => {
      expect(() => colomboDayBounds(day)).toThrow(RangeError);
      expect(() => shiftColomboDay(day, 1)).toThrow(RangeError);
    },
  );
});
