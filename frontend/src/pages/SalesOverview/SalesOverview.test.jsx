import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SalesOverview from ".";
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
    });
  });

  it("shows daily totals and links to the full sales history", async () => {
    renderWithProviders(<SalesOverview />, { preloadedState, route: "/sales" });

    expect(await screen.findByText("LKR 12,500.00")).toBeInTheDocument();
    expect(screen.getByText("Today’s sales").parentElement.parentElement).toHaveTextContent("4");
    expect(screen.getByText("Items sold").parentElement.parentElement).toHaveTextContent("7");
    expect(screen.getByText("LKR 9,000.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See all sales/ })).toHaveAttribute("href", "/sales/history");
    expect(salesService.getDailySalesSummary).toHaveBeenCalledWith(expect.objectContaining({ branchId: BRANCH_ID }));
  });
});
