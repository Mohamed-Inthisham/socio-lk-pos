import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CashDays from "./index";
import * as cashDaysService from "../../services/cashDaysService";
import { authState, renderWithProviders } from "../../test/renderWithProviders";
import {
  BRANCH_ID,
  cashDaySummaryEntity,
  closedCashDayEntity,
  pastDaysResponse,
} from "../../test/cashDayEntities";

vi.mock("../../services/cashDaysService", () => ({
  getCashDay: vi.fn(),
  getCashDaySummary: vi.fn(),
  listCashDays: vi.fn(),
}));

const preloadedState = {
  auth: authState({ id: "cashier-1", role: "cashier", branch_id: BRANCH_ID }),
};

describe("CashDays", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cashDaysService.listCashDays.mockResolvedValue(pastDaysResponse());
  });

  it("lists days and their saved headline figures", async () => {
    cashDaysService.listCashDays.mockResolvedValue(pastDaysResponse());
    renderWithProviders(<CashDays />, { preloadedState, route: "/cash-days" });

    expect(await screen.findByRole("heading", { name: "Cash days" })).toBeInTheDocument();
    expect(await screen.findByText("Tue 20 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText(/15,500\.00/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mon 19 Oct 2026/ })).toHaveAttribute(
      "href",
      "/cash-days/day-1019",
    );
    expect(cashDaysService.listCashDays).toHaveBeenCalledWith({ branchId: BRANCH_ID, page: 1, limit: 10, date: undefined });
  });

  it("shows a selected day's saved figures and breakdown", async () => {
    const day = closedCashDayEntity();
    cashDaysService.getCashDay.mockResolvedValue(day);
    cashDaysService.getCashDaySummary.mockResolvedValue(cashDaySummaryEntity({ closed: true }));
    renderWithProviders(
      <Routes>
        <Route path="/cash-days/:id" element={<CashDays />} />
      </Routes>,
      { preloadedState, route: "/cash-days/day-1020" },
    );

    expect(await screen.findByText("Opening")).toBeInTheDocument();
    expect(screen.getByText("Coins short at count")).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Saved closing difference:")).toBeInTheDocument();
    expect(cashDaysService.getCashDay).toHaveBeenCalledWith("day-1020");
    expect(cashDaysService.getCashDaySummary).toHaveBeenCalledWith("day-1020");
  });
});
