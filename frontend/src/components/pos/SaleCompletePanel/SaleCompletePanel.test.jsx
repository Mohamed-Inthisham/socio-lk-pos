import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SaleCompletePanel from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import {
  cardPayment,
  cashPayment,
  customer,
  draftSale,
  saleLine,
  tradeInPayment,
} from "../../../test/posFixtures";
import { resetMutationQueue } from "../../../store/slices/posTerminalSlice";
import * as salesService from "../../../services/salesService";

vi.mock("../../../services/salesService");

const completedSale = (overrides = {}) =>
  draftSale({
    status: "COMPLETED",
    sale_number: "INV-20261020-0007",
    completed_at: "2026-10-20T09:15:00.000Z",
    lines: [saleLine()],
    subtotal: "3000.00",
    total: "3000.00",
    amount_paid: "3000.00",
    change_due: "500.00",
    payments: [cardPayment(), cashPayment({ amount: "2000.00", cash_received: "2500.00" })],
    ...overrides,
  });

const renderPanel = ({ sale = completedSale(), nextDraft = { status: "ready", error: null }, props = {} } = {}) => {
  const onReturnFocus = vi.fn();
  const utils = renderWithProviders(<SaleCompletePanel onReturnFocus={onReturnFocus} {...props} />, {
    preloadedState: {
      posTerminal: posTerminalState({
        status: "completed",
        lastCompletedSale: sale,
        nextDraft,
        draftSale: nextDraft.status === "ready" ? draftSale({ id: "sale-2" }) : null,
        draftSaleId: nextDraft.status === "ready" ? "sale-2" : null,
      }),
    },
  });
  return { ...utils, onReturnFocus };
};

const panel = () => screen.getByRole("region", { name: "Sale complete" });

beforeEach(() => {
  vi.resetAllMocks();
  resetMutationQueue();
});

describe("SaleCompletePanel", () => {
  it("shows the sale number, the change due, total, paid and the tenders", () => {
    renderPanel();

    expect(within(panel()).getByTestId("sale-number")).toHaveTextContent("INV-20261020-0007");
    // 09:15 UTC = 2:45 PM in Colombo
    expect(within(panel()).getByTestId("sale-number").parentElement).toHaveTextContent("INV-20261020-0007 · 20 Oct, 2:45 PM");
    expect(within(panel()).getByTestId("sale-complete-change")).toHaveTextContent("500.00");
    expect(within(panel()).getByTestId("sale-complete-total")).toHaveTextContent("3,000.00");
    expect(within(panel()).getByTestId("sale-complete-paid")).toHaveTextContent("3,000.00");
    const tenders = within(within(panel()).getByRole("list", { name: "Tenders" })).getAllByRole("listitem");
    expect(tenders).toHaveLength(2);
    expect(tenders[0]).toHaveTextContent(/Card.*1,000\.00.*Ref AUTH-482913/);
    expect(tenders[1]).toHaveTextContent(/Cash.*2,000\.00.*Received.*2,500\.00/);
  });

  it("leaves out Change due when there is none, and shows the customer", () => {
    renderPanel({ sale: completedSale({ change_due: "0.00", customer: customer() }) });

    expect(within(panel()).queryByTestId("sale-complete-change")).not.toBeInTheDocument();
    expect(within(panel()).getByTestId("sale-complete-customer")).toHaveTextContent("Kamal Perera");
  });

  it("lists up to 3 tenders, then '+N more'", () => {
    const payments = [
      cardPayment({ id: "p1" }),
      cardPayment({ id: "p2" }),
      cardPayment({ id: "p3" }),
      tradeInPayment({ id: "p4" }),
      cashPayment({ id: "p5" }),
      cashPayment({ id: "p6" }),
    ];
    renderPanel({ sale: completedSale({ payments }) });

    const items = within(within(panel()).getByRole("list", { name: "Tenders" })).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[3]).toHaveTextContent("+3 more");
  });

  it("Next sale returns the terminal to 'ready' on the next draft and hands focus back", async () => {
    const user = userEvent.setup();
    const { store, onReturnFocus } = renderPanel();

    await user.click(within(panel()).getByRole("button", { name: /Next sale/ }));

    await waitFor(() => expect(store.getState().posTerminal.status).toBe("ready"));
    expect(store.getState().posTerminal.draftSaleId).toBe("sale-2");
    expect(onReturnFocus).toHaveBeenCalledTimes(1);
    expect(salesService.createSale).not.toHaveBeenCalled();
  });

  it("when opening the next sale failed: shows why, and Try again retries", async () => {
    const user = userEvent.setup();
    salesService.createSale.mockResolvedValue(draftSale({ id: "sale-2" }));
    const { store } = renderPanel({ nextDraft: { status: "failed", error: { message: "Network Error" } } });

    expect(within(panel()).getByRole("alert")).toHaveTextContent("Couldn't open the next sale. Network Error");
    await user.click(within(panel()).getByRole("button", { name: /Try again/ }));

    await waitFor(() => expect(store.getState().posTerminal.status).toBe("ready"));
    expect(salesService.createSale).toHaveBeenCalledWith({ branch_id: "branch-main" });
  });

  it("offers Reprint receipt only when printing is wired (onReprint)", () => {
    renderPanel();
    expect(within(panel()).queryByRole("button", { name: /Reprint/ })).not.toBeInTheDocument();
  });

  it("Reprint receipt passes the completed sale", async () => {
    const user = userEvent.setup();
    const onReprint = vi.fn();
    renderPanel({ props: { onReprint } });

    await user.click(within(panel()).getByRole("button", { name: /Reprint receipt/ }));

    expect(onReprint).toHaveBeenCalledWith(expect.objectContaining({ sale_number: "INV-20261020-0007" }));
  });
});
