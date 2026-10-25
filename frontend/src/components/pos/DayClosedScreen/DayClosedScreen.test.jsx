import { screen } from "@testing-library/react";
import DayClosedScreen from "./index";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { closedCashDayEntity } from "../../../test/cashDayEntities";

const LKR = `LKR${String.fromCharCode(0xa0)}`;

describe("DayClosedScreen (P9-14)", () => {
  it("names the day, when and by whom it closed, the count and the difference", () => {
    renderWithProviders(<DayClosedScreen day={closedCashDayEntity()} />);

    expect(screen.getByRole("heading", { name: "Day closed" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByText("Tue 20 Oct 2026 · closed at 6:15 PM by Nimal Silva")).toBeInTheDocument();
    expect(screen.getByTestId("day-closed-screen").textContent).toContain(`Counted${LKR}15,400.00`);
    expect(screen.getByTestId("day-closed-difference").textContent).toBe(`Short ${LKR}100.00`);
  });

  it("links to Recent sales", () => {
    renderWithProviders(<DayClosedScreen day={closedCashDayEntity()} />);
    expect(screen.getByRole("link", { name: "Recent sales" })).toHaveAttribute("href", "/pos/sales");
  });

  it("has no Past days link until step F", () => {
    renderWithProviders(<DayClosedScreen day={closedCashDayEntity()} />);
    expect(screen.queryByRole("button", { name: "Reprint summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Past days" })).not.toBeInTheDocument();
  });

  it("links to Past days when given", () => {
    renderWithProviders(<DayClosedScreen day={closedCashDayEntity()} pastDaysTo="/pos/days" />);
    expect(screen.getByRole("link", { name: "Past days" })).toHaveAttribute("href", "/pos/days");
  });
});
