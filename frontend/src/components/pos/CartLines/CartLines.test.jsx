import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CartLines from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import { draftSale, phoneProduct, saleLine } from "../../../test/posFixtures";
import * as salesService from "../../../services/salesService";

vi.mock("../../../services/salesService");

const cableLine = saleLine({ quantity: 2, line_total: "3000.00" });
const phoneLine = saleLine({
  id: "line-2",
  line_number: 2,
  product_id: phoneProduct.id,
  product_name_snapshot: phoneProduct.name,
  product_sku_snapshot: phoneProduct.sku,
  unit_price: "245000.00",
  line_total: "245000.00",
  imei_snapshot: "356938035643809",
});

const renderCart = (lines = [cableLine, phoneLine], overrides = {}) =>
  renderWithProviders(<CartLines />, {
    preloadedState: { posTerminal: posTerminalState({ draftSale: draftSale({ lines }), ...overrides }) },
  });

const row = (name) => screen.getByRole("listitem", { name });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CartLines", () => {
  it("renders each line with qty, unit price and the server's line total", () => {
    renderCart();

    const cable = row(cableLine.product_name_snapshot);
    expect(within(cable).getByLabelText(/quantity for usb-c cable/i)).toHaveValue("2");
    expect(within(cable).getAllByText(/1,500\.00/).length).toBeGreaterThan(0);
    expect(within(cable).getByText(/3,000\.00/)).toBeInTheDocument();
    expect(within(row(phoneLine.product_name_snapshot)).getAllByText(/245,000\.00/).length).toBeGreaterThan(0);
  });

  it("shows an empty state with no lines", () => {
    renderCart([]);
    expect(screen.getByText("Cart is empty")).toBeInTheDocument();
  });

  it("changes qty with the stepper, the input and the + key on the focused row", async () => {
    salesService.updateSaleLine.mockResolvedValue(draftSale({ lines: [cableLine, phoneLine] }));
    const user = userEvent.setup();
    renderCart();
    const cable = row(cableLine.product_name_snapshot);

    await user.click(within(cable).getByRole("button", { name: /increase/i }));
    await waitFor(() => expect(salesService.updateSaleLine).toHaveBeenLastCalledWith("sale-1", "line-1", { quantity: 3 }));

    const input = within(cable).getByLabelText(/quantity for/i);
    await user.clear(input);
    await user.type(input, "5{Enter}");
    await waitFor(() => expect(salesService.updateSaleLine).toHaveBeenLastCalledWith("sale-1", "line-1", { quantity: 5 }));

    cable.focus();
    await user.keyboard("-");
    await waitFor(() => expect(salesService.updateSaleLine).toHaveBeenLastCalledWith("sale-1", "line-1", { quantity: 1 }));
    expect(salesService.updateSaleLine).toHaveBeenCalledTimes(3);
  });

  it("deletes a line and shows the re-fetched cart", async () => {
    salesService.removeSaleLine.mockResolvedValue();
    salesService.getSale.mockResolvedValue(draftSale({ lines: [phoneLine] }));
    const user = userEvent.setup();
    renderCart();

    await user.click(screen.getByRole("button", { name: /remove usb-c cable/i }));

    await waitFor(() => expect(screen.queryByRole("listitem", { name: cableLine.product_name_snapshot })).not.toBeInTheDocument());
    expect(salesService.removeSaleLine).toHaveBeenCalledWith("sale-1", "line-1");
  });

  it("locks qty at 1 for serialized lines and shows the IMEI", async () => {
    const user = userEvent.setup();
    renderCart();
    const phone = row(phoneLine.product_name_snapshot);

    expect(within(phone).getByText("IMEI 356938035643809")).toBeInTheDocument();
    expect(within(phone).getByLabelText(/quantity for .*: 1, locked/i)).toBeInTheDocument();
    expect(within(phone).queryByRole("button", { name: /increase|decrease/i })).not.toBeInTheDocument();
    expect(within(phone).queryByRole("textbox")).not.toBeInTheDocument();

    phone.focus();
    await user.keyboard("+");
    expect(salesService.updateSaleLine).not.toHaveBeenCalled();
  });

  it("disables controls on a pending (optimistic) row", () => {
    renderCart([], {
      pendingLines: [{ id: "pending-1", product_id: "p-x", product_name_snapshot: "Pending Item", quantity: 1, unit_price: "100.00", imei_snapshot: null, line_total: null }],
    });
    const pending = row("Pending Item");

    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(within(pending).getByRole("button", { name: /remove/i })).toBeDisabled();
    expect(within(pending).getByLabelText("Adding")).toBeInTheDocument();
  });
});
