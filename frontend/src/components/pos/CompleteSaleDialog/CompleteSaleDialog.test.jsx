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

vi.mock("../../../services/salesService");
vi.mock("../../../services/stockService");

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

  it("stays open with the server's message when completing fails, Complete still focused", async () => {
    const user = userEvent.setup();
    salesService.completeSale.mockRejectedValue(
      Object.assign(new Error("Conflict"), {
        response: {
          status: 409,
          data: {
            message: 'Insufficient stock for "USB-C Cable 1m": requested 2, available 0',
            product_id: "p-cable",
            sale_line_id: "line-1",
          },
        },
      }),
    );
    const { onClose } = renderDialog();
    await waitFor(() => expect(within(dialog()).queryByText("Checking stock…")).not.toBeInTheDocument());
    await waitFor(() => expect(completeButton()).toHaveFocus());

    await user.keyboard("{Enter}");

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      'Insufficient stock for "USB-C Cable 1m": requested 2, available 0',
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(completeButton()).toHaveFocus();
    expect(completeButton()).not.toHaveAttribute("aria-disabled", "true");
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
