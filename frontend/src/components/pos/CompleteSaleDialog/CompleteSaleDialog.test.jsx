import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CompleteSaleDialog from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import {
  cardPayment,
  cashPayment,
  draftSale,
  saleLine,
  tradeInPayment,
} from "../../../test/posFixtures";
import { resetMutationQueue } from "../../../store/slices/posTerminalSlice";
import * as salesService from "../../../services/salesService";
import * as stockService from "../../../services/stockService";
import * as customersService from "../../../services/customersService";

vi.mock("../../../services/salesService");
vi.mock("../../../services/stockService");
vi.mock("../../../services/customersService");

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// Two cables (3000.00), paid by card 1000 + cash 2000 (received 2500 → change 500).
const paidSale = (overrides = {}) =>
  draftSale({
    lines: [saleLine({ quantity: 2, line_total: "3000.00" })],
    subtotal: "3000.00",
    total: "3000.00",
    amount_paid: "3000.00",
    change_due: "500.00",
    payments: [
      cardPayment(),
      cashPayment({ amount: "2000.00", cash_received: "2500.00" }),
    ],
    ...overrides,
  });

const stockRow = (quantity) => ({
  product_id: "p-cable",
  branch_id: "branch-main",
  quantity,
  manage_stock: true,
});

const renderDialog = (sale = paidSale(), props = {}) => {
  const onClose = vi.fn();
  const utils = renderWithProviders(<CompleteSaleDialog open onClose={onClose} {...props} />, {
    preloadedState: { posTerminal: posTerminalState({ draftSale: sale }) },
  });
  return { ...utils, onClose };
};

const dialog = () => screen.getByRole("dialog", { name: "Complete this sale?" });
const completeButton = () => within(dialog()).getByRole("button", { name: /Complete sale/ });

const completed = () => ({ ...paidSale(), status: "COMPLETED", sale_number: "INV-20261020-0001" });

beforeEach(() => {
  vi.resetAllMocks();
  resetMutationQueue();
  stockService.listStock.mockResolvedValue([stockRow(10)]);
});

describe("CompleteSaleDialog", () => {
  it("shows the total, the change due and every tender", async () => {
    renderDialog(
      paidSale({
        payments: [
          cardPayment(),
          cashPayment({ amount: "1000.00", cash_received: "1500.00" }),
          tradeInPayment({
            amount: "1000.00",
            trade_in_product: { id: "p-phone", name: "Used iPhone 12" },
          }),
        ],
      }),
    );

    expect(within(dialog()).getByTestId("complete-total")).toHaveTextContent("3,000.00");
    expect(within(dialog()).getByTestId("complete-change")).toHaveTextContent("500.00");
    const tenders = within(within(dialog()).getByRole("list", { name: "Tenders" })).getAllByRole("listitem");
    expect(tenders).toHaveLength(3);
    expect(tenders[0]).toHaveTextContent(/Card.*1,000\.00.*Ref AUTH-482913/);
    expect(tenders[1]).toHaveTextContent(/Cash.*1,000\.00.*Received.*1,500\.00/);
    expect(tenders[2]).toHaveTextContent(/Trade-in.*1,000\.00.*Used iPhone 12 · 354789102345678/);
    // Let the stock check settle before the test ends
    await waitFor(() => expect(within(dialog()).queryByText("Checking stock…")).not.toBeInTheDocument());
  });

  it("lists the items with their warranty, up to 3 then '+N more' (P5-18)", async () => {
    renderDialog(
      paidSale({
        lines: [
          saleLine({ product_name_snapshot: "iPhone 15 128GB", warranty: "MONTH_12" }),
          saleLine({ id: "line-2", quantity: 2, warranty: "CHECKING" }),
          saleLine({ id: "line-3", product_name_snapshot: "Charger", warranty: "WEEK_1" }),
          saleLine({ id: "line-4", product_name_snapshot: "Case", warranty: "MONTH_1" }),
        ],
      }),
    );

    const items = within(within(dialog()).getByRole("list", { name: "Items" })).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "iPhone 15 128GB12 months",
      "2 × USB-C Cable 1mChecking",
      "Charger1 week",
      "+1 more",
    ]);
    await waitFor(() => expect(within(dialog()).queryByText("Checking stock…")).not.toBeInTheDocument());
  });

  it("leaves the items out while a stock shortfall shows (keeps the dialog within ~640px)", async () => {
    stockService.listStock.mockResolvedValueOnce([stockRow(0)]);
    renderDialog(paidSale({ lines: [saleLine({ quantity: 2, line_total: "3000.00", warranty: "CHECKING" })] }));

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Not enough stock");
    expect(within(dialog()).queryByRole("list", { name: "Items" })).not.toBeInTheDocument();
  });

  it("hides Change due when there is none", async () => {
    renderDialog(paidSale({ change_due: "0.00" }));

    expect(within(dialog()).queryByTestId("complete-change")).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog()).queryByText("Checking stock…")).not.toBeInTheDocument());
  });

  it("re-checks branch stock on open, with Complete focused meanwhile", async () => {
    const check = deferred();
    stockService.listStock.mockReturnValue(check.promise);
    renderDialog();

    expect(stockService.listStock).toHaveBeenCalledWith({ branchId: "branch-main" });
    expect(within(dialog()).getByText("Checking stock…")).toBeInTheDocument();
    await waitFor(() => expect(completeButton()).toHaveFocus());

    check.resolve([stockRow(10)]);
    await waitFor(() => expect(within(dialog()).queryByText("Checking stock…")).not.toBeInTheDocument());
    expect(completeButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("lists a shortfall and blocks Complete; Check again clears it once stock is there", async () => {
    const user = userEvent.setup();
    stockService.listStock.mockResolvedValueOnce([stockRow(1)]);
    renderDialog();

    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent("Not enough stock");
    expect(alert).toHaveTextContent("USB-C Cable 1m: 2 needed, 1 in stock");
    expect(completeButton()).toHaveAttribute("aria-disabled", "true");

    await user.click(completeButton());
    expect(salesService.completeSale).not.toHaveBeenCalled();

    stockService.listStock.mockResolvedValueOnce([stockRow(5)]);
    await user.click(within(alert).getByRole("button", { name: "Check again" }));

    await waitFor(() => expect(within(dialog()).queryByRole("alert")).not.toBeInTheDocument());
    expect(stockService.listStock).toHaveBeenCalledTimes(2);
    expect(completeButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("still lets the cashier complete when the stock lookup fails", async () => {
    const user = userEvent.setup();
    stockService.listStock.mockRejectedValue(new Error("Network Error"));
    salesService.completeSale.mockResolvedValue(completed());
    const { onClose } = renderDialog();

    expect(await within(dialog()).findByText(/Couldn't check stock/)).toBeInTheDocument();
    await user.click(completeButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(salesService.completeSale).toHaveBeenCalledWith("sale-1");
  });

  it("Enter completes, and closes on success", async () => {
    const user = userEvent.setup();
    salesService.completeSale.mockResolvedValue(completed());
    const { onClose, store } = renderDialog();
    await waitFor(() => expect(within(dialog()).queryByText("Checking stock…")).not.toBeInTheDocument());
    await waitFor(() => expect(completeButton()).toHaveFocus());

    await user.keyboard("{Enter}");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(salesService.completeSale).toHaveBeenCalledTimes(1);
    expect(store.getState().posTerminal.status).toBe("completed");
  });

  it("Enter during the stock check waits for it, then completes", async () => {
    const user = userEvent.setup();
    const check = deferred();
    stockService.listStock.mockReturnValue(check.promise);
    salesService.completeSale.mockResolvedValue(completed());
    const { onClose } = renderDialog();
    await waitFor(() => expect(completeButton()).toHaveFocus());

    await user.keyboard("{Enter}");
    expect(salesService.completeSale).not.toHaveBeenCalled();

    check.resolve([stockRow(10)]);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(salesService.completeSale).toHaveBeenCalledTimes(1);
  });

  it("Enter during the stock check doesn't complete if the check finds a shortfall", async () => {
    const user = userEvent.setup();
    const check = deferred();
    stockService.listStock.mockReturnValue(check.promise);
    const { onClose } = renderDialog();
    await waitFor(() => expect(completeButton()).toHaveFocus());

    await user.keyboard("{Enter}");
    check.resolve([stockRow(0)]);

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("2 needed, 0 in stock");
    expect(salesService.completeSale).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("can't be dismissed or completed twice while completing", async () => {
    const user = userEvent.setup();
    const request = deferred();
    salesService.completeSale.mockReturnValue(request.promise);
    const { onClose } = renderDialog();
    await waitFor(() => expect(within(dialog()).queryByText("Checking stock…")).not.toBeInTheDocument());

    await user.click(completeButton());
    await waitFor(() => expect(completeButton()).toHaveAttribute("aria-busy", "true"));
    expect(completeButton()).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog()).getByRole("button", { name: "Back" })).toBeDisabled();

    await user.keyboard("{Escape}");
    await user.click(completeButton());
    expect(onClose).not.toHaveBeenCalled();
    expect(salesService.completeSale).toHaveBeenCalledTimes(1);

    request.resolve(completed());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  describe("complete errors (P5-8)", () => {
    const httpError = (status, data) =>
      Object.assign(new Error(`Request failed with status code ${status}`), {
        response: { status, data },
      });

    // Open, wait for the stock check, press Complete; resolves with the alert.
    const failWith = async (error, sale) => {
      const user = userEvent.setup();
      salesService.completeSale.mockRejectedValueOnce(error);
      const utils = renderDialog(sale);
      await waitFor(() => expect(within(dialog()).queryByText("Checking stock…")).not.toBeInTheDocument());
      await waitFor(() => expect(completeButton()).toHaveFocus());
      await user.keyboard("{Enter}");
      return { ...utils, user };
    };

    it("E5 out of stock: says which item, blocks Complete, focuses Fix the cart, refreshes stock", async () => {
      const { onClose, user } = await failWith(
        httpError(409, {
          message: 'Insufficient stock for "USB-C Cable 1m": requested 2, available 0',
          product_id: "p-cable",
          sale_line_id: "line-1",
        }),
      );

      const alert = await within(dialog()).findByRole("alert");
      expect(alert).toHaveTextContent("Not enough stock");
      expect(alert).toHaveTextContent("USB-C Cable 1m: 2 needed, 0 in stock.");
      const fix = within(alert).getByRole("button", { name: "Fix the cart" });
      await waitFor(() => expect(fix).toHaveFocus());
      expect(completeButton()).toHaveAttribute("aria-disabled", "true");
      // The cart's stock badges are refreshed (open + after the error)
      await waitFor(() => expect(stockService.listStock).toHaveBeenCalledTimes(2));
      // One message, not a second shortfall box from that refresh
      expect(within(dialog()).getAllByRole("alert")).toHaveLength(1);

      await user.click(completeButton());
      expect(salesService.completeSale).toHaveBeenCalledTimes(1);
      await user.click(fix);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("E6 a phone sold elsewhere: names the IMEI, Fix the cart", async () => {
      await failWith(
        httpError(409, {
          message: "Cannot sell IMEI '354789102345678': status is SOLD, expected IN_STOCK.",
          existing_unit: { id: "unit-7", status: "SOLD" },
        }),
      );

      const alert = await within(dialog()).findByRole("alert");
      expect(alert).toHaveTextContent("Phone already sold");
      expect(alert).toHaveTextContent("IMEI 354789102345678 was sold on another sale");
      expect(within(alert).getByRole("button", { name: "Fix the cart" })).toBeInTheDocument();
    });

    it("E10/E11 trade-in IMEI in stock: names the IMEI, Fix the payments", async () => {
      await failWith(
        httpError(409, {
          message: "IMEI already exists in inventory",
          imei: "354789102345678",
          payment_id: "pay-ti",
          existing_unit: null,
        }),
      );

      const alert = await within(dialog()).findByRole("alert");
      expect(alert).toHaveTextContent("Trade-in phone already in stock");
      expect(alert).toHaveTextContent("(IMEI 354789102345678)");
      await waitFor(() =>
        expect(within(alert).getByRole("button", { name: "Fix the payments" })).toHaveFocus(),
      );
      expect(completeButton()).toHaveAttribute("aria-disabled", "true");
    });

    it("E9 inactive trade-in product: names the product, Fix the payments", async () => {
      await failWith(httpError(400, { message: 'Product "Used iPhone 12" is inactive' }));

      const alert = await within(dialog()).findByRole("alert");
      expect(alert).toHaveTextContent("Trade-in product inactive");
      expect(alert).toHaveTextContent('"Used iPhone 12" was deactivated');
      expect(within(alert).getByRole("button", { name: "Fix the payments" })).toBeInTheDocument();
    });

    it("E4 the sale changed: says so and re-reads the sale", async () => {
      salesService.getSale.mockResolvedValue(paidSale({ amount_paid: "2000.00" }));

      await failWith(
        httpError(400, { message: "Cannot complete sale: amount_paid 2000.00 does not equal total 3000.00" }),
      );

      const alert = await within(dialog()).findByRole("alert");
      expect(alert).toHaveTextContent("The sale has changed");
      await waitFor(() => expect(salesService.getSale).toHaveBeenCalledWith("sale-1"));
      expect(completeButton()).toHaveAttribute("aria-disabled", "true");
    });

    it("E12 a server error: Nothing was saved, Complete stays focused, and trying again works", async () => {
      salesService.getSale.mockResolvedValue(paidSale()); // the re-fetch: still a DRAFT
      salesService.completeSale
        .mockRejectedValueOnce(httpError(500, { message: "Internal server error" }))
        .mockResolvedValueOnce(completed());
      const user = userEvent.setup();
      const { onClose } = renderDialog();
      await waitFor(() => expect(within(dialog()).queryByText("Checking stock…")).not.toBeInTheDocument());
      await waitFor(() => expect(completeButton()).toHaveFocus());

      await user.keyboard("{Enter}");

      const alert = await within(dialog()).findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't complete the sale");
      expect(alert).toHaveTextContent("The server had a problem. Nothing was saved. Try again.");
      expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
      expect(completeButton()).toHaveFocus();
      expect(completeButton()).not.toHaveAttribute("aria-disabled", "true");

      await user.keyboard("{Enter}");
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(salesService.completeSale).toHaveBeenCalledTimes(2);
    });

    it("a lost answer that couldn't be confirmed says so, and stays retryable", async () => {
      salesService.getSale.mockRejectedValue(new Error("Network Error"));

      await failWith(new Error("Network Error"));

      const alert = await within(dialog()).findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't confirm the sale");
      expect(alert).toHaveTextContent("a sale is never completed twice");
      expect(completeButton()).not.toHaveAttribute("aria-disabled", "true");
    });

    it("an unrecognised refusal shows the server's message", async () => {
      await failWith(httpError(400, { message: "Something the terminal doesn't know about" }));

      const alert = await within(dialog()).findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't complete the sale");
      expect(alert).toHaveTextContent("Something the terminal doesn't know about");
    });

    it("E8 no NIC: the NIC form, focused; saving it lets the sale complete", async () => {
      const kamal = { id: "cust-1", name: "Kamal Perera", phone: "0771234567", nic: "199012345678", deleted_at: null };
      customersService.updateCustomer.mockResolvedValue({ ...kamal, nic: "199012345678" });
      const { onClose, user } = await failWith(
        httpError(400, { message: "A trade-in needs the customer's NIC" }),
        paidSale({ customer_id: kamal.id, customer: kamal }),
      );

      const nic = await within(dialog()).findByLabelText(/^Customer NIC/);
      await waitFor(() => expect(nic).toHaveFocus());
      expect(within(dialog()).getByText("Trade-in needs the customer's NIC")).toBeInTheDocument();
      expect(completeButton()).toHaveAttribute("aria-disabled", "true");

      salesService.completeSale.mockResolvedValueOnce(completed());
      await user.type(nic, "199012345678{Enter}");

      await waitFor(() => expect(within(dialog()).queryByLabelText(/^Customer NIC/)).not.toBeInTheDocument());
      expect(customersService.updateCustomer).toHaveBeenCalledWith("cust-1", { nic: "199012345678" });
      await waitFor(() => expect(completeButton()).toHaveFocus());
      expect(completeButton()).not.toHaveAttribute("aria-disabled", "true");

      await user.keyboard("{Enter}");
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(salesService.completeSale).toHaveBeenCalledTimes(2);
    });
  });

  it("Back closes without completing", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await waitFor(() => expect(within(dialog()).queryByText("Checking stock…")).not.toBeInTheDocument());

    await user.click(within(dialog()).getByRole("button", { name: "Back" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(salesService.completeSale).not.toHaveBeenCalled();
  });
});
