import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import DayGate from "./index";
import PosTerminal from "../../../pages/PosTerminal";
import SaleDetail from "../../../pages/SaleDetail";
import useTerminalSessionStore from "../../../store/zustand/terminalSessionStore";
import { resetMutationQueue } from "../../../store/slices/posTerminalSlice";
import { authState, branchesState, renderWithProviders } from "../../../test/renderWithProviders";
import { mainShop } from "../../../test/fixtures";
import { managerSessionUser } from "../../../test/authEntities";
import { draftSale, saleLine } from "../../../test/posFixtures";
import { saleEntity } from "../../../test/saleEntities";
import { approversResponse } from "../../../test/voidEntities";
import {
  closedCashDayEntity,
  currentCashDayResponse,
  dayClosedError,
  dayNotOpenError,
  openCashDayEntity,
} from "../../../test/cashDayEntities";
import * as cashDaysService from "../../../services/cashDaysService";
import * as salesService from "../../../services/salesService";
import * as stockService from "../../../services/stockService";
import * as approvalsService from "../../../services/approvalsService";
import * as customersService from "../../../services/customersService";

vi.mock("../../../services/cashDaysService");
vi.mock("../../../services/salesService");
vi.mock("../../../services/stockService");
vi.mock("../../../services/approvalsService");
vi.mock("../../../services/customersService");

/**
 * The till and the sale detail inside the real day gate, as TerminalLayout
 * mounts them (P9 step D): a complete or void refused DAY_NOT_OPEN /
 * DAY_CLOSED says why in its dialog; once it is closed the gate re-reads
 * and the terminal moves on, with focus on the new screen.
 */

const todayOpen = () => currentCashDayResponse({ today: openCashDayEntity() });
const todayClosed = () => currentCashDayResponse({ today: closedCashDayEntity() });
const noDay = () => currentCashDayResponse();

const cash = { id: "pay-1", payment_method: "CASH", amount: "1500.00", cash_received: "2000.00", reference_number: null };
const paidSale = () =>
  draftSale({
    lines: [saleLine({ quantity: 1, line_total: "1500.00" })],
    subtotal: "1500.00",
    total: "1500.00",
    amount_paid: "1500.00",
    change_due: "500.00",
    payments: [cash],
  });

const renderTerminal = (route) =>
  renderWithProviders(
    <main>
      <DayGate>
        <Routes>
          <Route path="/pos" element={<PosTerminal />} />
          <Route path="/pos/sales/:id" element={<SaleDetail />} />
        </Routes>
      </DayGate>
    </main>,
    { route, preloadedState: { auth: authState(managerSessionUser()), branches: branchesState([mainShop]) } },
  );

const completeDialog = () => screen.getByRole("dialog", { name: "Complete this sale?" });

/** The till on a paid cart; F9, Enter; resolves once the refusal shows. */
const refuseComplete = async (user, error) => {
  salesService.completeSale.mockRejectedValueOnce(error);
  renderTerminal("/pos");
  await screen.findByRole("list", { name: "Cart" });
  await user.keyboard("[F9]");
  const dialog = await screen.findByRole("dialog", { name: "Complete this sale?" });
  await waitFor(() => expect(within(dialog).queryByText("Checking stock…")).not.toBeInTheDocument());
  await waitFor(() => expect(within(dialog).getByRole("button", { name: /Complete sale/ })).toHaveFocus());
  await user.keyboard("{Enter}");
  await within(completeDialog()).findByRole("alert");
};

beforeEach(() => {
  vi.resetAllMocks();
  resetMutationQueue();
  useTerminalSessionStore.getState().clear();
  salesService.createSale.mockResolvedValue(paidSale());
  stockService.listStock.mockResolvedValue([
    { product_id: "p-cable", branch_id: "branch-main", quantity: 10, manage_stock: true },
  ]);
  customersService.listCustomers.mockResolvedValue({ data: [], meta: {} });
  approvalsService.listApprovers.mockResolvedValue(approversResponse());
});

describe("a refused complete on the till (P9-9)", () => {
  it("DAY_CLOSED: the till stays until Close; then the Day closed screen, its heading focused; the draft is kept", async () => {
    const user = userEvent.setup();
    cashDaysService.getCurrentCashDay.mockResolvedValueOnce(todayOpen()).mockResolvedValue(todayClosed());
    await refuseComplete(user, dayClosedError());

    // The message first: the till is still there, the gate not read again.
    expect(screen.getByRole("list", { name: "Cart" })).toBeInTheDocument();
    expect(cashDaysService.getCurrentCashDay).toHaveBeenCalledTimes(1);

    await user.click(within(completeDialog()).getByRole("button", { name: "Close" }));

    const heading = await screen.findByRole("heading", { name: "Day closed" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByRole("list", { name: "Cart" })).not.toBeInTheDocument();
    expect(cashDaysService.getCurrentCashDay).toHaveBeenCalledTimes(2);
    expect(useTerminalSessionStore.getState().draftSaleId).toBe("sale-1");
    expect(salesService.discardSale).not.toHaveBeenCalled();
  });

  it("DAY_NOT_OPEN: Close shows the opening, its amount focused; after the opening the same paid cart is back", async () => {
    const user = userEvent.setup();
    cashDaysService.getCurrentCashDay.mockResolvedValueOnce(todayOpen()).mockResolvedValueOnce(noDay());
    await refuseComplete(user, dayNotOpenError());

    await user.click(within(completeDialog()).getByRole("button", { name: "Close" }));

    const amount = await screen.findByLabelText("Cash in the box");
    await waitFor(() => expect(amount).toHaveFocus());
    expect(screen.queryByRole("list", { name: "Cart" })).not.toBeInTheDocument();

    // The opening: the till mounts again and reloads the stored draft.
    cashDaysService.openCashDay.mockResolvedValue(openCashDayEntity());
    cashDaysService.getCurrentCashDay.mockResolvedValue(todayOpen());
    salesService.getSale.mockResolvedValue(paidSale());
    await user.type(amount, "5000{Enter}");

    expect(await screen.findByRole("list", { name: "Cart" })).toBeInTheDocument();
    expect(salesService.getSale).toHaveBeenCalledWith("sale-1");
    expect(salesService.createSale).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Complete sale/ })).toBeEnabled();
  });
});

describe("a refused void on the sale detail (P9-9)", () => {
  it("DAY_NOT_OPEN: Close shows the opening instead of the page, its amount focused", async () => {
    const user = userEvent.setup();
    cashDaysService.getCurrentCashDay.mockResolvedValueOnce(todayOpen()).mockResolvedValue(noDay());
    salesService.getSale.mockResolvedValue(saleEntity());
    salesService.voidSale.mockRejectedValueOnce(dayNotOpenError());
    renderTerminal("/pos/sales/sale-7");
    await screen.findByRole("heading", { name: "INV-20261021-0007" });

    await user.click(screen.getByRole("button", { name: "Void sale" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "Asha Perera" });
    await user.click(within(dialog).getByLabelText("Wrong price"));
    await user.selectOptions(within(dialog).getByLabelText("Approver"), "user-manager");
    await user.type(within(dialog).getByLabelText("Approval PIN"), "000000");
    await user.click(within(dialog).getByRole("button", { name: "Void sale" }));
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    const amount = await screen.findByLabelText("Cash in the box");
    await waitFor(() => expect(amount).toHaveFocus());
    expect(screen.queryByRole("heading", { name: "INV-20261021-0007" })).not.toBeInTheDocument();
    expect(salesService.voidSale).toHaveBeenCalledTimes(1);
  });
});
