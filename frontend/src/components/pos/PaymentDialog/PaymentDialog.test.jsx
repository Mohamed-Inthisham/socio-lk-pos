import { vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaymentDialog from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import { cardPayment, customer, draftSale, saleLine, tradeInPayment } from "../../../test/posFixtures";
import * as salesService from "../../../services/salesService";
import * as productsService from "../../../services/productsService";
import * as customersService from "../../../services/customersService";

vi.mock("../../../services/salesService");
vi.mock("../../../services/productsService");
vi.mock("../../../services/customersService");

// Total 2,500.00, nothing paid yet.
const sale = draftSale({
  lines: [saleLine({ quantity: 2, line_total: "2500.00", unit_price: "1250.00" })],
  subtotal: "2500.00",
  total: "2500.00",
  amount_paid: "0.00",
});

const renderDialog = (props = {}, draftSale = sale) => {
  const onClose = vi.fn();
  const utils = renderWithProviders(<PaymentDialog open onClose={onClose} {...props} />, {
    preloadedState: { posTerminal: posTerminalState({ draftSale }) },
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

  it("offers six methods; '6' picks Trade-in, swaps Amount for its fields and focuses Product", async () => {
    const user = userEvent.setup();
    // A trade-in needs a customer with an NIC (P4-2, P4-13)
    renderDialog({}, { ...sale, customer_id: "cust-1", customer: customer() });
    await waitFor(() => expect(method("Cash")).toHaveFocus());

    expect(within(dialog()).getAllByRole("radio")).toHaveLength(6);
    expect(method("Trade-in")).toHaveAttribute("aria-keyshortcuts", "6");

    await user.keyboard("6");

    expect(method("Trade-in")).toBeChecked();
    await waitFor(() =>
      expect(within(dialog()).getByRole("combobox", { name: /^Product/ })).toHaveFocus(),
    );
    expect(within(dialog()).queryByLabelText(/^Amount/)).not.toBeInTheDocument();
    expect(cashReceived()).not.toBeInTheDocument();
    expect(reference()).not.toBeInTheDocument();
    expect(within(dialog()).getByLabelText(/^IMEI/)).toHaveValue("");
    // Empty, not the balance (P4-5)
    expect(within(dialog()).getByLabelText(/^Trade-in value/)).toHaveValue("");
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

  describe("cash change", () => {
    const change = () => within(dialog()).queryByTestId("cash-change");

    it("shows the change live, in cents: 2,000.00 for 1,234.50 → 765.50", async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.clear(amount());
      await user.type(amount(), "1234.50");
      await user.type(cashReceived(), "2000.00");

      expect(change()).toHaveTextContent(/^Change:LKR\s765\.50$/);
    });

    it("shows LKR 0.00 for exact cash", async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.type(cashReceived(), "2500");

      expect(change()).toHaveTextContent(/^Change:LKR\s0\.00$/);
    });

    it("hides the change while cash received is blank", async () => {
      const user = userEvent.setup();
      renderDialog();
      expect(change()).not.toBeInTheDocument();

      await user.type(cashReceived(), "3000");
      expect(change()).toBeInTheDocument();

      await user.clear(cashReceived());
      expect(change()).not.toBeInTheDocument();
    });

    it("updates when the amount changes", async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.type(cashReceived(), "3000");
      expect(change()).toHaveTextContent(/500\.00$/);

      await user.clear(amount());
      await user.type(amount(), "1000.20");
      expect(change()).toHaveTextContent(/1,999\.80$/);
    });

    it("flags short cash as it's typed and disables Record payment", async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.type(cashReceived(), "2000");

      expect(within(dialog()).getByText("Cash received is less than the amount")).toBeInTheDocument();
      expect(change()).not.toBeInTheDocument();
      expect(submit()).toBeDisabled();

      await user.keyboard("{Enter}");
      expect(salesService.addSalePayment).not.toHaveBeenCalled();

      await user.type(cashReceived(), "0"); // 20000
      expect(within(dialog()).queryByText("Cash received is less than the amount")).not.toBeInTheDocument();
      expect(submit()).toBeEnabled();
    });

    it("doesn't flag short cash while the amount is invalid", async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.clear(amount());
      await user.type(cashReceived(), "100");

      expect(within(dialog()).queryByText("Cash received is less than the amount")).not.toBeInTheDocument();
      expect(change()).not.toBeInTheDocument();
      expect(submit()).toBeEnabled();
    });
  });

  it.each([
    ["Cash received", () => cashReceived()],
    ["Amount", () => amount()],
  ])("Enter in %s records a valid cash payment", async (_, field) => {
    salesService.addSalePayment.mockResolvedValue({ ...sale, amount_paid: "2500.00" });
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.type(cashReceived(), "3000");
    await user.click(field());
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(salesService.addSalePayment).toHaveBeenCalledTimes(1);
    expect(salesService.addSalePayment).toHaveBeenCalledWith("sale-1", {
      payment_method: "CASH",
      amount: 2500,
      cash_received: 3000,
    });
  });

  it.each([
    ["valid cash", "3000"],
    ["short cash (no-op)", "2000"],
  ])("Enter in Cash received cancels the browser's own submission — %s", async (_, cash) => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(cashReceived(), cash);

    // fireEvent returns false when a handler called preventDefault().
    expect(fireEvent.keyDown(cashReceived(), { key: "Enter", code: "Enter" })).toBe(false);
  });

  it("one Enter records the payment exactly once, even if a second submit lands in the same tick", async () => {
    let resolvePayment;
    salesService.addSalePayment.mockImplementation(
      () => new Promise((resolve) => { resolvePayment = resolve; }),
    );
    const user = userEvent.setup();
    const { onClose, store } = renderDialog();

    await user.type(cashReceived(), "3000");
    // Our keydown handler's requestSubmit, then a native implicit
    // submission in the same tick (what preventDefault guards against).
    fireEvent.keyDown(cashReceived(), { key: "Enter", code: "Enter" });
    within(dialog()).getByRole("form", { name: "Payment" }).requestSubmit();

    await waitFor(() => expect(salesService.addSalePayment).toHaveBeenCalledTimes(1));
    // Further Enters / clicks while the request is in flight are ignored.
    await user.keyboard("{Enter}");
    await user.click(submit());
    // One addPayment dispatched → one pending row. (A second dispatch
    // would queue behind the first and POST once it settles.)
    expect(store.getState().posTerminal.pendingPayments).toHaveLength(1);

    resolvePayment({ ...sale, amount_paid: "2500.00" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0)); // let any queued POST run
    expect(salesService.addSalePayment).toHaveBeenCalledTimes(1);
  });

  it("Enter with an invalid amount shows the error instead of recording", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.clear(amount());
    await user.type(amount(), "2500.01");
    await user.type(cashReceived(), "3000{Enter}");

    expect(
      await within(dialog()).findByText(/^Can't be more than the balance due/),
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

  describe.each([
    ["Card", "CARD", "2", "Auth code or RRN from the card terminal slip"],
    ["Bank transfer", "BANK_TRANSFER", "3", "Reference on the transfer slip or banking app"],
    ["Koko", "KOKO", "4", "Transaction ID from Koko"],
    ["Mintpay", "MINTPAY", "5", "Transaction ID from Mintpay"],
  ])("%s reference", (label, value, key, hint) => {
    const pick = async (user) => {
      await waitFor(() => expect(method("Cash")).toHaveFocus());
      await user.keyboard(key);
      expect(method(label)).toBeChecked();
      await waitFor(() => expect(reference()).toHaveFocus());
    };

    it("shows its own hint and hides Cash received", async () => {
      const user = userEvent.setup();
      renderDialog();
      await pick(user);

      expect(within(dialog()).getByText(hint)).toBeInTheDocument();
      expect(cashReceived()).not.toBeInTheDocument();
    });

    it("rejects a blank, whitespace-only or over-long reference", async () => {
      const user = userEvent.setup();
      renderDialog();
      await pick(user);

      await user.keyboard("{Enter}");
      expect(await within(dialog()).findByText("Enter the reference number")).toBeInTheDocument();

      await user.type(reference(), "   {Enter}");
      expect(await within(dialog()).findByText("Enter the reference number")).toBeInTheDocument();

      await user.clear(reference());
      await user.paste("R".repeat(101));
      await user.keyboard("{Enter}");
      expect(
        await within(dialog()).findByText("Reference must be 100 characters or fewer"),
      ).toBeInTheDocument();

      expect(salesService.addSalePayment).not.toHaveBeenCalled();
    });

    it("rejects an amount above the balance due", async () => {
      const user = userEvent.setup();
      renderDialog();
      await pick(user);

      await user.type(reference(), "REF-1");
      await user.clear(amount());
      await user.type(amount(), "2600{Enter}");

      expect(
        await within(dialog()).findByText(/^Can't be more than the balance due/),
      ).toBeInTheDocument();
      expect(salesService.addSalePayment).not.toHaveBeenCalled();
    });

    it("records a 100-character reference with the method and no cash received", async () => {
      salesService.addSalePayment.mockResolvedValue({ ...sale, amount_paid: "2500.00" });
      const user = userEvent.setup();
      const { onClose } = renderDialog();
      await pick(user);

      await user.paste("R".repeat(100));
      await user.keyboard("{Enter}");

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(salesService.addSalePayment).toHaveBeenCalledWith("sale-1", {
        payment_method: value,
        amount: 2500,
        reference_number: "R".repeat(100),
      });
    });
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

describe("PaymentDialog — Trade-in customer and NIC (P4-2, P4-13)", () => {
  const withCustomer = (overrides) => ({ ...sale, customer_id: "cust-1", customer: customer(overrides) });
  const panelTitle = (name) => within(dialog()).getByRole("region", { name });
  const nicField = () => within(dialog()).getByLabelText(/^Customer NIC/);

  const pickTradeIn = async (user) => {
    await waitFor(() => expect(method("Cash")).toHaveFocus());
    await user.keyboard("6");
  };

  it("without a customer: shows the attach panel, focuses Attach customer, and blocks Record payment", async () => {
    const user = userEvent.setup();
    const onAttachCustomer = vi.fn();
    renderDialog({ onAttachCustomer });
    await pickTradeIn(user);

    expect(panelTitle("Trade-in needs a customer")).toBeInTheDocument();
    const attach = within(dialog()).getByRole("button", { name: "Attach customer" });
    await waitFor(() => expect(attach).toHaveFocus());
    expect(within(dialog()).queryByLabelText(/^Amount/)).not.toBeInTheDocument();
    expect(within(dialog()).queryByLabelText(/^IMEI/)).not.toBeInTheDocument();
    expect(submit()).toBeDisabled();

    await user.click(attach);
    expect(onAttachCustomer).toHaveBeenCalledTimes(1);
    expect(salesService.addSalePayment).not.toHaveBeenCalled();
  });

  it("opened on Trade-in (initialMethod), focuses Product when the customer has an NIC", async () => {
    renderDialog({ initialMethod: "TRADE_IN" }, withCustomer());

    expect(await screen.findByRole("radio", { name: "Trade-in" })).toBeChecked();
    await waitFor(() =>
      expect(within(dialog()).getByRole("combobox", { name: /^Product/ })).toHaveFocus(),
    );
  });

  it("opened on Trade-in with no customer, focuses Attach customer", async () => {
    renderDialog({ initialMethod: "TRADE_IN" });

    await waitFor(() =>
      expect(within(dialog()).getByRole("button", { name: "Attach customer" })).toHaveFocus(),
    );
  });

  it("a customer without an NIC: shows the NIC panel focused, blocks Record payment, and rejects a short NIC", async () => {
    const user = userEvent.setup();
    renderDialog({}, withCustomer({ nic: null }));
    await pickTradeIn(user);

    expect(panelTitle("Trade-in needs the customer's NIC")).toBeInTheDocument();
    expect(within(dialog()).getByText("Kamal Perera has no NIC on file. Add it to take the phone.")).toBeInTheDocument();
    await waitFor(() => expect(nicField()).toHaveFocus());
    expect(submit()).toBeDisabled();

    // Enter saves the NIC (never the payment) — 4 characters is too short
    await user.keyboard("1990{Enter}");
    expect(within(dialog()).getByText("NIC must be 5–20 characters.")).toBeInTheDocument();
    expect(customersService.updateCustomer).not.toHaveBeenCalled();
    expect(salesService.addSalePayment).not.toHaveBeenCalled();
  });

  it("saves a valid NIC and swaps the panel for the trade-in fields", async () => {
    customersService.updateCustomer.mockResolvedValue(customer({ nic: "199012345678" }));
    const user = userEvent.setup();
    const { store } = renderDialog({}, withCustomer({ nic: null }));
    await pickTradeIn(user);
    await waitFor(() => expect(nicField()).toHaveFocus());

    await user.keyboard(" 199012345678 {Enter}");

    await waitFor(() =>
      expect(within(dialog()).getByRole("combobox", { name: /^Product/ })).toHaveFocus(),
    );
    expect(customersService.updateCustomer).toHaveBeenCalledWith("cust-1", { nic: "199012345678" });
    expect(store.getState().posTerminal.draftSale.customer.nic).toBe("199012345678");
    expect(within(dialog()).queryByRole("region", { name: "Trade-in needs the customer's NIC" })).not.toBeInTheDocument();
    expect(submit()).toBeEnabled();
    expect(salesService.addSalePayment).not.toHaveBeenCalled();
  });

  it("shows an NIC that belongs to another customer inline", async () => {
    customersService.updateCustomer.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        response: { status: 409, data: { message: "A customer with NIC X already exists", existing_customer_id: "cust-2" } },
      }),
    );
    const user = userEvent.setup();
    renderDialog({}, withCustomer({ nic: null }));
    await pickTradeIn(user);
    await waitFor(() => expect(nicField()).toHaveFocus());

    await user.keyboard("199012345678");
    await user.click(within(dialog()).getByRole("button", { name: "Save NIC" }));

    expect(
      await within(dialog()).findByText("This NIC is on file for another customer. Check it, or change the customer."),
    ).toBeInTheDocument();
    expect(panelTitle("Trade-in needs the customer's NIC")).toBeInTheDocument();
  });
});

describe("PaymentDialog — Trade-in", () => {
  // Total 50,000.00 with a customer; 10,000.00 already paid by card.
  const tradeInSale = (overrides = {}) =>
    draftSale({
      lines: [saleLine({ line_total: "50000.00", unit_price: "50000.00" })],
      subtotal: "50000.00",
      total: "50000.00",
      amount_paid: "10000.00",
      customer_id: "cust-1",
      customer: customer(),
      payments: [cardPayment({ amount: "10000.00" })],
      ...overrides,
    });

  const usedIp12 = {
    id: "p-used-ip12",
    name: "Used iPhone 12 128GB",
    is_serialized: true,
    is_active: true,
    phone_condition: "USED",
  };
  const newIp12 = { id: "p-new-ip12", name: "iPhone 12 128GB", is_serialized: true, is_active: true, phone_condition: "NEW" };
  const ip12Case = { id: "p-case", name: "iPhone 12 Case", is_serialized: false, is_active: true, phone_condition: null };
  const inactiveIp12 = { ...usedIp12, id: "p-old", name: "Used iPhone 12 (old)", is_active: false };

  // Passes Luhn; the posFixtures IMEI (354789102345678) does not.
  const GOOD_IMEI = "354789102345675";
  const LUHN_HINT = "Check digit doesn't match — rescan?";

  const renderTradeIn = (overrides) => {
    const onClose = vi.fn();
    const utils = renderWithProviders(<PaymentDialog open onClose={onClose} />, {
      preloadedState: { posTerminal: posTerminalState({ draftSale: tradeInSale(overrides) }) },
    });
    return { ...utils, onClose };
  };

  const product = () => within(dialog()).getByRole("combobox", { name: /^Product/ });
  const imei = () => within(dialog()).getByLabelText(/^IMEI/);
  const value = () => within(dialog()).getByLabelText(/^Trade-in value/);
  const resale = () => within(dialog()).getByLabelText(/^Resale price/);
  const notes = () => within(dialog()).getByLabelText(/^Condition notes/);

  const openTradeIn = async (user) => {
    await waitFor(() => expect(method("Cash")).toHaveFocus());
    await user.keyboard("6");
    await waitFor(() => expect(product()).toHaveFocus());
  };

  const pickUsedIp12 = async (user) => {
    await user.keyboard("iphone 12");
    await within(dialog()).findByRole("option", { name: /Used iPhone 12 128GB/ });
    await user.keyboard("{Enter}");
  };

  beforeEach(() => {
    productsService.listProducts.mockResolvedValue({
      data: [newIp12, ip12Case, usedIp12, inactiveIp12],
      meta: { total: 4 },
    });
  });

  it("searches serialized phones at the sale's branch, used SKUs first with a badge", async () => {
    const user = userEvent.setup();
    renderTradeIn();
    await openTradeIn(user);

    await user.keyboard("iphone 12");
    const options = await within(dialog()).findAllByRole("option");

    expect(productsService.listProducts).toHaveBeenLastCalledWith({
      search: "iphone 12",
      branchId: "branch-main",
      productType: "PHONE",
      limit: 20,
    });
    // Non-serialized and inactive products are left out
    expect(options.map((o) => o.textContent)).toEqual(["Used iPhone 12 128GBUsed", "iPhone 12 128GB"]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
  });

  it("says to ask an admin when no serialized product matches", async () => {
    productsService.listProducts.mockResolvedValue({ data: [ip12Case], meta: { total: 1 } });
    const user = userEvent.setup();
    renderTradeIn();
    await openTradeIn(user);

    await user.keyboard("iphone 12 case");

    expect(
      await within(dialog()).findByText("No used-phone product for this model. Ask an admin to add one."),
    ).toBeInTheDocument();
  });

  it("Enter picks the product and moves to the IMEI; a scanner's Enter in the IMEI moves to the value without submitting", async () => {
    const user = userEvent.setup();
    renderTradeIn();
    await openTradeIn(user);

    await pickUsedIp12(user);

    expect(product()).toHaveValue("Used iPhone 12 128GB");
    expect(imei()).toHaveFocus();

    await user.keyboard(`${GOOD_IMEI}{Enter}`);

    expect(value()).toHaveFocus();
    expect(salesService.addSalePayment).not.toHaveBeenCalled();
    expect(within(dialog()).queryByText("Enter the trade-in value")).not.toBeInTheDocument();
  });

  it("Esc closes the product list but not the dialog", async () => {
    const user = userEvent.setup();
    const { onClose } = renderTradeIn();
    await openTradeIn(user);

    await user.keyboard("iphone 12");
    await within(dialog()).findAllByRole("option");
    await user.keyboard("{Escape}");

    expect(within(dialog()).queryByRole("listbox")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it("typing after a pick clears the product", async () => {
    const user = userEvent.setup();
    renderTradeIn();
    await openTradeIn(user);
    await pickUsedIp12(user);

    await user.click(product());
    await user.keyboard("{Backspace}");
    await user.click(submit());

    expect(await within(dialog()).findByText("Pick the trade-in product")).toBeInTheDocument();
  });

  it("records the trade-in: value sent as amount and buying price, the pending row named after the product", async () => {
    let resolvePayment;
    salesService.addSalePayment.mockImplementation(
      () => new Promise((resolve) => { resolvePayment = resolve; }),
    );
    const user = userEvent.setup();
    const { onClose, store } = renderTradeIn();
    await openTradeIn(user);
    await pickUsedIp12(user);

    await user.keyboard(`${GOOD_IMEI}{Enter}`);
    await user.keyboard("35000");
    await user.type(resale(), "52000");
    await user.type(notes(), "  Battery 89%, no box  {Enter}");

    await waitFor(() => expect(salesService.addSalePayment).toHaveBeenCalledTimes(1));
    expect(salesService.addSalePayment).toHaveBeenCalledWith("sale-1", {
      payment_method: "TRADE_IN",
      amount: 35000,
      trade_in_product_id: "p-used-ip12",
      trade_in_imei: GOOD_IMEI,
      trade_in_buying_price: 35000,
      trade_in_selling_price: 52000,
      trade_in_notes: "Battery 89%, no box",
    });
    expect(store.getState().posTerminal.pendingPayments).toEqual([
      expect.objectContaining({
        payment_method: "TRADE_IN",
        trade_in_product: { id: "p-used-ip12", name: "Used iPhone 12 128GB" },
      }),
    ]);

    resolvePayment(tradeInSale({ amount_paid: "45000.00" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("requires product, IMEI and value, and caps the value at the balance due (P4-4)", async () => {
    const user = userEvent.setup();
    renderTradeIn();
    await openTradeIn(user);

    await user.click(submit());

    expect(await within(dialog()).findByText("Pick the trade-in product")).toBeInTheDocument();
    expect(within(dialog()).getByText("Enter the IMEI")).toBeInTheDocument();
    expect(within(dialog()).getByText("Enter the trade-in value")).toBeInTheDocument();
    // The first field in error, on screen, gets focus
    await waitFor(() => expect(product()).toHaveFocus());

    await user.type(value(), "40000.01");
    await user.click(submit());

    expect(
      await within(dialog()).findByText(
        /^Trade-in value can't exceed the balance due \(LKR\s40,000\.00\)\. Add items, or record the phone purchase separately\.$/,
      ),
    ).toBeInTheDocument();
    expect(salesService.addSalePayment).not.toHaveBeenCalled();
  });

  it("blocks an IMEI already on another trade-in on this sale", async () => {
    const user = userEvent.setup();
    renderTradeIn({
      amount_paid: "20000.00",
      payments: [cardPayment({ amount: "10000.00" }), tradeInPayment({ amount: "10000.00", trade_in_imei: GOOD_IMEI })],
    });
    await openTradeIn(user);
    await pickUsedIp12(user);

    await user.keyboard(`${GOOD_IMEI}{Enter}20000`);
    await user.click(submit());

    expect(
      await within(dialog()).findByText("This IMEI is already on another trade-in on this sale"),
    ).toBeInTheDocument();
    expect(salesService.addSalePayment).not.toHaveBeenCalled();
  });

  it("hints at a misscan when a 15-digit IMEI fails the check digit, but still records it", async () => {
    salesService.addSalePayment.mockResolvedValue(tradeInSale({ amount_paid: "30000.00" }));
    const user = userEvent.setup();
    const { onClose } = renderTradeIn();
    await openTradeIn(user);
    await pickUsedIp12(user);

    await user.keyboard("354789102345678");
    expect(within(dialog()).getByText(LUHN_HINT)).toBeInTheDocument();

    await user.clear(imei());
    await user.keyboard(GOOD_IMEI);
    expect(within(dialog()).queryByText(LUHN_HINT)).not.toBeInTheDocument();

    await user.clear(imei());
    await user.keyboard("354789102345678{Enter}20000{Enter}");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(salesService.addSalePayment).toHaveBeenCalledWith(
      "sale-1",
      expect.objectContaining({ trade_in_imei: "354789102345678" }),
    );
  });

  it("warns, without blocking, when the resale price is below the trade-in value (P4-6)", async () => {
    const user = userEvent.setup();
    renderTradeIn();
    await openTradeIn(user);

    await user.type(value(), "30000");
    await user.type(resale(), "29999.99");
    expect(within(dialog()).getByText("Below the trade-in value")).toBeInTheDocument();

    await user.clear(resale());
    await user.type(resale(), "30000");
    expect(within(dialog()).queryByText("Below the trade-in value")).not.toBeInTheDocument();
  });

  it.each([
    ["IN_STOCK", { id: "u-1", status: "IN_STOCK" }, "Already in stock: the shop holds a phone with this IMEI."],
    ["WRITTEN_OFF", { id: "u-1", status: "WRITTEN_OFF" }, "This IMEI is on a written-off phone. Ask a manager to check it."],
    ["no unit", null, "This IMEI is already in inventory."],
  ])("shows a 409 (%s) on the IMEI field and clears it when the IMEI changes", async (_, unit, message) => {
    salesService.addSalePayment.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        response: { status: 409, data: { message: "IMEI already exists", existing_unit: unit } },
      }),
    );
    const user = userEvent.setup();
    const { onClose } = renderTradeIn();
    await openTradeIn(user);
    await pickUsedIp12(user);

    await user.keyboard(`${GOOD_IMEI}{Enter}20000{Enter}`);

    expect(await within(dialog()).findByText(message)).toBeInTheDocument();
    expect(within(dialog()).queryByRole("alert")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.type(imei(), "1");
    expect(within(dialog()).queryByText(message)).not.toBeInTheDocument();
  });

  it("shows other server errors in the dialog's alert", async () => {
    salesService.addSalePayment.mockRejectedValue(
      Object.assign(new Error("bad"), {
        response: { status: 400, data: { message: "Trade-in product is inactive" } },
      }),
    );
    const user = userEvent.setup();
    renderTradeIn();
    await openTradeIn(user);
    await pickUsedIp12(user);

    await user.keyboard(`${GOOD_IMEI}{Enter}20000{Enter}`);

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Trade-in product is inactive");
  });
});
