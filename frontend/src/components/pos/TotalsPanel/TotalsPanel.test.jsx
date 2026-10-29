import { vi } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TotalsPanel from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import { cableProduct, cashPayment, draftSale, saleLine } from "../../../test/posFixtures";
import { refreshStock } from "../../../store/slices/posTerminalSlice";

const renderTotals = (sale, overrides = {}, props = {}) =>
  renderWithProviders(<TotalsPanel {...props} />, {
    preloadedState: { posTerminal: posTerminalState({ draftSale: sale, ...overrides }) },
  });

// One cable (1500.00) in the cart, nothing paid yet.
const cartSale = (overrides = {}) =>
  draftSale({
    lines: [saleLine()],
    subtotal: "1500.00",
    total: "1500.00",
    amount_paid: "0.00",
    change_due: "0.00",
    ...overrides,
  });

const pendingPayment = {
  id: "pending-1",
  payment_method: "CASH",
  amount: "500.00",
  cash_received: "500.00",
  reference_number: null,
};

const payButton = () => screen.getByRole("button", { name: /^Pay / });
const completeButton = () => screen.getByRole("button", { name: /Complete sale/ });

describe("TotalsPanel", () => {
  it("shows the server's subtotal, discount and total without recomputing", () => {
    // Deliberately inconsistent with the line: the panel must echo the
    // server's sale-level fields, not sum the lines itself.
    renderTotals(
      draftSale({
        lines: [saleLine({ line_total: "1500.00" })],
        subtotal: "64490.00",
        discount_total: "0.00",
        tax_total: "0.00",
        total: "64490.00",
      }),
    );

    expect(screen.getByTestId("totals-subtotal")).toHaveTextContent("64,490.00");
    expect(screen.getByTestId("totals-discount")).toHaveTextContent(/−.*0\.00/);
    expect(screen.getByTestId("totals-total")).toHaveTextContent("64,490.00");
    expect(screen.queryByTestId("totals-tax")).not.toBeInTheDocument();
  });

  it("marks the totals as updating while a line change is in flight", () => {
    renderTotals(draftSale({ total: "1500.00", subtotal: "1500.00" }), {
      pendingLines: [{ id: "pending-1", product_id: "p", product_name_snapshot: "X", quantity: 1, unit_price: "10.00", imei_snapshot: null, line_total: null }],
    });

    expect(screen.getByRole("region", { name: "Sale totals" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Updating…")).toBeInTheDocument();
  });

  it("shows the server's paid figure and the balance due, subtracted in cents", () => {
    renderTotals(cartSale({ total: "100.30", subtotal: "100.30", amount_paid: "50.10" }));

    expect(screen.getByTestId("totals-paid")).toHaveTextContent("50.10");
    expect(screen.getByTestId("totals-balance")).toHaveTextContent("50.20");
  });

  it("labels the Pay button with the balance due and calls onPay", async () => {
    const onPay = vi.fn();
    const user = userEvent.setup();
    renderTotals(cartSale({ amount_paid: "500.00" }), {}, { onPay });

    expect(payButton()).toHaveTextContent("Pay");
    expect(payButton()).toHaveTextContent("1,000.00");
    expect(payButton()).toHaveAttribute("aria-keyshortcuts", "F4");
    expect(payButton()).toBeEnabled();

    await user.click(payButton());
    expect(onPay).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the cart is empty", draftSale(), {}],
    ["the sale is no longer open", cartSale(), { status: "gone" }],
  ])("disables Pay when %s", (_, sale, overrides) => {
    renderTotals(sale, overrides);

    expect(payButton()).toBeDisabled();
  });

  it("disables Pay while a mutation is in flight, keeping the last known balance", () => {
    renderTotals(cartSale({ amount_paid: "500.00" }), { pendingPayments: [pendingPayment] });

    expect(payButton()).toBeDisabled();
    expect(payButton()).toHaveTextContent("1,000.00");
    expect(payButton().querySelector(".animate-spin")).toBeNull();
  });

  it("replaces Pay with 'Paid in full' and a Complete sale button once fully paid, with the change due", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    renderTotals(
      cartSale({
        amount_paid: "1500.00",
        change_due: "500.00",
        payments: [cashPayment()],
      }),
      {},
      { onComplete },
    );

    expect(screen.queryByRole("button", { name: /^Pay / })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Paid in full");
    expect(screen.getByTestId("totals-change")).toHaveTextContent("500.00");
    expect(screen.getByTestId("totals-balance")).toHaveTextContent("0.00");
    expect(completeButton()).toBeEnabled();
    expect(completeButton()).toHaveAttribute("aria-keyshortcuts", "F9");

    await user.click(completeButton());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("disables Complete sale while a mutation is in flight", () => {
    renderTotals(cartSale({ amount_paid: "1500.00", payments: [cashPayment()] }), {
      removingPaymentIds: ["pay-cash"],
    });

    expect(completeButton()).toBeDisabled();
  });

  it("keeps Complete sale (spinning, disabled) while the sale completes — not Pay", () => {
    renderTotals(cartSale({ amount_paid: "1500.00", payments: [cashPayment()] }), {
      status: "completing",
    });

    expect(completeButton()).toBeDisabled();
    expect(completeButton().querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Pay / })).not.toBeInTheDocument();
  });

  it("keeps 'Paid in full' (dimmed) while a mutation is in flight — never 'Pay LKR 0.00'", () => {
    renderTotals(cartSale({ amount_paid: "1500.00", payments: [cashPayment()] }), {
      removingPaymentIds: ["pay-cash"],
    });

    expect(screen.getByTestId("totals-ready")).toHaveClass("opacity-50");
    expect(screen.queryByRole("button", { name: /^Pay / })).not.toBeInTheDocument();
  });

  it("keeps Pay showing (disabled) while a payment that would settle the balance is in flight", () => {
    renderTotals(cartSale({ amount_paid: "500.00" }), {
      pendingPayments: [{ ...pendingPayment, amount: "1000.00", cash_received: "1000.00" }],
    });

    expect(payButton()).toBeDisabled();
    expect(payButton()).toHaveTextContent("1,000.00");
    expect(screen.queryByTestId("totals-ready")).not.toBeInTheDocument();
  });
});

describe("TotalsPanel: not enough stock", () => {
  const tracked = (quantity) => ({ [cableProduct.id]: { quantity, manage_stock: true } });
  // Two cables in the cart, nothing paid.
  const twoCables = () => cartSale({ lines: [saleLine({ quantity: 2 })], subtotal: "3000.00", total: "3000.00" });

  it("disables Pay and says why while a product is short of stock", () => {
    renderTotals(twoCables(), { stockByProduct: tracked(1) });

    expect(payButton()).toBeDisabled();
    expect(screen.getByTestId("pay-blocked-reason")).toHaveTextContent("Not enough stock for this sale.");
  });

  it("enables Pay again, without the reason, once refreshed stock covers the sale", async () => {
    const { store } = renderTotals(twoCables(), { stockByProduct: tracked(1) });
    expect(payButton()).toBeDisabled();

    act(() => {
      store.dispatch(
        refreshStock.fulfilled({ quantity: 5, manage_stock: true }, "req-1", {
          productId: cableProduct.id,
          branchId: "branch-main",
        }),
      );
    });

    expect(payButton()).toBeEnabled();
    expect(screen.queryByTestId("pay-blocked-reason")).not.toBeInTheDocument();
  });

  it("a sale with enough stock pays as before: Pay enabled, no reason", async () => {
    const onPay = vi.fn();
    const user = userEvent.setup();
    renderTotals(twoCables(), { stockByProduct: tracked(2) }, { onPay });

    expect(screen.queryByTestId("pay-blocked-reason")).not.toBeInTheDocument();
    await user.click(payButton());
    expect(onPay).toHaveBeenCalledTimes(1);
  });

  it("other reasons for a disabled Pay give no stock reason", () => {
    renderTotals(cartSale(), { pendingPayments: [pendingPayment] });

    expect(payButton()).toBeDisabled();
    expect(screen.queryByTestId("pay-blocked-reason")).not.toBeInTheDocument();
  });

  it("spins and can't be pressed while the stock is re-read before payment", async () => {
    const onPay = vi.fn();
    const user = userEvent.setup();
    renderTotals(twoCables(), { stockByProduct: tracked(5) }, { onPay, payChecking: true });

    expect(payButton()).toBeDisabled();
    await user.click(payButton());
    expect(onPay).not.toHaveBeenCalled();
  });
});
