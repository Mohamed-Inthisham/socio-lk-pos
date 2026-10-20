import { vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PosTerminal from ".";
import {
  authState,
  branchesState,
  renderWithProviders,
} from "../../test/renderWithProviders";
import { cashierUser, mainShop } from "../../test/fixtures";
import { customer, draftSale, phoneProduct, saleLine, tradeInPayment } from "../../test/posFixtures";
import useTerminalSessionStore from "../../store/zustand/terminalSessionStore";
import * as salesService from "../../services/salesService";
import * as stockService from "../../services/stockService";
import * as productsService from "../../services/productsService";
import * as customersService from "../../services/customersService";

vi.mock("../../services/salesService");
vi.mock("../../services/stockService");
vi.mock("../../services/productsService");
vi.mock("../../services/customersService");

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
  customersService.listCustomers.mockResolvedValue({ data: [], meta: {} });
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

describe("PosTerminal layout", () => {
  const paidSale = () =>
    draftSale({
      lines, subtotal: "3990.00", total: "3990.00", amount_paid: "3990.00", change_due: "10.00",
      payments: [{ id: "pay-1", payment_method: "CASH", amount: "3990.00", cash_received: "4000.00", reference_number: null }],
    });

  it("places Payments in the left column, directly below the cart — not in the right column", async () => {
    salesService.createSale.mockResolvedValue(paidSale());
    await renderTerminal();

    const payments = screen.getByTestId("payments-card");
    const cartCard = screen.getByRole("list", { name: "Cart" }).closest(".rounded-2xl");
    expect(payments.previousElementSibling).toBe(cartCard);
    expect(payments.parentElement).toContainElement(scanBar());
    expect(screen.getByRole("complementary")).not.toContainElement(payments);
    // The cart flexes; its ≥ lg minimum leaves room for 3 payment rows
    expect(cartCard).toHaveClass("flex-1", "lg:min-h-40");
  });

  it("renders no Payments card before the first tender", async () => {
    await renderTerminal();
    expect(screen.queryByTestId("payments-card")).not.toBeInTheDocument();
  });

  it("right column: scrolls at ≥ lg as a last resort, with Totals pinned to the bottom", async () => {
    await renderTerminal();

    const aside = screen.getByRole("complementary");
    expect(aside).toHaveClass("lg:overflow-y-auto", "lg:min-h-0");
    const dock = screen.getByTestId("totals-dock");
    expect(dock).toHaveClass("lg:sticky", "lg:bottom-0");
    expect(within(dock).getByRole("region", { name: "Sale totals" })).toBeInTheDocument();
    expect(aside.lastElementChild).toBe(dock);
  });
});

describe("PosTerminal F3 customer hotkey", () => {
  const attachDialog = () => screen.queryByRole("dialog", { name: "Attach customer" });

  it("F3 opens the attach dialog from the scan bar, with the search focused", async () => {
    const user = userEvent.setup();
    await renderTerminal();
    expect(scanBar()).toHaveFocus();

    await user.keyboard("[F3]"); // by code: user-event's key map has no F-keys

    expect(await screen.findByRole("dialog", { name: "Attach customer" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Search customers" })).toHaveFocus(),
    );
  });

  it("F3 is ignored while the New sale dialog is open", async () => {
    const user = userEvent.setup();
    await renderTerminal();

    await user.click(screen.getByRole("button", { name: "New sale" }));
    await screen.findByRole("dialog", { name: "Start a new sale?" });
    await user.keyboard("[F3]");

    expect(attachDialog()).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Start a new sale?" })).toBeInTheDocument();
  });

  it("F3 is ignored while the IMEI prompt is open", async () => {
    productsService.getProductByBarcode.mockResolvedValue(phoneProduct);
    const user = userEvent.setup();
    await renderTerminal();

    await user.type(scanBar(), `${phoneProduct.barcode}{Enter}`);
    const imeiInput = await screen.findByLabelText("IMEI");
    await user.keyboard("[F3]");

    expect(attachDialog()).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(imeiInput).toHaveFocus();
  });
});

describe("PosTerminal F4 payment hotkey", () => {
  const paymentDialog = () => screen.queryByRole("dialog", { name: "Take payment" });
  // `lines` total 3990.00 with nothing paid
  const payableSale = () => draftSale({ lines, subtotal: "3990.00", total: "3990.00" });

  it("F4 opens the payment dialog from the scan bar", async () => {
    salesService.createSale.mockResolvedValue(payableSale());
    const user = userEvent.setup();
    await renderTerminal();
    expect(scanBar()).toHaveFocus();

    await user.keyboard("[F4]");

    const dialog = await screen.findByRole("dialog", { name: "Take payment" });
    expect(within(dialog).getByTestId("payment-balance")).toHaveTextContent("3,990.00");
  });

  it("the Pay button opens the same dialog", async () => {
    salesService.createSale.mockResolvedValue(payableSale());
    const user = userEvent.setup();
    await renderTerminal();

    await user.click(screen.getByRole("button", { name: /^Pay / }));

    expect(await screen.findByRole("dialog", { name: "Take payment" })).toBeInTheDocument();
  });

  it("F4 is ignored when the Pay button is disabled (empty cart)", async () => {
    salesService.createSale.mockResolvedValue(draftSale());
    const user = userEvent.setup();
    // An empty cart has no "Cart" list to wait for — wait for the Pay button.
    renderWithProviders(<PosTerminal />, {
      preloadedState: { auth: authState(cashierUser), branches: branchesState([mainShop]) },
    });

    expect(await screen.findByRole("button", { name: /^Pay / })).toBeDisabled();
    await user.keyboard("[F4]");

    expect(paymentDialog()).not.toBeInTheDocument();
  });

  it("F4 is ignored while another dialog is open", async () => {
    salesService.createSale.mockResolvedValue(payableSale());
    const user = userEvent.setup();
    await renderTerminal();

    await user.click(screen.getByRole("button", { name: "New sale" }));
    await screen.findByRole("dialog", { name: "Start a new sale?" });
    await user.keyboard("[F4]");

    expect(paymentDialog()).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("recording a payment closes the dialog and hands focus back to the scan bar", async () => {
    salesService.createSale.mockResolvedValue(payableSale());
    salesService.addSalePayment.mockResolvedValue({
      ...payableSale(),
      amount_paid: "1000.00",
      payments: [{ id: "pay-1", payment_method: "CARD", amount: "1000.00", reference_number: "AUTH-1" }],
    });
    const user = userEvent.setup();
    await renderTerminal();

    await user.keyboard("[F4]");
    const dialog = await screen.findByRole("dialog", { name: "Take payment" });
    await user.click(within(dialog).getByRole("radio", { name: "Card" }));
    const amount = within(dialog).getByLabelText(/^Amount/);
    await user.clear(amount);
    await user.type(amount, "1000");
    await user.type(within(dialog).getByLabelText(/^Reference number/), "AUTH-1");
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));

    await waitFor(() => expect(paymentDialog()).not.toBeInTheDocument());
    await waitFor(() => expect(scanBar()).toHaveFocus());
    expect(screen.getByRole("button", { name: /^Pay / })).toHaveTextContent("2,990.00");
  });

  it("multi-tender: a partial card payment, then F4 reopens on the remainder and cash settles it", async () => {
    const card = { id: "pay-1", payment_method: "CARD", amount: "1000.00", cash_received: null, reference_number: "AUTH-1" };
    const cash = { id: "pay-2", payment_method: "CASH", amount: "2990.00", cash_received: "3000.00", reference_number: null };
    salesService.createSale.mockResolvedValue(payableSale());
    salesService.addSalePayment
      .mockResolvedValueOnce({ ...payableSale(), amount_paid: "1000.00", change_due: "0.00", payments: [card] })
      .mockResolvedValueOnce({ ...payableSale(), amount_paid: "3990.00", change_due: "10.00", payments: [card, cash] });
    const user = userEvent.setup();
    await renderTerminal();

    // 1st tender: Card, partial — F4 → 2 → reference → Shift+Tab → amount → Enter
    await user.keyboard("[F4]");
    let dialog = await screen.findByRole("dialog", { name: "Take payment" });
    await waitFor(() => expect(within(dialog).getByRole("radio", { name: "Cash" })).toHaveFocus());
    await user.keyboard("2");
    await waitFor(() => expect(within(dialog).getByLabelText(/^Reference number/)).toHaveFocus());
    await user.keyboard("AUTH-1");
    await user.tab({ shift: true });
    await user.clear(within(dialog).getByLabelText(/^Amount/));
    await user.keyboard("1000{Enter}");

    await waitFor(() => expect(paymentDialog()).not.toBeInTheDocument());
    expect(salesService.addSalePayment).toHaveBeenNthCalledWith(1, "sale-1", {
      payment_method: "CARD",
      amount: 1000,
      reference_number: "AUTH-1",
    });
    expect(screen.getByTestId("totals-paid")).toHaveTextContent("1,000.00");
    expect(screen.getByTestId("totals-balance")).toHaveTextContent("2,990.00");
    expect(screen.getByRole("button", { name: /^Pay / })).toHaveTextContent("2,990.00");

    // 2nd tender: F4 reopens fresh — Cash, amount = the new remainder
    await user.keyboard("[F4]");
    dialog = await screen.findByRole("dialog", { name: "Take payment" });
    expect(within(dialog).getByTestId("payment-paid")).toHaveTextContent("1,000.00");
    expect(within(dialog).getByTestId("payment-balance")).toHaveTextContent("2,990.00");
    expect(within(dialog).getByRole("radio", { name: "Cash" })).toBeChecked();
    expect(within(dialog).getByLabelText(/^Amount/)).toHaveValue("2990.00");
    await waitFor(() => expect(within(dialog).getByRole("radio", { name: "Cash" })).toHaveFocus());
    await user.keyboard("1");
    await waitFor(() => expect(within(dialog).getByLabelText(/^Cash received/)).toHaveFocus());
    await user.keyboard("3000");
    expect(within(dialog).getByTestId("cash-change")).toHaveTextContent("10.00");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(paymentDialog()).not.toBeInTheDocument());
    expect(salesService.addSalePayment).toHaveBeenNthCalledWith(2, "sale-1", {
      payment_method: "CASH",
      amount: 2990,
      cash_received: 3000,
    });
    expect(screen.getByTestId("totals-ready")).toHaveTextContent("Ready to complete");
    expect(screen.getByTestId("totals-change")).toHaveTextContent("10.00");
    expect(screen.getByTestId("totals-balance")).toHaveTextContent("0.00");
    expect(screen.queryByRole("button", { name: /^Pay / })).not.toBeInTheDocument();
    const payments = within(screen.getByRole("list", { name: "Payments" })).getAllByRole("listitem");
    expect(payments.map((p) => p.getAttribute("aria-label"))).toEqual([
      expect.stringMatching(/^Card LKR\s1,000\.00$/),
      expect.stringMatching(/^Cash LKR\s2,990\.00$/),
    ]);

    // Fully paid: F4 does nothing
    await user.keyboard("[F4]");
    expect(paymentDialog()).not.toBeInTheDocument();
    expect(salesService.addSalePayment).toHaveBeenCalledTimes(2);
  });

  it("removing a payment on a fully paid sale brings Pay back and hands focus to the scan bar", async () => {
    const card = { id: "pay-1", payment_method: "CARD", amount: "1000.00", cash_received: null, reference_number: "AUTH-1" };
    const cash = { id: "pay-2", payment_method: "CASH", amount: "2990.00", cash_received: "3000.00", reference_number: null };
    salesService.createSale.mockResolvedValue({
      ...payableSale(), amount_paid: "3990.00", change_due: "10.00", payments: [card, cash],
    });
    salesService.removeSalePayment.mockResolvedValue();
    salesService.getSale.mockResolvedValue({
      ...payableSale(), amount_paid: "1000.00", change_due: "0.00", payments: [card],
    });
    const user = userEvent.setup();
    await renderTerminal();
    expect(screen.getByTestId("totals-ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Remove Cash payment/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: /^Pay / })).toHaveTextContent("2,990.00"));
    expect(salesService.removeSalePayment).toHaveBeenCalledWith("sale-1", "pay-2");
    expect(screen.queryByTestId("totals-ready")).not.toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Payments" })).getAllByRole("listitem")).toHaveLength(1);
    expect(scanBar()).toHaveFocus();
  });

  it("closing the payment dialog hands focus back to the scan bar", async () => {
    salesService.createSale.mockResolvedValue(payableSale());
    const user = userEvent.setup();
    await renderTerminal();

    await user.keyboard("[F4]");
    const dialog = await screen.findByRole("dialog", { name: "Take payment" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(paymentDialog()).not.toBeInTheDocument());
    await waitFor(() => expect(scanBar()).toHaveFocus());
  });
});

describe("PosTerminal trade-in: F6, attach-then-return, F3 guard (P4-2, P4-11)", () => {
  const paymentDialog = () => screen.queryByRole("dialog", { name: "Take payment" });
  const attachDialog = () => screen.queryByRole("dialog", { name: "Attach customer" });
  const kamal = customer();
  // `lines` total 3990.00 with nothing paid
  const payableSale = (overrides = {}) =>
    draftSale({ lines, subtotal: "3990.00", total: "3990.00", ...overrides });
  const withKamal = () => payableSale({ customer_id: kamal.id, customer: kamal });

  const pickKamal = async (user) => {
    customersService.listCustomers.mockResolvedValue({ data: [kamal], meta: { total: 1 } });
    salesService.updateSale.mockResolvedValue(withKamal());
    await user.keyboard("kamal");
    await screen.findByRole("option", { name: /Kamal Perera/ });
    await user.keyboard("{Enter}");
  };

  const expectTradeInOpen = async () => {
    const dialog = await screen.findByRole("dialog", { name: "Take payment" });
    expect(within(dialog).getByRole("radio", { name: "Trade-in" })).toBeChecked();
    return dialog;
  };

  it("F6 opens the payment dialog on Trade-in with Product focused", async () => {
    salesService.createSale.mockResolvedValue(withKamal());
    const user = userEvent.setup();
    await renderTerminal();

    await user.keyboard("[F6]");

    const dialog = await expectTradeInOpen();
    await waitFor(() =>
      expect(within(dialog).getByRole("combobox", { name: /^Product/ })).toHaveFocus(),
    );
    expect(within(dialog).queryByLabelText(/^Amount/)).not.toBeInTheDocument();
  });

  it("F6 cancels the browser's own F6 (address bar) even when it does nothing", async () => {
    salesService.createSale.mockResolvedValue(draftSale());
    renderWithProviders(<PosTerminal />, {
      preloadedState: { auth: authState(cashierUser), branches: branchesState([mainShop]) },
    });
    expect(await screen.findByRole("button", { name: /^Pay / })).toBeDisabled();

    // fireEvent returns false when a handler called preventDefault().
    expect(fireEvent.keyDown(scanBar(), { key: "F6", code: "F6" })).toBe(false);
    expect(paymentDialog()).not.toBeInTheDocument();
    expect(attachDialog()).not.toBeInTheDocument();
  });

  it("F6 with no customer attaches one first, then opens Trade-in", async () => {
    salesService.createSale.mockResolvedValue(payableSale());
    const user = userEvent.setup();
    await renderTerminal();

    await user.keyboard("[F6]");
    await screen.findByRole("dialog", { name: "Attach customer" });
    expect(paymentDialog()).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Search customers" })).toHaveFocus(),
    );

    await pickKamal(user);

    const dialog = await expectTradeInOpen();
    await waitFor(() => expect(attachDialog()).not.toBeInTheDocument());
    expect(salesService.updateSale).toHaveBeenCalledWith("sale-1", { customer_id: kamal.id });
    await waitFor(() =>
      expect(within(dialog).getByRole("combobox", { name: /^Product/ })).toHaveFocus(),
    );
  });

  it("cancelling that attach doesn't open the payment dialog; focus returns to the scan bar", async () => {
    salesService.createSale.mockResolvedValue(payableSale());
    const user = userEvent.setup();
    await renderTerminal();

    await user.keyboard("[F6]");
    await screen.findByRole("dialog", { name: "Attach customer" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(attachDialog()).not.toBeInTheDocument());
    await waitFor(() => expect(scanBar()).toHaveFocus());
    expect(paymentDialog()).not.toBeInTheDocument();
  });

  it("the payment dialog's Attach customer closes it, attaches, and comes back on Trade-in", async () => {
    salesService.createSale.mockResolvedValue(payableSale());
    const user = userEvent.setup();
    await renderTerminal();

    await user.keyboard("[F4]");
    let dialog = await screen.findByRole("dialog", { name: "Take payment" });
    await waitFor(() => expect(within(dialog).getByRole("radio", { name: "Cash" })).toHaveFocus());
    await user.keyboard("6");
    expect(within(dialog).getByText("Trade-in needs a customer")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Attach customer" })).toHaveFocus(),
    );

    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Attach customer" });
    await waitFor(() => expect(paymentDialog()).not.toBeInTheDocument());

    await pickKamal(user);

    dialog = await expectTradeInOpen();
    expect(within(dialog).queryByText("Trade-in needs a customer")).not.toBeInTheDocument();
  });

  it("F3 is ignored while a trade-in payment holds the customer", async () => {
    salesService.createSale.mockResolvedValue(
      payableSale({ customer_id: kamal.id, customer: kamal, amount_paid: "1000.00", payments: [tradeInPayment({ amount: "1000.00" })] }),
    );
    const user = userEvent.setup();
    await renderTerminal();

    await user.keyboard("[F3]");

    expect(attachDialog()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toHaveAttribute("aria-disabled", "true");
  });
});
