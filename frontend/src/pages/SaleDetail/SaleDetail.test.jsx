import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import SaleDetail from ".";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { cashierUser, mainShop } from "../../test/fixtures";
import { saleEntity, voidedSaleEntity } from "../../test/saleEntities";
import { branchStockResponse, saleWithReturnsEntity } from "../../test/returnEntities";
import { approversResponse } from "../../test/voidEntities";
import * as approvalsService from "../../services/approvalsService";
import * as salesService from "../../services/salesService";
import * as stockService from "../../services/stockService";

vi.mock("../../services/approvalsService");
vi.mock("../../services/salesService");
vi.mock("../../services/stockService");

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

describe("SaleDetail: Return items (P7-16)", () => {
  const returnButton = () => screen.getByRole("button", { name: "Return items" });
  const returnDialog = () => screen.queryByRole("dialog", { name: /^Return items/ });

  beforeEach(() => {
    stockService.listStock.mockResolvedValue(branchStockResponse());
  });

  it("a cashier gets the button on a completed sale; it opens the dialog", async () => {
    salesService.getSale.mockResolvedValue(saleEntity());
    const user = userEvent.setup();
    renderDetail();
    await heading();

    expect(returnButton()).toBeEnabled();
    expect(returnButton()).toHaveAttribute("title", "Return items (R)");
    await user.click(returnButton());

    expect(await screen.findByRole("dialog", { name: /^Return items · INV-20261021-0007/ })).toBeInTheDocument();
  });

  it("R opens it; Alt+R does not (the terminal's Recent sales key)", async () => {
    salesService.getSale.mockResolvedValue(saleEntity());
    const user = userEvent.setup();
    renderDetail();
    await heading();

    await user.keyboard("{Alt>}r{/Alt}");
    expect(returnDialog()).not.toBeInTheDocument();

    await user.keyboard("r");
    expect(await screen.findByRole("dialog", { name: /^Return items/ })).toBeInTheDocument();
  });

  it("R is ignored while another dialog is open", async () => {
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

    await user.keyboard("r");

    expect(returnDialog()).not.toBeInTheDocument();
    expect(stockService.listStock).not.toHaveBeenCalled();
  });

  it("everything returned: the button stays, disabled, and R does nothing", async () => {
    const sale = saleWithReturnsEntity();
    sale.lines = sale.lines.map((line) => ({ ...line, returned_quantity: line.quantity }));
    salesService.getSale.mockResolvedValue(sale);
    const user = userEvent.setup();
    renderDetail();
    await heading();

    expect(returnButton()).toBeDisabled();
    expect(returnButton()).toHaveAttribute("title", "Everything on this sale has been returned");
    await user.keyboard("r");
    expect(returnDialog()).not.toBeInTheDocument();
  });

  it("a voided sale has no Return items", async () => {
    salesService.getSale.mockResolvedValue(voidedSaleEntity());
    const user = userEvent.setup();
    renderDetail();
    await heading();

    expect(screen.queryByRole("button", { name: "Return items" })).not.toBeInTheDocument();
    await user.keyboard("r");
    expect(returnDialog()).not.toBeInTheDocument();
  });

  /** Return the phone (within warranty: no override) with the manager's PIN. */
  const returnPhone = async (user) => {
    await user.click(returnButton());
    const dialog = await screen.findByRole("dialog", { name: /^Return items/ });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Next: refund" })).toBeEnabled());
    await user.click(within(dialog).getByRole("button", { name: "More Samsung Galaxy A15 128GB" }));
    await user.click(within(dialog).getByRole("button", { name: "Next: refund" }));
    await within(dialog).findByRole("option", { name: "Asha Perera" });
    // The sale was partly paid by card: its row is there, waiting for the reversal's reference
    await user.type(within(within(dialog).getByTestId("refund-row-pay-card")).getByLabelText("Reversal reference"), "REV-1");
    await user.click(within(dialog).getByRole("radio", { name: "Faulty item" }));
    await user.selectOptions(within(dialog).getByLabelText("Approver"), "user-manager");
    await user.type(within(dialog).getByLabelText("Approval PIN"), "482915");
    await user.click(within(dialog).getByRole("button", { name: "Return items" }));
    await within(dialog).findByTestId("return-recorded");
    return dialog;
  };

  it("after a return: the page shows the answered sale; Done hands focus back to Return items", async () => {
    salesService.getSale.mockResolvedValue(saleEntity());
    const answered = saleWithReturnsEntity(); // the case and charger are still left
    salesService.createReturn.mockResolvedValue({ return_id: "ret-1", sale: answered, resent: false });
    approvalsService.listApprovers.mockResolvedValue(approversResponse());
    const user = userEvent.setup();
    renderDetail();
    await heading();

    const dialog = await returnPhone(user);
    await user.click(within(dialog).getByRole("button", { name: "Done" }));

    await waitFor(() => expect(returnDialog()).not.toBeInTheDocument());
    await waitFor(() => expect(returnButton()).toHaveFocus());
    expect(returnButton()).toBeEnabled();
    expect(salesService.getSale).toHaveBeenCalledTimes(1); // the page load: the answer is shown as is
  });

  it("after a return on the page: the Items and Returns tabs appear, Void gives way to the note", async () => {
    salesService.getSale.mockResolvedValue(saleEntity());
    salesService.createReturn.mockResolvedValue({ return_id: "ret-1", sale: saleWithReturnsEntity(), resent: false });
    approvalsService.listApprovers.mockResolvedValue(approversResponse());
    const user = userEvent.setup();
    renderDetail();
    await heading();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Void sale" })).toBeInTheDocument();

    const dialog = await returnPhone(user);
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(returnDialog()).not.toBeInTheDocument());

    expect(screen.getByRole("tab", { name: "Items · 5" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Returns · 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
    expect(screen.getByTestId("no-void-note")).toHaveTextContent("Sales with returns can't be voided.");
  });

  it("after a return of everything left: Return items disables itself and focus goes to Reprint", async () => {
    salesService.getSale.mockResolvedValue(saleEntity());
    const answered = saleWithReturnsEntity();
    answered.lines = answered.lines.map((line) => ({ ...line, returned_quantity: line.quantity }));
    salesService.createReturn.mockResolvedValue({ return_id: "ret-1", sale: answered, resent: false });
    approvalsService.listApprovers.mockResolvedValue(approversResponse());
    const user = userEvent.setup();
    renderDetail();
    await heading();

    const dialog = await returnPhone(user);
    await user.keyboard("{Enter}"); // Done has the focus

    await waitFor(() => expect(returnDialog()).not.toBeInTheDocument());
    expect(returnButton()).toBeDisabled();
    await waitFor(() => expect(reprintButton()).toHaveFocus());
    expect(dialog).not.toBeInTheDocument();
  });

  it("Cancel hands focus back to the button", async () => {
    salesService.getSale.mockResolvedValue(saleEntity());
    const user = userEvent.setup();
    renderDetail();
    await heading();
    await user.click(returnButton());
    const dialog = await screen.findByRole("dialog", { name: /^Return items/ });

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(returnDialog()).not.toBeInTheDocument());
    await waitFor(() => expect(returnButton()).toHaveFocus());
  });
});

describe("SaleDetail: a sale with returns (P7-11, P7-18)", () => {
  /** Opened from Recent sales with this search, as the list does. */
  const renderFromSearch = (search) =>
    renderWithProviders(
      <Routes>
        <Route path="/pos/sales/:id" element={<SaleDetail />} />
      </Routes>,
      {
        route: { pathname: "/pos/sales/sale-7", state: { from: { search, pages: 1, activeId: "sale-7" } } },
        preloadedState: { auth: authState(cashierUser), branches: branchesState([mainShop]) },
      },
    );
  const returnsTab = () => screen.getByRole("tab", { name: /^Returns/ });

  it("no Void button: a note says why, and V does nothing", async () => {
    salesService.getSale.mockResolvedValue(saleWithReturnsEntity());
    const user = userEvent.setup();
    renderDetail();
    await heading();

    expect(screen.queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
    expect(screen.getByTestId("no-void-note")).toHaveTextContent("Sales with returns can't be voided.");
    await user.keyboard("v");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on Items by default", async () => {
    salesService.getSale.mockResolvedValue(saleWithReturnsEntity());
    renderDetail();
    await heading();
    expect(screen.getByRole("tab", { name: /^Items/ })).toHaveAttribute("aria-selected", "true");
  });

  it("opens on Returns when it came from a search for one of its RET numbers", async () => {
    salesService.getSale.mockResolvedValue(saleWithReturnsEntity());
    renderFromSearch("?q=ret-20261023-0001");
    await heading();
    expect(returnsTab()).toHaveAttribute("aria-selected", "true");
  });

  it.each([
    ["an invoice search", "?q=INV-20261021"],
    ["a RET number of another sale", "?q=RET-20261099-0001"],
    ["a day list (no search)", "?day=2026-10-21"],
  ])("opens on Items after %s", async (_, search) => {
    salesService.getSale.mockResolvedValue(saleWithReturnsEntity());
    renderFromSearch(search);
    await heading();
    expect(returnsTab()).toHaveAttribute("aria-selected", "false");
  });

  it("Reprint slip re-reads the sale, then prints both copies marked REPRINT", async () => {
    const fresh = saleWithReturnsEntity();
    salesService.getSale.mockResolvedValue(fresh);
    const user = userEvent.setup();
    renderDetail();
    await heading();
    await user.click(returnsTab());

    await user.click(within(screen.getByRole("listitem", { name: "RET-20261023-0001" })).getByRole("button", { name: "Reprint slip" }));

    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
    expect(salesService.getSale).toHaveBeenCalledTimes(2); // the page load + the re-read
    // the shop copy is the last one rendered
    expect(receiptText()).toContain("SHOP COPY");
    expect(receiptText()).toContain("REPRINT · 22 Oct 2026, 11:30");
  });

  it("a failed re-read prints nothing and says so on that return", async () => {
    salesService.getSale.mockResolvedValueOnce(saleWithReturnsEntity()).mockRejectedValueOnce(new Error("Network Error"));
    const user = userEvent.setup();
    renderDetail();
    await heading();
    await user.click(returnsTab());

    const entry = screen.getByRole("listitem", { name: "RET-20261023-0001" });
    await user.click(within(entry).getByRole("button", { name: "Reprint slip" }));

    expect(await within(entry).findByRole("alert")).toHaveTextContent("Couldn't load the sale. Nothing was printed.");
    expect(print).not.toHaveBeenCalled();
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
