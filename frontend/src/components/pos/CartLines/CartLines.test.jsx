import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CartLines from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import { draftSale, phoneProduct, saleLine } from "../../../test/posFixtures";
import * as salesService from "../../../services/salesService";
import * as stockService from "../../../services/stockService";

vi.mock("../../../services/salesService");
vi.mock("../../../services/stockService");

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
  stockService.listStock.mockResolvedValue([]);
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

  it("marks steppers aria-disabled (not disabled) while the row is busy, so focus survives", async () => {
    renderCart([cableLine], { busyLineIds: ["line-1"] });
    const plus = within(row(cableLine.product_name_snapshot)).getByRole("button", { name: /increase/i });

    expect(plus).toHaveAttribute("aria-disabled", "true");
    expect(plus).not.toHaveAttribute("disabled");
    await userEvent.setup().click(plus);
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

describe("CartLines stock warning", () => {
  it("shows the badge when the branch has fewer units than the cart needs (summed across lines)", () => {
    const second = saleLine({ id: "line-9", line_number: 9, quantity: 2 });
    renderCart([cableLine, second], {
      stockByProduct: { [cableLine.product_id]: { quantity: 3, manage_stock: true } },
    });

    // 2 + 2 = 4 needed, 3 in stock → both lines of that product warn
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("Only 3 in stock");
  });

  it("shows no badge when stock covers the cart or isn't tracked", () => {
    const { unmount } = renderCart([cableLine], {
      stockByProduct: { [cableLine.product_id]: { quantity: 2, manage_stock: true } },
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    unmount();

    renderCart([cableLine], {
      stockByProduct: { [cableLine.product_id]: { quantity: 0, manage_stock: false } },
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a muted ? when the stock lookup failed", () => {
    renderCart([cableLine], { stockErrors: { [cableLine.product_id]: true } });

    const unknown = screen.getByRole("status", { name: /stock lookup failed/i });
    expect(unknown).toHaveTextContent("?");
    expect(unknown).toHaveAttribute("title", "Stock lookup failed, try reloading");
  });

  it("highlights the line a refused complete points at (P5-8)", () => {
    renderCart([cableLine, phoneLine], {
      completeError: {
        kind: "unit_sold",
        message: "Cannot sell IMEI '356938035643809'",
        status: 409,
        reconcile: false,
        imei: "356938035643809",
        sale_line_id: "line-2",
      },
    });

    const phone = row(phoneProduct.name);
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveClass("ring-red-500");
    expect(within(phone).getByText("Sold on another sale")).toBeInTheDocument();

    const cable = row("USB-C Cable 1m");
    expect(cable).not.toHaveAttribute("aria-invalid");
    expect(within(cable).queryByText("Sold on another sale")).not.toBeInTheDocument();
  });

  describe("warranty select (P5-18)", () => {
    const warranty = (name) => screen.getByRole("combobox", { name: `Warranty for ${name}` });

    it("shows each line's warranty, with every period on offer, serialized lines too", () => {
      renderCart([
        { ...cableLine, warranty: "CHECKING" },
        { ...phoneLine, warranty: "MONTH_12" },
      ]);

      expect(warranty("USB-C Cable 1m")).toHaveValue("CHECKING");
      expect(warranty(phoneProduct.name)).toHaveValue("MONTH_12");
      expect(
        within(warranty(phoneProduct.name))
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual([
        "Checking",
        "1 week",
        "2 weeks",
        "1 month",
        "2 months",
        "3 months",
        "6 months",
        "12 months",
        "18 months",
        "24 months",
      ]);
    });

    it("changing it PATCHes the line's warranty", async () => {
      const user = userEvent.setup();
      salesService.updateSaleLine.mockResolvedValue(draftSale({ lines: [{ ...cableLine, warranty: "WEEK_2" }] }));
      const { store } = renderCart([{ ...cableLine, warranty: "CHECKING" }]);

      await user.selectOptions(warranty("USB-C Cable 1m"), "2 weeks");

      await waitFor(() =>
        expect(salesService.updateSaleLine).toHaveBeenCalledWith("sale-1", "line-1", { warranty: "WEEK_2" }),
      );
      await waitFor(() => expect(warranty("USB-C Cable 1m")).toHaveValue("WEEK_2"));
      expect(store.getState().posTerminal.busyLineIds).toEqual([]);
    });

    it("arrowing through periods saves only the final one, once, after a pause", async () => {
      const user = userEvent.setup();
      salesService.updateSaleLine.mockResolvedValue(draftSale({ lines: [{ ...cableLine, warranty: "MONTH_1" }] }));
      const { store } = renderCart([{ ...cableLine, warranty: "CHECKING" }]);
      const select = warranty("USB-C Cable 1m");

      // Like ↓ ↓ ↓ on a closed select: one change per press
      await user.selectOptions(select, "1 week");
      await user.selectOptions(select, "2 weeks");
      await user.selectOptions(select, "1 month");

      // Shown at once, not saved yet, row not dimmed
      expect(select).toHaveValue("MONTH_1");
      expect(salesService.updateSaleLine).not.toHaveBeenCalled();
      expect(store.getState().posTerminal.busyLineIds).toEqual([]);

      await waitFor(() => expect(salesService.updateSaleLine).toHaveBeenCalledTimes(1));
      expect(salesService.updateSaleLine).toHaveBeenCalledWith("sale-1", "line-1", { warranty: "MONTH_1" });
      await waitFor(() => expect(store.getState().posTerminal.busyLineIds).toEqual([]));
      expect(select).toHaveValue("MONTH_1");
    });

    it("going back to the saved value before the pause sends nothing", async () => {
      const user = userEvent.setup();
      renderCart([{ ...cableLine, warranty: "CHECKING" }]);
      const select = warranty("USB-C Cable 1m");

      await user.selectOptions(select, "1 week");
      await user.selectOptions(select, "Checking");
      await new Promise((r) => setTimeout(r, 600));

      expect(salesService.updateSaleLine).not.toHaveBeenCalled();
      expect(select).toHaveValue("CHECKING");
    });

    it("a failed save shows the line's saved warranty again", async () => {
      const user = userEvent.setup();
      salesService.updateSaleLine.mockRejectedValue(
        Object.assign(new Error("Network Error"), { response: undefined }),
      );
      renderCart([{ ...cableLine, warranty: "CHECKING" }]);
      const select = warranty("USB-C Cable 1m");

      await user.selectOptions(select, "12 months");

      await waitFor(() => expect(salesService.updateSaleLine).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(select).toHaveValue("CHECKING"));
    });

    it("ignores a change while the line is busy, keeping focus in the select", async () => {
      const user = userEvent.setup();
      renderCart([{ ...cableLine, warranty: "CHECKING" }], { busyLineIds: ["line-1"] });

      const select = warranty("USB-C Cable 1m");
      expect(select).toBeEnabled();
      expect(select).toHaveAttribute("aria-disabled", "true");
      await user.selectOptions(select, "12 months");

      expect(salesService.updateSaleLine).not.toHaveBeenCalled();
      expect(select).toHaveValue("CHECKING");
    });

    it("a pending row shows the product's default, disabled", () => {
      renderCart([], {
        pendingLines: [
          {
            id: "pending-1",
            product_id: "p-x",
            product_name_snapshot: "Pending Item",
            quantity: 1,
            unit_price: "100.00",
            imei_snapshot: null,
            line_total: null,
            warranty: "MONTH_6",
          },
        ],
      });

      expect(warranty("Pending Item")).toHaveValue("MONTH_6");
      expect(warranty("Pending Item")).toBeDisabled();
    });

    it("+ and - in the select don't change the quantity", async () => {
      const user = userEvent.setup();
      renderCart([{ ...cableLine, warranty: "CHECKING" }]);

      warranty("USB-C Cable 1m").focus();
      await user.keyboard("+-");

      expect(salesService.updateSaleLine).not.toHaveBeenCalled();
    });
  });
});
