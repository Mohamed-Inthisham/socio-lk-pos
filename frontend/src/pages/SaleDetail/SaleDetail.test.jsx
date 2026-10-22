import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import SaleDetail from ".";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { cashierUser, mainShop } from "../../test/fixtures";
import { saleEntity, voidedSaleEntity } from "../../test/saleEntities";
import * as salesService from "../../services/salesService";

vi.mock("../../services/salesService");

// 11:30 on Thu 22 Oct 2026 in Colombo
const NOW = new Date("2026-10-22T06:00:00.000Z");

const Where = () => {
  const location = useLocation();
  return (
    <>
      <p data-testid="where">{location.pathname + location.search}</p>
      <p data-testid="state">{JSON.stringify(location.state)}</p>
    </>
  );
};

const renderDetail = (route = "/pos/sales/sale-7") =>
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

const heading = () => screen.findByRole("heading", { name: "INV-20261021-0007" });
const reprintButton = () => screen.getByRole("button", { name: /Reprint receipt/ });
const receiptText = () => document.getElementById("receipt-root")?.textContent ?? "";

let print;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  print = vi.spyOn(window, "print").mockImplementation(() => {});
});

afterEach(() => {
  print.mockRestore();
  vi.useRealTimers();
});

describe("SaleDetail: loading", () => {
  it("loads the sale by its id and shows the full detail", async () => {
    salesService.getSale.mockResolvedValue(saleEntity());
    renderDetail();

    expect(await heading()).toBeInTheDocument();
    expect(salesService.getSale).toHaveBeenCalledWith("sale-7");
    expect(screen.getByRole("list", { name: "Items" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Tenders" })).toBeInTheDocument();
  });

  it("shows a voided sale with its banner", async () => {
    salesService.getSale.mockResolvedValue(voidedSaleEntity());
    renderDetail();

    await heading();
    expect(screen.getByRole("region", { name: "Voided" })).toHaveTextContent("Approved by Asha Perera");
  });

  it("says so when the sale doesn't exist (404)", async () => {
    salesService.getSale.mockRejectedValue(
      Object.assign(new Error("Not Found"), { response: { status: 404, data: { message: "Sale not found" } } }),
    );
    renderDetail("/pos/sales/sale-x");

    expect(await screen.findByRole("alert")).toHaveTextContent("This sale no longer exists.");
  });

  it("offers Try again on any other error", async () => {
    salesService.getSale.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue(saleEntity());
    const user = userEvent.setup();
    renderDetail();

    const alert = await screen.findByRole("alert");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await heading()).toBeInTheDocument();
  });
});

describe("SaleDetail: Reprint (P6-7)", () => {
  it("the button re-reads the sale, then prints it marked REPRINT with the time printed", async () => {
    salesService.getSale.mockResolvedValue(saleEntity());
    const user = userEvent.setup();
    renderDetail();
    await heading();
    salesService.getSale.mockClear();

    await user.click(reprintButton());

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(salesService.getSale).toHaveBeenCalledWith("sale-7");
    expect(receiptText()).toContain("INV-20261021-0007");
    expect(receiptText()).toContain("REPRINT · 22 Oct 2026, 11:30");
    expect(receiptText()).not.toContain("VOIDED");
  });

  it("P does the same", async () => {
    salesService.getSale.mockResolvedValue(saleEntity());
    const user = userEvent.setup();
    renderDetail();
    await heading();

    await user.keyboard("p");

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(receiptText()).toContain("REPRINT");
  });

  it("a sale voided since the page opened prints VOIDED, and the page shows it voided", async () => {
    salesService.getSale.mockResolvedValueOnce(saleEntity()).mockResolvedValue(voidedSaleEntity());
    const user = userEvent.setup();
    renderDetail();
    await heading();
    expect(screen.queryByRole("region", { name: "Voided" })).not.toBeInTheDocument();

    await user.click(reprintButton());

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(receiptText()).toContain("VOIDED — NOT VALID");
    expect(receiptText()).toContain("REPRINT");
    expect(screen.getByRole("region", { name: "Voided" })).toBeInTheDocument();
  });

  it("prints nothing when the re-read fails, and says so", async () => {
    salesService.getSale.mockResolvedValueOnce(saleEntity()).mockRejectedValue(new Error("Network Error"));
    const user = userEvent.setup();
    renderDetail();
    await heading();

    await user.click(reprintButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the sale. Nothing was printed.");
    expect(print).not.toHaveBeenCalled();
  });

  it("P is ignored while a dialog is open (e.g. the user menu's Approval PIN)", async () => {
    salesService.getSale.mockResolvedValue(saleEntity());
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <div role="dialog" aria-label="Set approval PIN" />
        <Routes>
          <Route path="/pos/sales/:id" element={<SaleDetail />} />
        </Routes>
      </>,
      { route: "/pos/sales/sale-7", preloadedState: { auth: authState(cashierUser), branches: branchesState([mainShop]) } },
    );
    await heading();

    await user.keyboard("p");

    expect(print).not.toHaveBeenCalled();
    expect(salesService.getSale).toHaveBeenCalledTimes(1); // the page load only
  });

  it("V is ignored while another dialog is open (e.g. the user menu's Approval PIN)", async () => {
    salesService.getSale.mockResolvedValue(saleEntity());
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <div role="dialog" aria-label="Set approval PIN" />
        <Routes>
          <Route path="/pos/sales/:id" element={<SaleDetail />} />
        </Routes>
      </>,
      { route: "/pos/sales/sale-7", preloadedState: { auth: authState(cashierUser), branches: branchesState([mainShop]) } },
    );
    await heading();
    expect(screen.getByRole("button", { name: "Void sale" })).toBeEnabled(); // V would open it otherwise

    await user.keyboard("v");

    expect(screen.queryByRole("dialog", { name: /^Void / })).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1); // only the other one
  });

  it("P is ignored while a reprint is still loading", async () => {
    let release;
    salesService.getSale
      .mockResolvedValueOnce(saleEntity())
      .mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const user = userEvent.setup();
    renderDetail();
    await heading();

    await user.keyboard("p");
    await user.keyboard("p");
    release(saleEntity());

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(salesService.getSale).toHaveBeenCalledTimes(2); // the page load + one reprint
  });
});

describe("SaleDetail: back to the list", () => {
  it("Esc goes back to the list it came from, handing back the rows to restore", async () => {
    salesService.getSale.mockResolvedValue(saleEntity());
    const user = userEvent.setup();
    renderDetail({
      pathname: "/pos/sales/sale-7",
      state: { from: { search: "?day=2026-10-20&q=Kamal", pages: 2, activeId: "sale-7" } },
    });
    await heading();

    await user.keyboard("{Escape}");

    expect(screen.getByTestId("where")).toHaveTextContent("/pos/sales?day=2026-10-20&q=Kamal");
    expect(JSON.parse(screen.getByTestId("state").textContent)).toEqual({
      restore: { pages: 2, activeId: "sale-7" },
    });
  });

  it("opened directly, Back goes to today's list", async () => {
    salesService.getSale.mockResolvedValue(saleEntity());
    const user = userEvent.setup();
    renderDetail();
    await heading();

    await user.click(screen.getByRole("button", { name: "Sales" }));

    expect(screen.getByTestId("where")).toHaveTextContent(/^\/pos\/sales$/);
  });
});
