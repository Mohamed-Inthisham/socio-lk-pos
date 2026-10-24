import { render, screen } from "@testing-library/react";
import CashDayFigures from "./index";
import { cashDaySummaryEntity } from "../../../test/cashDayEntities";

// formatLKR puts a no-break space (U+00A0) between "LKR" and the amount.
const LKR = `LKR${String.fromCharCode(0xa0)}`;
const text = (testId) => screen.getByTestId(testId).textContent;

describe("CashDayFigures (P9-11)", () => {
  it("lists the server's figures, then counted and the difference in words", () => {
    render(<CashDayFigures figures={cashDaySummaryEntity()} countedText="15400.00" differenceCents={-10000} />);

    for (const label of ["Opening", "Cash sales", "Cash refunds", "Earlier sales voided (cash back)", "Expected", "Counted", "Difference"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // textContent, not getByText: its normalizer turns the no-break space into a space.
    const all = screen.getByTestId("cash-day-figures").textContent;
    for (const amount of ["5,000.00", "12,000.00", "1,500.00", "0.00"]) expect(all).toContain(`${LKR}${amount}`);
    expect(text("figure-expected")).toBe(`${LKR}15,500.00`);
    expect(text("figure-counted")).toBe(`${LKR}15,400.00`);
    expect(text("figure-difference")).toBe(`Short ${LKR}100.00`);
  });

  it("shows dashes until a count is typed", () => {
    render(<CashDayFigures figures={cashDaySummaryEntity()} countedText={null} differenceCents={NaN} />);
    expect(text("figure-counted")).toBe("—");
    expect(text("figure-difference")).toBe("—");
  });

  it.each([
    [0, "Exact"],
    [50, `Rounding ${LKR}0.50`],
    [150000, `Over ${LKR}1,500.00`],
  ])("difference %i cents reads %s", (cents, words) => {
    render(<CashDayFigures figures={cashDaySummaryEntity()} countedText="15500.00" differenceCents={cents} />);
    expect(text("figure-difference")).toBe(words);
  });

  it("shows a negative expected as it is", () => {
    render(
      <CashDayFigures figures={cashDaySummaryEntity({ expected_balance: "-25.00" })} countedText="0.00" differenceCents={2500} />,
    );
    expect(text("figure-expected")).toBe(`-${LKR}25.00`);
  });
});
