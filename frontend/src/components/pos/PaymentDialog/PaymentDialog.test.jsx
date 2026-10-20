import { vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

  // P4 Step A: TRADE_IN is defined (methods.js) but hidden until its
  // fields land in Step B, which replaces this test.
  it("doesn't offer Trade-in yet, and '6' does nothing", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(method("Cash")).toHaveFocus());

    expect(within(dialog()).getAllByRole("radio")).toHaveLength(5);
    expect(within(dialog()).queryByRole("radio", { name: /Trade-in/ })).not.toBeInTheDocument();

    await user.keyboard("6");

    expect(method("Cash")).toBeChecked();
    expect(method("Cash")).toHaveFocus();
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
