import { vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import SaleDetail from ".";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { cashierUser, mainShop } from "../../test/fixtures";
import * as salesService from "../../services/salesService";

vi.mock("../../services/salesService");

const sale = {
  id: "sale-3",
  sale_number: "INV-20261022-0003",
  status: "COMPLETED",
  completed_at: "2026-10-22T04:32:00.000Z",
  total: "1500.00",
};

const Where = () => {
  const location = useLocation();
  return (
    <>
      <p data-testid="where">{location.pathname + location.search}</p>
      <p data-testid="state">{JSON.stringify(location.state)}</p>
    </>
  );
};

const renderDetail = (route) =>
  renderWithProviders(
    <>
      <Where />
      <Routes>
        <Route path="/pos/sales" element={<p>sales list</p>} />
        <Route path="/pos/sales/:id" element={<SaleDetail />} />
      </Routes>
    </>,
    {
      route,
      preloadedState: { auth: authState(cashierUser), branches: branchesState([mainShop]) },
    },
  );

beforeEach(() => {
  vi.resetAllMocks();
});

describe("SaleDetail (minimal, step B)", () => {
  it("loads the sale and shows its number, status, completion time and total", async () => {
    salesService.getSale.mockResolvedValue(sale);
    renderDetail("/pos/sales/sale-3");

    expect(await screen.findByRole("heading", { name: "INV-20261022-0003" })).toBeInTheDocument();
    expect(salesService.getSale).toHaveBeenCalledWith("sale-3");
    expect(screen.getByText("Completed", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByTestId("sale-completed-at")).toHaveTextContent("22 Oct 2026, 10:02");
  });

  it("marks a voided sale", async () => {
    salesService.getSale.mockResolvedValue({ ...sale, status: "VOIDED" });
    renderDetail("/pos/sales/sale-3");

    await screen.findByRole("heading", { name: "INV-20261022-0003" });
    expect(screen.getByText("Voided")).toBeInTheDocument();
  });

  it("says so when the sale doesn't exist (404)", async () => {
    salesService.getSale.mockRejectedValue(
      Object.assign(new Error("Not Found"), { response: { status: 404, data: {} } }),
    );
    renderDetail("/pos/sales/sale-x");

    expect(await screen.findByRole("alert")).toHaveTextContent("This sale no longer exists.");
  });

  it("offers Try again on any other error", async () => {
    salesService.getSale.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue(sale);
    const user = userEvent.setup();
    renderDetail("/pos/sales/sale-3");

    const alert = await screen.findByRole("alert");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "INV-20261022-0003" })).toBeInTheDocument();
  });

  it("Esc goes back to the list it came from, handing back the rows to restore", async () => {
    salesService.getSale.mockResolvedValue(sale);
    const user = userEvent.setup();
    renderDetail({
      pathname: "/pos/sales/sale-3",
      state: { from: { search: "?day=2026-10-20&q=Kamal", pages: 2, activeId: "sale-3" } },
    });
    await screen.findByRole("heading", { name: "INV-20261022-0003" });

    await user.keyboard("{Escape}");

    expect(screen.getByTestId("where")).toHaveTextContent("/pos/sales?day=2026-10-20&q=Kamal");
    expect(JSON.parse(screen.getByTestId("state").textContent)).toEqual({
      restore: { pages: 2, activeId: "sale-3" },
    });
  });

  it("opened directly, Back goes to today's list", async () => {
    salesService.getSale.mockResolvedValue(sale);
    const user = userEvent.setup();
    renderDetail("/pos/sales/sale-3");
    await screen.findByRole("heading", { name: "INV-20261022-0003" });

    await user.click(screen.getByRole("button", { name: "Sales" }));

    expect(screen.getByTestId("where")).toHaveTextContent(/^\/pos\/sales$/);
  });
});
