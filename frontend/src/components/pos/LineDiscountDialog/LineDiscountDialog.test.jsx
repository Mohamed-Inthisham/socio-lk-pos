import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LineDiscountDialog from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import { draftSale, saleLine } from "../../../test/posFixtures";
import { resetMutationQueue } from "../../../store/slices/posTerminalSlice";
import useTerminalSessionStore from "../../../store/zustand/terminalSessionStore";
import * as salesService from "../../../services/salesService";

vi.mock("../../../services/salesService");

const httpError = (status, message) =>
  Object.assign(new Error(message), { response: { status, data: { message } } });

// 2 × 200.00
const plainLine = saleLine({ unit_price: "200.00", quantity: 2, line_total: "400.00" });

const renderDialog = (line = plainLine) => {
  const onClose = vi.fn();
  const utils = renderWithProviders(<LineDiscountDialog line={line} onClose={onClose} />, {
    preloadedState: { posTerminal: posTerminalState({ draftSale: draftSale({ lines: [line] }) }) },
  });
  return { ...utils, onClose };
};

const dialog = () => screen.getByRole("dialog", { name: "Discount" });
const field = () => within(dialog()).getByRole("textbox");
const preview = () => screen.getByTestId("discount-preview");
const radio = (name) => within(dialog()).getByRole("radio", { name: new RegExp(name) });

beforeEach(() => {
  vi.resetAllMocks();
  resetMutationQueue();
  useTerminalSessionStore.setState({ lastDiscountMode: null });
});

describe("LineDiscountDialog (P5-20)", () => {
  it("opens on % with the value field focused and empty", async () => {
    renderDialog();

    expect(radio("Percent")).toBeChecked();
    expect(within(dialog()).getByLabelText("Percent off")).toBe(field());
    await waitFor(() => expect(field()).toHaveFocus());
    expect(field()).toHaveValue("");
    expect(within(dialog()).queryByRole("button", { name: "Remove discount" })).not.toBeInTheDocument();
  });

  it("previews a percent live and applies it with Enter", async () => {
    const user = userEvent.setup();
    salesService.updateSaleLine.mockResolvedValue(draftSale({ lines: [plainLine] }));
    const { onClose } = renderDialog();

    await user.type(field(), "20");
    expect(preview()).toHaveTextContent("2 × 200.00 − 20% = 320.00 (−80.00)");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(salesService.updateSaleLine).toHaveBeenCalledWith("sale-1", "line-1", {
      discount_type: "PERCENT",
      discount_value: 20,
    });
  });

  it("switches to Price each with 2 on the mode buttons, then focuses the value", async () => {
    const user = userEvent.setup();
    salesService.updateSaleLine.mockResolvedValue(draftSale({ lines: [plainLine] }));
    renderDialog();

    radio("Percent").focus();
    await user.keyboard("2");

    expect(radio("Price each")).toBeChecked();
    await waitFor(() => expect(within(dialog()).getByLabelText("Price each")).toHaveFocus());
    await user.keyboard("160");
    expect(preview()).toHaveTextContent("2 × 160.00 = 320.00 (−80.00)");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(salesService.updateSaleLine).toHaveBeenCalledWith("sale-1", "line-1", {
        discount_type: "UNIT_PRICE",
        discount_value: 160,
      }),
    );
  });

  it("moves between the modes with the arrow keys", async () => {
    const user = userEvent.setup();
    renderDialog();

    radio("Percent").focus();
    await user.keyboard("{ArrowRight}");
    expect(radio("Price each")).toBeChecked();
    await user.keyboard("1");
    expect(radio("Percent")).toBeChecked();
  });

  it("opens on a line's current discount, with Remove discount", async () => {
    const user = userEvent.setup();
    const discounted = saleLine({
      unit_price: "200.00",
      quantity: 2,
      discount_type: "UNIT_PRICE",
      discount_value: "160.00",
      discount_amount: "80.00",
      line_total: "320.00",
    });
    salesService.updateSaleLine.mockResolvedValue(draftSale({ lines: [plainLine] }));
    const { onClose } = renderDialog(discounted);

    expect(radio("Price each")).toBeChecked();
    expect(field()).toHaveValue("160");
    await user.click(within(dialog()).getByRole("button", { name: "Remove discount" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(salesService.updateSaleLine).toHaveBeenCalledWith("sale-1", "line-1", {
      discount_type: null,
      discount_value: null,
    });
  });

  it("shows errors inline: empty, and a price above the unit price", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.keyboard("{Enter}");
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("Enter the percent off.");

    await user.click(radio("Price each"));
    await user.type(field(), "200.01");
    await user.keyboard("{Enter}");
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(
      "The price each can't be more than the unit price (200.00).",
    );
    expect(salesService.updateSaleLine).not.toHaveBeenCalled();
  });

  it("removes the discount when the price each equals the unit price", async () => {
    const user = userEvent.setup();
    const discounted = saleLine({
      unit_price: "200.00",
      quantity: 2,
      discount_type: "PERCENT",
      discount_value: "10.00",
      discount_amount: "40.00",
      line_total: "360.00",
    });
    salesService.updateSaleLine.mockResolvedValue(draftSale({ lines: [plainLine] }));
    renderDialog(discounted);

    await user.click(radio("Price each"));
    await user.type(field(), "200");
    expect(preview()).toHaveTextContent("No discount");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(salesService.updateSaleLine).toHaveBeenCalledWith("sale-1", "line-1", {
        discount_type: null,
        discount_value: null,
      }),
    );
  });

  it("just closes when a line without a discount gets 0%", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.type(field(), "0");
    await user.keyboard("{Enter}");

    expect(onClose).toHaveBeenCalled();
    expect(salesService.updateSaleLine).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the server's #24 message", async () => {
    const user = userEvent.setup();
    const message =
      "Cannot reduce the sale total below the amount already paid. Remove or reduce payments first.";
    salesService.updateSaleLine.mockRejectedValueOnce(httpError(400, message));
    const { onClose } = renderDialog();

    await user.type(field(), "50");
    await user.keyboard("{Enter}");

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Remove or reduce payments first.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("remembers the last applied mode on this till for the next undiscounted line", async () => {
    const user = userEvent.setup();
    salesService.updateSaleLine.mockResolvedValue(draftSale({ lines: [plainLine] }));
    const { unmount } = renderDialog();

    await user.click(radio("Price each"));
    await user.type(field(), "160");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(salesService.updateSaleLine).toHaveBeenCalled());
    unmount();

    expect(useTerminalSessionStore.getState().lastDiscountMode).toBe("UNIT_PRICE");
    expect(JSON.parse(localStorage.getItem("socio-lk-terminal-session")).state.lastDiscountMode).toBe(
      "UNIT_PRICE",
    );

    renderDialog(saleLine({ id: "line-2", unit_price: "500.00", quantity: 1, line_total: "500.00" }));
    expect(radio("Price each")).toBeChecked();
    expect(field()).toHaveValue("");
  });

  it("opens a line that has a discount on its own mode, whatever was last used", () => {
    useTerminalSessionStore.setState({ lastDiscountMode: "UNIT_PRICE" });

    renderDialog(
      saleLine({
        unit_price: "200.00",
        quantity: 2,
        discount_type: "PERCENT",
        discount_value: "10.00",
        discount_amount: "40.00",
        line_total: "360.00",
      }),
    );

    expect(radio("Percent")).toBeChecked();
    expect(field()).toHaveValue("10");
  });

  it("doesn't change the remembered mode when a discount is removed or fails", async () => {
    const user = userEvent.setup();
    useTerminalSessionStore.setState({ lastDiscountMode: "UNIT_PRICE" });
    salesService.updateSaleLine.mockRejectedValueOnce(httpError(400, "Nope"));
    renderDialog();

    await user.click(radio("Percent"));
    await user.type(field(), "10");
    await user.keyboard("{Enter}");
    await within(dialog()).findByRole("alert");

    expect(useTerminalSessionStore.getState().lastDiscountMode).toBe("UNIT_PRICE");
  });

  it("closes on Esc without saving", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.type(field(), "20");
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
    expect(salesService.updateSaleLine).not.toHaveBeenCalled();
  });
});
