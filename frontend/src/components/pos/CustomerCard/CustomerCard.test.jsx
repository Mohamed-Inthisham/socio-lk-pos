import { vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomerCard from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import { customer, draftSale, tradeInPayment } from "../../../test/posFixtures";
import * as salesService from "../../../services/salesService";

vi.mock("../../../services/salesService");

const renderCard = (sale = draftSale()) => {
  const onAttach = vi.fn();
  const utils = renderWithProviders(<CustomerCard onAttach={onAttach} />, {
    preloadedState: { posTerminal: posTerminalState({ draftSale: sale }) },
  });
  return { ...utils, onAttach };
};

const attachedSale = (overrides = {}) =>
  draftSale({ customer_id: "cust-1", customer: customer(), ...overrides });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CustomerCard", () => {
  it("shows the walk-in state with an Attach customer button", async () => {
    const user = userEvent.setup();
    const { onAttach } = renderCard();

    expect(screen.getByText("Walk-in sale")).toBeInTheDocument();
    expect(screen.getByText("F3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /attach customer/i })).toHaveAttribute("aria-keyshortcuts", "F3");
    expect(screen.queryByRole("button", { name: /detach/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /attach customer/i }));
    expect(onAttach).toHaveBeenCalledTimes(1);
  });

  it("shows the attached customer's name, formatted phone and NIC", async () => {
    const user = userEvent.setup();
    const { onAttach } = renderCard(attachedSale());

    expect(screen.getByTestId("customer-name")).toHaveTextContent("Kamal Perera");
    expect(screen.getByTestId("customer-phone")).toHaveTextContent("077 123 4567");
    expect(screen.getByTestId("customer-nic")).toHaveTextContent("NIC 199012345678");
    expect(screen.queryByText("Walk-in sale")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(onAttach).toHaveBeenCalledTimes(1);
  });

  it("hides the NIC line when the customer has none", () => {
    renderCard(attachedSale({ customer: customer({ nic: null }) }));
    expect(screen.queryByTestId("customer-nic")).not.toBeInTheDocument();
  });

  it("detaches optimistically, back to walk-in", async () => {
    const request = Promise.withResolvers();
    salesService.updateSale.mockReturnValue(request.promise);
    const user = userEvent.setup();
    renderCard(attachedSale());

    await user.click(screen.getByRole("button", { name: "Detach" }));

    expect(screen.getByText("Walk-in sale")).toBeInTheDocument();
    expect(salesService.updateSale).toHaveBeenCalledWith("sale-1", { customer_id: null });
    request.resolve(draftSale());
    await waitFor(() => expect(screen.queryByText(/saving/i)).not.toBeInTheDocument());
  });

  it("restores the customer and shows the error when the detach fails", async () => {
    salesService.updateSale.mockRejectedValue(new Error("Network Error"));
    const user = userEvent.setup();
    renderCard(attachedSale());

    await user.click(screen.getByRole("button", { name: "Detach" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Network Error");
    expect(screen.getByTestId("customer-name")).toHaveTextContent("Kamal Perera");
  });

  it("blocks Detach with a tooltip while a TRADE_IN payment exists", async () => {
    const user = userEvent.setup();
    renderCard(attachedSale({ payments: [tradeInPayment()] }));

    const detach = screen.getByRole("button", { name: "Detach" });
    expect(detach).toHaveAttribute("aria-disabled", "true");
    expect(detach).toHaveAccessibleDescription("Remove TRADE_IN payment first");

    await user.hover(detach);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Remove TRADE_IN payment first");

    await user.click(detach);
    expect(salesService.updateSale).not.toHaveBeenCalled();
    expect(screen.getByTestId("customer-name")).toHaveTextContent("Kamal Perera");
  });
});
