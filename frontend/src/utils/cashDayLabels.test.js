import { lastClosedLine, shortDayLabel } from "./cashDayLabels";

// formatLKR puts a no-break space (U+00A0) between "LKR" and the amount.
const LKR = `LKR${String.fromCharCode(0xa0)}`;

describe("lastClosedLine (P9-8)", () => {
  it("names yesterday by the server's date, not the till's clock", () => {
    expect(lastClosedLine({ business_date: "2026-10-23", counted_balance: "15400.00" }, "2026-10-24")).toBe(
      `Yesterday closed with ${LKR}15,400.00`,
    );
  });

  it("names any other day, without the year when it is this year", () => {
    expect(lastClosedLine({ business_date: "2026-10-18", counted_balance: "4800.00" }, "2026-10-24")).toBe(
      `Sun 18 Oct closed with ${LKR}4,800.00`,
    );
  });

  it("adds the year for a day in another year", () => {
    expect(lastClosedLine({ business_date: "2025-12-31", counted_balance: "0.00" }, "2026-01-02")).toBe(
      `Wed 31 Dec 2025 closed with ${LKR}0.00`,
    );
  });

  it("is yesterday across a month and a year end", () => {
    expect(lastClosedLine({ business_date: "2025-12-31", counted_balance: "100.00" }, "2026-01-01")).toBe(
      `Yesterday closed with ${LKR}100.00`,
    );
  });

  it("is nothing when no day was ever closed", () => {
    expect(lastClosedLine(null, "2026-10-24")).toBeNull();
  });
});

describe("shortDayLabel", () => {
  it("drops the year only when it matches today's", () => {
    expect(shortDayLabel("2026-10-19", "2026-10-24")).toBe("Mon 19 Oct");
    expect(shortDayLabel("2025-10-19", "2026-10-24")).toBe("Sun 19 Oct 2025");
    expect(shortDayLabel("2026-10-19")).toBe("Mon 19 Oct 2026");
  });
});
