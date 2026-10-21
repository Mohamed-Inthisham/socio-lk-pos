import { cashChange, receiptAmount, receiptDate, receiptDateTime, receiptWarranty } from "./receipt";

describe("receipt formatting (P5-11, P5-18)", () => {
  it("formats amounts with grouping and 2 decimals, no currency", () => {
    expect(receiptAmount("64990")).toBe("64,990.00");
    expect(receiptAmount("1500.5")).toBe("1,500.50");
    expect(receiptAmount(null)).toBe("0.00");
  });

  it("prints the completion time in Colombo, whatever the till's own zone", () => {
    // 09:02 UTC = 14:32 in Colombo (UTC+5:30)
    expect(receiptDateTime("2026-10-21T09:02:00.000Z")).toBe("21 Oct 2026, 14:32");
    // 20:00 UTC on 31 Jan = 01:30 on 1 Feb in Colombo
    expect(receiptDateTime("2026-01-31T20:00:00.000Z")).toBe("01 Feb 2026, 01:30");
    expect(receiptDateTime(null)).toBe("");
  });

  it("prints a date-only value as is, with no zone shift", () => {
    expect(receiptDate("2027-10-21")).toBe("21 Oct 2027");
    expect(receiptDate("2027-02-28T00:00:00.000Z")).toBe("28 Feb 2027");
  });

  it("words a line's warranty with its last day", () => {
    expect(receiptWarranty({ warranty: "MONTH_12", warranty_until: "2027-10-21" })).toBe(
      "Warranty: 12 months (until 21 Oct 2027)",
    );
    expect(receiptWarranty({ warranty: "WEEK_1", warranty_until: "2026-10-28" })).toBe(
      "Warranty: 1 week (until 28 Oct 2026)",
    );
  });

  it("words Checking (and a missing warranty) as checking only", () => {
    const text = "Checking only, no warranty after leaving the shop";
    expect(receiptWarranty({ warranty: "CHECKING", warranty_until: null })).toBe(text);
    expect(receiptWarranty({})).toBe(text);
  });

  it("leaves out the date when there is none yet", () => {
    expect(receiptWarranty({ warranty: "MONTH_6", warranty_until: null })).toBe("Warranty: 6 months");
  });

  it("works out cash change in cents", () => {
    expect(cashChange({ amount: "16990.10", cash_received: "17000.00" })).toBe("9.90");
    expect(cashChange({ amount: "1500.00", cash_received: "1500.00" })).toBe("0.00");
    expect(cashChange({ amount: "100.30", cash_received: "100.00" })).toBe("0.00");
  });
});
