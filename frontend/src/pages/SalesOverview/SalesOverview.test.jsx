import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SalesOverview, { rangeForPeriod } from ".";
import * as salesService from "../../services/salesService";
import { authState, renderWithProviders } from "../../test/renderWithProviders";
import { BRANCH_ID } from "../../test/cashDayEntities";

vi.mock("../../services/salesService", () => ({ getDailySalesSummary: vi.fn() }));

const preloadedState = {
  auth: authState({ id: "cashier-1", role: "cashier", branch_id: BRANCH_ID }),
};

describe("SalesOverview", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    salesService.getDailySalesSummary.mockResolvedValue({
      sales_count: 4,
      sales_amount: "12500.00",
      quantity_count: 7,
      cost_of_sales: "9000.00",
      return_count: 2,
      return_quantity: 3,
      voided_count: 1,
    });
  });

  it("shows summary cards and links to the full sales history", async () => {
    renderWithProviders(<SalesOverview />, { preloadedState, route: "/sales" });

    expect(await screen.findByText("LKR 12,500.00")).toBeInTheDocument();
    expect(screen.getByText("Sales count").parentElement.parentElement).toHaveTextContent("4");
    expect(screen.getByText("Items sold").parentElement.parentElement).toHaveTextContent("7");
    expect(screen.getByText("LKR 9,000.00")).toBeInTheDocument();
    expect(screen.getByText("Return sales count").parentElement.parentElement).toHaveTextContent("2");
    expect(screen.getByText("Return sales quantity").parentElement.parentElement).toHaveTextContent("3");
    expect(screen.getByText("Voided sales count").parentElement.parentElement).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: /See all sales/ })).toHaveAttribute("href", "/sales/history");
    expect(salesService.getDailySalesSummary).toHaveBeenCalledWith(expect.objectContaining({ branchId: BRANCH_ID }));
  });

  it("calculates the requested presets using Colombo calendar dates", () => {
    const today = "2026-10-25"; // Sunday
    expect(rangeForPeriod("yesterday", today)).toEqual({ from: "2026-10-24", to: "2026-10-24" });
    expect(rangeForPeriod("last-3-days", today)).toEqual({ from: "2026-10-23", to: today });
    expect(rangeForPeriod("this-week", today)).toEqual({ from: "2026-10-19", to: today });
    expect(rangeForPeriod("last-week", today)).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(rangeForPeriod("last-2-weeks", today)).toEqual({ from: "2026-10-12", to: today });
    expect(rangeForPeriod("this-month", today)).toEqual({ from: "2026-10-01", to: today });
    expect(rangeForPeriod("last-month", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(rangeForPeriod("last-3-months", today)).toEqual({ from: "2026-07-25", to: today });
    expect(rangeForPeriod("last-6-months", today)).toEqual({ from: "2026-04-25", to: today });
    expect(rangeForPeriod("this-year", today)).toEqual({ from: "2026-01-01", to: today });
    expect(rangeForPeriod("last-year", today)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("lets the date picker select an individual date", async () => {
    renderWithProviders(<SalesOverview />, { preloadedState, route: "/sales?date=2026-10-20" });
    await screen.findByText("LKR 12,500.00");

    fireEvent.change(screen.getByLabelText("Choose sales date"), { target: { value: "2026-10-19" } });
    await waitFor(() => expect(salesService.getDailySalesSummary).toHaveBeenLastCalledWith({
      branchId: BRANCH_ID,
      from: "2026-10-19",
      to: "2026-10-19",
    }));
  });

  it("updates the cards when a period preset is selected", async () => {
    renderWithProviders(<SalesOverview />, { preloadedState, route: "/sales?date=2026-10-20" });
    await screen.findByText("LKR 12,500.00");

    fireEvent.click(screen.getByRole("button", { name: "Selected date" }));
    fireEvent.click(screen.getByRole("option", { name: "Last week" }));
    await waitFor(() => expect(salesService.getDailySalesSummary).toHaveBeenLastCalledWith({
      branchId: BRANCH_ID,
      from: "2026-10-12",
      to: "2026-10-18",
    }));
  });
});
