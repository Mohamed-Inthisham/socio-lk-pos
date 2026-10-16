import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaymentsList from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import { cardPayment, cashPayment, draftSale, saleLine } from "../../../test/posFixtures";
import * as salesService from "../../../services/salesService";

vi.mock("../../../services/salesService");

const cash = cashPayment({ amount: "1500.00", cash_received: "2000.00" });
const card = cardPayment({ amount: "1000.00", reference_number: "AUTH-482913" });
const bank = cardPayment({ id: "pay-bank", payment_method: "BANK_TRANSFER", amount: "500.00", reference_number: "SLIP-77" });
const koko = cardPayment({ id: "pay-koko", payment_method: "KOKO", amount: "300.00", reference_number: "KK-1" });
const mintpay = cardPayment({ id: "pay-mint", payment_method: "MINTPAY", amount: "200.00", reference_number: "MP-9" });

const saleWith = (payments) =>
  draftSale({
    lines: [saleLine({ line_total: "5000.00" })],
    subtotal: "5000.00",
    total: "5000.00",
    amount_paid: "3500.00",
    payments,
  });

const renderList = (payments = [cash, card, bank, koko, mintpay], overrides = {}, props = {}) =>
  renderWithProviders(<PaymentsList {...props} />, {
    preloadedState: {
      posTerminal: posTerminalState({ draftSale: saleWith(payments), ...overrides }),
    },
  });

const rows = () => screen.queryAllByTestId("payment-row");
const row = (name) => screen.getByRole("listitem", { name });
const removeButton = (name) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PaymentsList", () => {
  it("renders nothing before the sale has a payment", () => {
    const { container } = renderList([]);
    expect(container).toBeEmptyDOMElement();
  });

  // formatLKR puts a no-break space after "LKR"; \s matches it.
  it.each([
    ["Cash", /^Cash LKR\s1,500\.00$/, /^Received LKR\s2,000\.00 · change LKR\s500\.00$/],
    ["Card", /^Card LKR\s1,000\.00$/, "Ref AUTH-482913"],
    ["Bank transfer", /^Bank transfer LKR\s500\.00$/, "Ref SLIP-77"],
    ["Koko", /^Koko LKR\s300\.00$/, "Ref KK-1"],
    ["Mintpay", /^Mintpay LKR\s200\.00$/, "Ref MP-9"],
  ])("shows a %s row with its amount and detail", (_, name, detail) => {
    renderList();

    expect(rows()).toHaveLength(5);
    const item = row(name);
    expect(within(item).getByText(detail)).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: /^Remove / })).toBeEnabled();
  });

  it("leaves out the change for exact cash", () => {
    renderList([cashPayment({ amount: "1500.00", cash_received: "1500.00" })]);

    expect(within(rows()[0]).getByText(/^Received LKR\s1,500\.00$/)).toBeInTheDocument();
    expect(within(rows()[0]).queryByText(/change/)).not.toBeInTheDocument();
  });

  it("has no edit affordance — one remove button per row and no inputs", () => {
    renderList();

    for (const item of rows()) {
      const buttons = within(item).getAllByRole("button");
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveAccessibleName(/^Remove /);
      expect(within(item).queryByRole("textbox")).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("removes without a confirm: the row hides at once, then shows the server's sale", async () => {
    let finishDelete;
    salesService.removeSalePayment.mockImplementation(
      () => new Promise((resolve) => { finishDelete = resolve; }),
    );
    salesService.getSale.mockResolvedValue({ ...saleWith([cash]), amount_paid: "1500.00" });
    const onReturnFocus = vi.fn();
    const user = userEvent.setup();
    renderList([cash, card], {}, { onReturnFocus });

    await user.click(removeButton(/^Remove Card payment of LKR\s1,000\.00$/));

    // Hidden while the DELETE is in flight, no dialog asked
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: /^Card/ })).not.toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    expect(onReturnFocus).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(salesService.removeSalePayment).toHaveBeenCalledWith("sale-1", "pay-card"));

    finishDelete();
    await waitFor(() => expect(salesService.getSale).toHaveBeenCalledWith("sale-1"));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(row(/^Cash/)).toBeInTheDocument();
  });

  it("restores the row and shows the server's message when the remove fails", async () => {
    let failDelete;
    salesService.removeSalePayment.mockImplementation(
      () => new Promise((_, reject) => { failDelete = reject; }),
    );
    const user = userEvent.setup();
    renderList([cash, card]);

    await user.click(removeButton(/^Remove Card payment/));
    expect(screen.queryByRole("listitem", { name: /^Card/ })).not.toBeInTheDocument();
    await waitFor(() => expect(salesService.removeSalePayment).toHaveBeenCalled());

    failDelete(
      Object.assign(new Error("Bad Request"), {
        response: { status: 400, data: { message: "Payment can't be removed" } },
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Payment can't be removed");
    expect(row(/^Card LKR\s1,000\.00$/)).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    expect(salesService.getSale).not.toHaveBeenCalled();
  });

  it("dims a pending row and gives it a spinner instead of a remove button", () => {
    renderList([cash], {
      pendingPayments: [
        { id: "pending-1", payment_method: "CARD", amount: "700.00", cash_received: null, reference_number: "AUTH-9" },
      ],
    });

    const pending = row(/^Card LKR\s700\.00$/);
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending).toHaveClass("opacity-60");
    expect(within(pending).getByLabelText("Recording")).toBeInTheDocument();
    expect(within(pending).queryByRole("button")).not.toBeInTheDocument();
    expect(row(/^Cash/)).toHaveAttribute("aria-busy", "false");
  });

  // jsdom has no layout, so these pin the classes the sizing relies on
  // (measured in a real browser at 1366×650 / 1366×768 / 1526×640).
  describe("sizing", () => {
    const paymentsCard = () => screen.getByTestId("payments-card");
    const list = () => screen.getByRole("list", { name: "Payments" });

    it("keeps its natural height: the card never shrinks", () => {
      renderList([cash]);

      expect(paymentsCard()).toHaveClass("flex-shrink-0");
      expect(paymentsCard()).not.toHaveClass("min-h-0");
    });

    it("shows up to 3 fixed-height rows, then scrolls, in both layouts", () => {
      renderList([cash, card, bank, koko]);

      // 3 × 4.5rem stacked, 3 × 3.5rem table
      expect(list()).toHaveClass("overflow-y-auto", "max-h-54", "@lg:max-h-42");
      for (const item of rows()) expect(item).toHaveClass("h-18", "@lg:h-14");
    });

    it("with 2+ payments, has an explicit 2-row minimum", () => {
      renderList([cash, card]);
      expect(list()).toHaveClass("min-h-36", "@lg:min-h-28");
    });

    it("with one payment, has no 2-row minimum (no empty space)", () => {
      renderList([cash]);
      expect(list()).not.toHaveClass("min-h-36");
      expect(list()).not.toHaveClass("@lg:min-h-28");
    });
  });

  it("disables remove once the sale is no longer open", () => {
    renderList([cash], { status: "gone" });

    expect(removeButton(/^Remove Cash payment/)).toBeDisabled();
  });
});
