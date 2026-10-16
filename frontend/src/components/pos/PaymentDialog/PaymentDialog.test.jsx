import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaymentDialog from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import { cardPayment, draftSale, saleLine } from "../../../test/posFixtures";
import * as salesService from "../../../services/salesService";

vi.mock("../../../services/salesService");

// Total 2,500.00, nothing paid yet.
const sale = draftSale({
  lines: [saleLine({ quantity: 2, line_total: "2500.00", unit_price: "1250.00" })],
  subtotal: "2500.00",
  total: "2500.00",
  amount_paid: "0.00",
});

const renderDialog = (props = {}) => {
  const onClose = vi.fn();
  const utils = renderWithProviders(<PaymentDialog open onClose={onClose} {...props} />, {
    preloadedState: { posTerminal: posTerminalState({ draftSale: sale }) },
  });
  return { ...utils, onClose };
};

const dialog = () => screen.getByRole("dialog", { name: "Take payment" });
const amount = () => within(dialog()).getByLabelText(/^Amount/);
const cashReceived = () => within(dialog()).queryByLabelText(/^Cash received/);
const reference = () => within(dialog()).queryByLabelText(/^Reference number/);
const method = (name) => within(dialog()).getByRole("radio", { name });
const submit = () => within(dialog()).getByRole("button", { name: "Record payment" });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PaymentDialog", () => {
  it("opens on Cash with the amount set to the balance due and the picker focused", async () => {
    renderDialog();

    expect(await screen.findByRole("dialog", { name: "Take payment" })).toBeInTheDocument();
    expect(within(dialog()).getByTestId("payment-total")).toHaveTextContent("2,500.00");
    expect(within(dialog()).getByTestId("payment-paid")).toHaveTextContent("0.00");
    expect(within(dialog()).getByTestId("payment-balance")).toHaveTextContent("2,500.00");
    expect(method("Cash")).toBeChecked();
    expect(amount()).toHaveValue("2500.00");
    expect(cashReceived()).toBeInTheDocument();
    expect(reference()).not.toBeInTheDocument();
    await waitFor(() => expect(method("Cash")).toHaveFocus());
  });

  it("'2' picks Card and focuses Reference; Shift+Tab reaches Amount", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(method("Cash")).toHaveFocus());

    await user.keyboard("2");

    expect(method("Card")).toBeChecked();
    expect(cashReceived()).not.toBeInTheDocument();
    await waitFor(() => expect(reference()).toHaveFocus());

    await user.tab({ shift: true });
    expect(amount()).toHaveFocus();
  });

  it("'1' picks Cash and focuses Cash received", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(method("Mintpay"));

    await user.keyboard("1");

    expect(method("Cash")).toBeChecked();
    await waitFor(() => expect(cashReceived()).toHaveFocus());
  });

  it("'1' on Cash (already selected) still focuses Cash received", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(method("Cash")).toHaveFocus());

    await user.keyboard("1");

    await waitFor(() => expect(cashReceived()).toHaveFocus());
  });

  it("a click switches method but keeps focus on the picker", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(method("Bank transfer"));

    expect(method("Bank transfer")).toBeChecked();
    expect(reference()).toBeInTheDocument();
    expect(method("Bank transfer")).toHaveFocus();
  });

  it("arrow keys switch method but keep focus on the picker", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(method("Cash")).toHaveFocus());

    await user.keyboard("{ArrowRight}");

    expect(method("Card")).toBeChecked();
    expect(method("Card")).toHaveFocus();
  });

  it("types digits into the amount without switching method", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.clear(amount());
    await user.type(amount(), "1234");

    expect(amount()).toHaveValue("1234");
    expect(method("Cash")).toBeChecked();
  });

  it.each([
    ["an empty amount", "", "3000", "Enter an amount"],
    ["more than the balance due", "2500.01", "3000", /^Can't be more than the balance due \(LKR\s2,500\.00\)$/],
    ["more than 2 decimals", "10.505", "3000", "Enter an amount like 1500 or 1499.80"],
    ["a zero amount", "0", "3000", "Amount must be more than 0"],
  ])("rejects %s", async (_, amountValue, cash, message) => {
    const user = userEvent.setup();
    renderDialog();

    await user.clear(amount());
    if (amountValue) await user.type(amount(), amountValue);
    await user.type(cashReceived(), cash);
    await user.click(submit());

    expect(await within(dialog()).findByText(message)).toBeInTheDocument();
    expect(salesService.addSalePayment).not.toHaveBeenCalled();
  });

  it("rejects cash received below the amount", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(cashReceived(), "2000");
    await user.click(submit());

    expect(
      await within(dialog()).findByText("Cash received is less than the amount"),
    ).toBeInTheDocument();
    expect(salesService.addSalePayment).not.toHaveBeenCalled();
  });

  it("requires a reference number for card payments", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(method("Card"));
    await user.click(submit());

    expect(await within(dialog()).findByText("Enter the reference number")).toBeInTheDocument();
    expect(salesService.addSalePayment).not.toHaveBeenCalled();
  });

  it("records a cash payment and closes", async () => {
    salesService.addSalePayment.mockResolvedValue({
      ...sale,
      amount_paid: "2500.00",
      change_due: "500.00",
    });
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.type(cashReceived(), "3000");
    await user.click(submit());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(salesService.addSalePayment).toHaveBeenCalledWith("sale-1", {
      payment_method: "CASH",
      amount: 2500,
      cash_received: 3000,
    });
  });

  it("sends a partial card payment with a trimmed reference and no cash received", async () => {
    salesService.addSalePayment.mockResolvedValue({
      ...sale,
      amount_paid: "1000.20",
      payments: [cardPayment({ amount: "1000.20" })],
    });
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(method("Card"));
    await user.clear(amount());
    await user.type(amount(), "1000.20");
    await user.type(reference(), "  AUTH-482913 ");
    await user.click(submit());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(salesService.addSalePayment).toHaveBeenCalledWith("sale-1", {
      payment_method: "CARD",
      amount: 1000.2,
      reference_number: "AUTH-482913",
    });
  });

  it("stays open and shows the server's error when recording fails", async () => {
    salesService.addSalePayment.mockRejectedValue(
      Object.assign(new Error("Bad Request"), {
        response: { status: 400, data: { message: "Payment amount 2500.00 exceeds remaining balance 0.00" } },
      }),
    );
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.type(cashReceived(), "2500");
    await user.click(submit());

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "Payment amount 2500.00 exceeds remaining balance 0.00",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(submit()).toBeEnabled();
  });
});
