import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PosTerminal from ".";
import {
  authState,
  branchesState,
  renderWithProviders,
} from "../../test/renderWithProviders";
import { cashierUser, mainShop } from "../../test/fixtures";
import { draftSale, saleLine } from "../../test/posFixtures";
import useTerminalSessionStore from "../../store/zustand/terminalSessionStore";
import * as salesService from "../../services/salesService";
import * as stockService from "../../services/stockService";

vi.mock("../../services/salesService");
vi.mock("../../services/stockService");
vi.mock("../../services/productsService");

const lines = [
  saleLine({ quantity: 2, line_total: "3000.00" }),
  saleLine({ id: "line-2", line_number: 2, product_id: "p-glass", product_name_snapshot: "Tempered Glass", line_total: "990.00", unit_price: "990.00" }),
];

const renderTerminal = async () => {
  const utils = renderWithProviders(<PosTerminal />, {
    preloadedState: { auth: authState(cashierUser), branches: branchesState([mainShop]) },
  });
  await screen.findByRole("list", { name: "Cart" });
  return utils;
};

const scanBar = () => screen.getByRole("combobox", { name: /scan barcode or search/i });
const row = (name) => screen.getByRole("listitem", { name });

beforeEach(() => {
  vi.resetAllMocks();
  useTerminalSessionStore.getState().clear();
  stockService.listStock.mockResolvedValue([]);
  salesService.createSale.mockResolvedValue(draftSale({ lines }));
  salesService.updateSaleLine.mockResolvedValue(draftSale({ lines }));
  salesService.removeSaleLine.mockResolvedValue();
  salesService.getSale.mockResolvedValue(draftSale({ lines: [lines[1]] }));
});

describe("PosTerminal hotkeys and focus", () => {
  it("F2 focuses the scan bar from anywhere, including another input", async () => {
    const user = userEvent.setup();
    await renderTerminal();

    row("USB-C Cable 1m").focus();
    await user.keyboard("[F2]"); // by code: user-event's key map has no F-keys
    expect(scanBar()).toHaveFocus();

    within(row("USB-C Cable 1m")).getByLabelText(/quantity for/i).focus();
    await user.keyboard("[F2]"); // by code: user-event's key map has no F-keys
    expect(scanBar()).toHaveFocus();
  });

  it("Esc on the terminal returns focus to the scan bar", async () => {
    const user = userEvent.setup();
    await renderTerminal();

    row("Tempered Glass").focus();
    await user.keyboard("{Escape}");
    expect(scanBar()).toHaveFocus();
  });

  it("hands focus back to the scan bar after a qty edit commits with Enter", async () => {
    const user = userEvent.setup();
    await renderTerminal();

    const qty = within(row("USB-C Cable 1m")).getByLabelText(/quantity for/i);
    await user.clear(qty);
    await user.type(qty, "4{Enter}");

    await waitFor(() => expect(salesService.updateSaleLine).toHaveBeenCalledWith("sale-1", "line-1", { quantity: 4 }));
    expect(scanBar()).toHaveFocus();
  });

  it("hands focus back to the scan bar after deleting a line", async () => {
    const user = userEvent.setup();
    await renderTerminal();

    await user.click(screen.getByRole("button", { name: /remove usb-c cable/i }));

    await waitFor(() => expect(screen.queryByRole("listitem", { name: "USB-C Cable 1m" })).not.toBeInTheDocument());
    expect(scanBar()).toHaveFocus();
  });

  it("keeps focus on the stepper so repeated + presses work", async () => {
    const user = userEvent.setup();
    await renderTerminal();

    const plus = within(row("USB-C Cable 1m")).getByRole("button", { name: /increase/i });
    await user.click(plus);
    await waitFor(() => expect(plus).not.toBeDisabled());
    expect(plus).toHaveFocus();
  });
});
