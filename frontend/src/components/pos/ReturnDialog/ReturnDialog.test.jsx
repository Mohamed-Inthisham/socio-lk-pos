import { vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import ReturnDialog from ".";
import { authState, createTestStore } from "../../../test/renderWithProviders";
import { cashierUser } from "../../../test/fixtures";
import { paymentEntity, saleEntity, saleLineEntity } from "../../../test/saleEntities";
import {
  CLIENT_REQUEST_ID,
  branchStockResponse,
  createReturnResponse,
  overrideRequiredError,
  phoneTakenBackError,
  qtyExceededError,
  refundExceedsPaymentError,
  returnNetworkError,
  returnServerError,
  returnTimeoutError,
  returnWrongBranchError,
  saleWithReturnsEntity,
} from "../../../test/returnEntities";
import { approversResponse, wrongPinError } from "../../../test/voidEntities";
import * as approvalsService from "../../../services/approvalsService";
import * as salesService from "../../../services/salesService";
import * as stockService from "../../../services/stockService";
import * as requestId from "../../../utils/requestId";
import * as printing from "../../../utils/printReceipt";
import { INSPECTION_CHANGED } from "../../../hooks/useInspectionCount";
import { formatLKR } from "../../../utils/money";

// formatLKR puts a no-break space after LKR; toHaveTextContent folds it to a space.
const lkr = (value) => formatLKR(value).replace(/\s/g, " ");

vi.mock("../../../services/approvalsService");
vi.mock("../../../services/salesService");
vi.mock("../../../services/stockService");
vi.mock("../../../utils/printReceipt");

// 10:30 on Fri 23 Oct 2026 in Colombo; saleEntity was completed on the 21st.
const NOW = new Date("2026-10-23T05:00:00.000Z");

/**
 * The dialog in a store and router; `rerender` keeps them, so the dialog
 * can be closed and opened again as the page does.
 */
const renderDialog = ({ sale = saleEntity(), open = true, user = cashierUser } = {}) => {
  const onClose = vi.fn();
  const onReturned = vi.fn();
  const onSaleChanged = vi.fn();
  const store = createTestStore({ auth: authState(user) });
  const ui = (props) => (
    <Provider store={store}>
      <MemoryRouter>
        <ReturnDialog
          open={props.open}
          onClose={onClose}
          sale={props.sale}
          onReturned={onReturned}
          onSaleChanged={onSaleChanged}
        />
      </MemoryRouter>
    </Provider>
  );
  const view = render(ui({ open, sale }));
  const rerender = (props) => view.rerender(ui({ open: props.open, sale: props.sale ?? sale }));
  return { ...view, onClose, onReturned, onSaleChanged, rerender };
};

const dialog = () => screen.getByRole("dialog");
const row = (name) => within(dialog()).getByRole("group", { name: new RegExp(`^${name}:`) });
const next = () => within(dialog()).getByRole("button", { name: "Next: refund" });
const summary = () => within(dialog()).getByTestId("return-summary");
const more = (name) => within(row(name)).getByRole("button", { name: `More ${name}` });

const PHONE = "Samsung Galaxy A15 128GB";
const CASE = "Silicone Case A15";
const CHARGER = "25W Charger";
const CABLE = "USB-C Cable 1m";

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  stockService.listStock.mockResolvedValue(branchStockResponse());
  approvalsService.listApprovers.mockResolvedValue(approversResponse());
  printing.printReturnSlip.mockResolvedValue([160, 213]);
});

afterEach(() => {
  vi.useRealTimers();
});

const ready = async () => {
  await waitFor(() => expect(next()).toBeEnabled());
};

describe("ReturnDialog: the items step (P7-16, P7-20)", () => {
  it("names the sale, the customer and how long ago it was sold", async () => {
    renderDialog();
    expect(await screen.findByRole("heading", { name: "Return items · INV-20261021-0007" })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("Kamal Perera");
    expect(dialog()).toHaveTextContent("Sold 2 days ago · 21 Oct 2026");
  });

  it("lists every line with its warranty status, as the server works it out (P7-22)", async () => {
    renderDialog();
    await ready();
    expect(row(PHONE)).toHaveTextContent("Within warranty until 21 Oct 2027");
    expect(row(PHONE)).toHaveTextContent("IMEI 356789012345671");
    expect(row(CASE)).toHaveTextContent("Checking only — outside warranty");
    expect(row(CHARGER)).toHaveTextContent("Within warranty until 21 Apr 2027");
    expect(row(CABLE)).toHaveTextContent("No warranty — outside warranty");
  });

  it("reads stock tracking once, for the sale's branch", async () => {
    renderDialog();
    await ready();
    expect(stockService.listStock).toHaveBeenCalledTimes(1);
    expect(stockService.listStock).toHaveBeenCalledWith({ branchId: "branch-main" });
  });

  it("where each line goes: inspection, not stock-tracked, or the cashier's choice", async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();

    expect(row(PHONE)).toHaveTextContent("Goes to inspection");
    expect(row(CABLE)).toHaveTextContent("Not stock-tracked: no stock change");
    // Back to stock / Damaged appears once the item is picked
    expect(within(row(CASE)).queryByRole("radiogroup")).not.toBeInTheDocument();
    await user.click(more(CASE));
    expect(within(row(CASE)).getByRole("radio", { name: /Back to stock/ })).toBeInTheDocument();
    expect(within(row(CASE)).getByRole("radio", { name: /Damaged/ })).toBeInTheDocument();
    expect(within(row(PHONE)).queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("another shop's line reads Not our stock, and needs no stock read", async () => {
    const sale = saleEntity({
      lines: [
        saleEntity().lines[0],
        saleLineEntity({
          id: "line-ext",
          line_number: 2,
          product_id: "p-ext-case",
          product_name_snapshot: "Leather Case (Mobile Hub)",
          external_supplier_id: "sup-mobile-hub",
        }),
      ],
    });
    renderDialog({ sale });
    await ready();
    expect(row("Leather Case \\(Mobile Hub\\)")).toHaveTextContent("Not our stock. Return it to that shop yourself.");
    expect(stockService.listStock).not.toHaveBeenCalled();
  });

  it("each stepper stops at what is left: a phone at 1, the cases at 2", async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();

    await user.click(more(PHONE));
    expect(more(PHONE)).toBeDisabled();
    await user.click(more(CASE));
    await user.click(more(CASE));
    expect(more(CASE)).toBeDisabled();
    expect(row(CASE)).toHaveAccessibleName(`${CASE}: returning 2 of 2`);
  });

  it("shows the refund due and each line's share; outside warranty asks for an override (P7-3, P7-23)", async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();
    expect(summary()).toHaveTextContent("No items picked yet");

    await user.click(more(PHONE));
    expect(summary()).toHaveTextContent(`1 item`);
    expect(summary()).toHaveTextContent(`Refund due ${lkr("63990.00")}`);
    expect(summary()).not.toHaveTextContent("Outside warranty");

    await user.click(more(CASE));
    expect(row(CASE)).toHaveTextContent(lkr("1600.00"));
    expect(summary()).toHaveTextContent(`2 items`);
    expect(summary()).toHaveTextContent(`Refund due ${lkr("65590.00")}`);
    expect(summary()).toHaveTextContent("Outside warranty: a manager's override reason is needed.");
  });

  it("a sale with an earlier return: what is left, and the lines already back", async () => {
    renderDialog({ sale: saleWithReturnsEntity() });
    await ready();
    expect(row(PHONE)).toHaveAccessibleName(`${PHONE}: already returned`);
    expect(row(PHONE)).toHaveTextContent("Already returned");
    expect(within(row(PHONE)).queryByRole("button")).not.toBeInTheDocument();
    expect(row(CASE)).toHaveTextContent("Returned 1 of 2");
    expect(row(CASE)).toHaveAccessibleName(`${CASE}: returning 0 of 1`);
  });
});

describe("ReturnDialog: Next and Back", () => {
  it("Next needs an item", async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();
    await user.click(next());
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("Pick at least one item to return");
    expect(next()).toBeInTheDocument();
  });

  it("a picked item from our stock needs Back to stock or Damaged; focus goes to its row", async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();
    await user.click(more(PHONE));
    await user.click(more(CASE));
    await user.click(next());

    expect(row(CASE)).toHaveTextContent("Back to stock or damaged?");
    expect(row(CASE)).toHaveFocus();

    await user.keyboard("b");
    expect(within(row(CASE)).getByRole("radio", { name: /Back to stock/ })).toBeChecked();
    expect(row(CASE)).not.toHaveTextContent("Back to stock or damaged?");

    await user.click(next());
    expect(within(dialog()).getByTestId("return-refund-step")).toBeInTheDocument();
  });

  it("an untracked product and a phone need no condition", async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();
    await user.click(more(PHONE));
    await user.click(more(CABLE));
    await user.click(next());
    expect(within(dialog()).getByTestId("return-refund-step")).toBeInTheDocument();
    expect(summary()).toHaveTextContent(`Refund due ${lkr("65490.00")}`);
  });

  it("Back returns to the items with every choice kept", async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();
    await user.click(more(CASE));
    await user.click(within(row(CASE)).getByRole("radio", { name: /Damaged/ }));
    await user.click(next());
    await user.click(within(dialog()).getByRole("button", { name: "Back" }));

    expect(row(CASE)).toHaveAccessibleName(`${CASE}: returning 1 of 2`);
    expect(within(row(CASE)).getByRole("radio", { name: /Damaged/ })).toBeChecked();
  });

  it("the refund step's Return items stays disabled until the reason and the approval are given", async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();
    await user.click(more(PHONE));
    await user.click(next());
    expect(within(dialog()).getByRole("button", { name: "Return items" })).toBeDisabled();
  });
});

describe("ReturnDialog: the stock-tracking read", () => {
  it("Next waits for it; the rows that depend on it show a placeholder", async () => {
    let answer;
    stockService.listStock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderDialog();
    expect(next()).toBeDisabled();
    expect(row(CABLE)).not.toHaveTextContent("Not stock-tracked");
    // A phone needs no read
    expect(row(PHONE)).toHaveTextContent("Goes to inspection");

    answer(branchStockResponse());
    await ready();
    expect(row(CABLE)).toHaveTextContent("Not stock-tracked");
  });

  it("a failed read says so and offers Try again; Next stays disabled until it works", async () => {
    const user = userEvent.setup();
    stockService.listStock.mockRejectedValueOnce(new Error("Network Error"));
    renderDialog();

    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't check which items are stock-tracked.");
    expect(next()).toBeDisabled();

    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    await ready();
    expect(stockService.listStock).toHaveBeenCalledTimes(2);
    expect(within(dialog()).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ReturnDialog: keys and focus", () => {
  it("opens on the first line with something left; ↑/↓ move, →/← change the quantity", async () => {
    const user = userEvent.setup();
    renderDialog({ sale: saleWithReturnsEntity() }); // the phone is already back
    await ready();
    await waitFor(() => expect(row(CASE)).toHaveFocus());

    await user.keyboard("{ArrowRight}");
    expect(row(CASE)).toHaveAccessibleName(`${CASE}: returning 1 of 1`);
    await user.keyboard("{ArrowRight}");
    expect(row(CASE)).toHaveAccessibleName(`${CASE}: returning 1 of 1`);

    await user.keyboard("{ArrowDown}");
    expect(row(CHARGER)).toHaveFocus();
    await user.keyboard("+");
    await user.keyboard("d");
    expect(within(row(CHARGER)).getByRole("radio", { name: /Damaged/ })).toBeChecked();
    await user.keyboard("{ArrowLeft}");
    expect(row(CHARGER)).toHaveAccessibleName(`${CHARGER}: returning 0 of 1`);

    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(row(CASE)).toHaveFocus();
  });

  it("Enter is Next", async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();
    await waitFor(() => expect(row(PHONE)).toHaveFocus());
    await user.keyboard("{ArrowRight}{Enter}");
    expect(within(dialog()).getByTestId("return-refund-step")).toBeInTheDocument();
  });

  it("Esc closes", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await ready();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ReturnDialog: the request id (P7-15)", () => {
  it("is made once per opening, and a new one on the next", async () => {
    const spy = vi.spyOn(requestId, "newClientRequestId");
    const user = userEvent.setup();
    const { rerender, onClose } = renderDialog();
    await ready();
    await user.click(more(PHONE));
    await user.click(next());
    await user.click(within(dialog()).getByRole("button", { name: "Back" }));
    expect(spy).toHaveBeenCalledTimes(1);

    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender({ open: false });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    rerender({ open: true });
    await ready();
    expect(spy).toHaveBeenCalledTimes(2);
    // a fresh form: nothing picked
    expect(summary()).toHaveTextContent("No items picked yet");
  });
});

// ---------------------------------------------------------------------------
// Step C: refund and approval
// ---------------------------------------------------------------------------

const PIN = "482915";
const refundStep = () => within(dialog()).getByTestId("return-refund-step");
const returnButton = () => within(dialog()).getByRole("button", { name: /^(Return items|Try again)$/ });
const cashAmount = () => within(within(dialog()).getByTestId("refund-row-cash")).getByLabelText("Amount (LKR)");
const cardRow = () => within(dialog()).getByTestId("refund-row-pay-card");
const total = () => within(dialog()).getByTestId("return-refund-total");
const addButton = (name) => within(dialog()).getByRole("button", { name });

/** Pick lines (name → B / D / null), then Next; waits for the approvers. */
const toRefund = async (user, picks = { [PHONE]: null, [CASE]: "b" }) => {
  await ready();
  for (const [name, key] of Object.entries(picks)) {
    await user.click(more(name));
    if (key) {
      row(name).focus();
      await user.keyboard(key);
    }
  }
  await user.click(next());
  await within(dialog()).findByRole("option", { name: "Asha Perera" });
};

/**
 * Free text goes in as one paste (the same change handler as typing):
 * typing every character made the longer tests slow under the full suite.
 */
const fill = async (user, field, text) => {
  await user.click(field);
  await user.paste(text);
};

/** Reason, detail, override (when shown), approver and PIN. */
const fillApproval = async (user, { detail = "screen flickers", override = "Case split at the seam on day two", pin = PIN } = {}) => {
  await user.click(within(dialog()).getByRole("radio", { name: "Faulty item" }));
  if (detail) await fill(user, within(dialog()).getByLabelText(/^Detail/), detail);
  const field = within(dialog()).queryByLabelText(/override reason/);
  if (field && override) await fill(user, field, override);
  await user.selectOptions(within(dialog()).getByLabelText("Approver"), "user-manager");
  if (pin) await user.type(within(dialog()).getByLabelText("Approval PIN"), pin);
};

/**
 * The fixture return's refunds: card 10,000.00 (ref REV-482913), the rest
 * in cash. Both rows are there by default (the way the sale was paid);
 * the card's reversal reference is typed.
 */
const refundToCard = async (user) => {
  await fill(user, within(cardRow()).getByLabelText("Reversal reference"), "REV-482913");
};

const cashOnlySale = () =>
  saleEntity({ payments: [paymentEntity({ id: "pay-cash", payment_method: "CASH", amount: "70290.00" })] });
/** Like INV-20261023-0002 from the dev backend: paid by card only. */
const cardOnlySale = () =>
  saleEntity({
    payments: [
      paymentEntity({ id: "pay-card", payment_method: "CARD", amount: "70290.00", reference_number: "AUTH-482913" }),
    ],
  });
const tradeInCashSale = () =>
  saleEntity({ payments: saleEntity().payments.filter((p) => p.payment_method !== "CARD").map((p) =>
    p.payment_method === "CASH" ? { ...p, amount: "30290.00", cash_received: "30300.00" } : p,
  ) });

describe("ReturnDialog: the refund step (P7-3 – P7-5)", () => {
  it("shows how the sale was paid, in the order paid", async () => {
    const user = userEvent.setup();
    renderDialog();
    await toRefund(user);
    expect(within(refundStep()).getByTestId("return-paid")).toHaveTextContent(
      `Paid: Trade-in ${lkr("40000.00")} · Card ${lkr("10000.00")} · Cash ${lkr("20290.00")}`,
    );
  });

  it("a mixed sale starts the way it was paid: the card up to its amount, the rest in cash", async () => {
    const user = userEvent.setup();
    renderDialog();
    await toRefund(user);
    expect(within(cardRow()).getByLabelText("Amount (LKR)")).toHaveValue("10000.00");
    expect(cardRow()).toHaveTextContent(`Up to ${lkr("10000.00")}`);
    expect(cashAmount()).toHaveValue("55590.00");
    await waitFor(() => expect(within(cardRow()).getByLabelText("Reversal reference")).toHaveFocus());
    expect(total()).toHaveTextContent(`Refunding ${lkr("65590.00")} of ${lkr("65590.00")} due`);
    expect(total()).toHaveTextContent(
      `Includes ${lkr("35300.00")} from a trade-in. The trade-in phone stays with the shop.`,
    );
    // The card is in the rows: no button to add it again; never a trade-in
    expect(within(dialog()).queryByRole("button", { name: /^Card \(ref/ })).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: /Trade-in/ })).not.toBeInTheDocument();
  });

  it("a cash-only sale starts with Cash at the refund due", async () => {
    const user = userEvent.setup();
    renderDialog({ sale: cashOnlySale() });
    await toRefund(user);
    expect(cashAmount()).toHaveValue("65590.00");
    expect(within(dialog()).queryByTestId("refund-row-pay-card")).not.toBeInTheDocument();
  });

  it("a card-only sale starts with the card at the refund due, no cash, its reference focused", async () => {
    const user = userEvent.setup();
    renderDialog({ sale: cardOnlySale() });
    await toRefund(user);
    expect(within(cardRow()).getByLabelText("Amount (LKR)")).toHaveValue("65590.00");
    expect(within(dialog()).queryByTestId("refund-row-cash")).not.toBeInTheDocument();
    await waitFor(() => expect(within(cardRow()).getByLabelText("Reversal reference")).toHaveFocus());
    expect(total()).toHaveTextContent(`Refunding ${lkr("65590.00")} of ${lkr("65590.00")} due`);
  });

  it("a trade-in and cash sale: everything in cash, the trade-in part named", async () => {
    const user = userEvent.setup();
    renderDialog({ sale: tradeInCashSale() });
    await toRefund(user);
    expect(cashAmount()).toHaveValue("65590.00");
    expect(total()).toHaveTextContent(`Includes ${lkr("35300.00")} from a trade-in.`);
  });

  it("removing the card gives its amount back to cash; adding it again takes it out", async () => {
    const user = userEvent.setup();
    renderDialog();
    await toRefund(user);
    await user.click(within(dialog()).getByRole("button", { name: "Remove the Card refund" }));
    expect(cashAmount()).toHaveValue("65590.00");
    expect(total()).toHaveTextContent(`Refunding ${lkr("65590.00")} of ${lkr("65590.00")} due`);
    expect(addButton(/^Card \(ref AUTH-482913\)/)).toHaveTextContent(`up to ${lkr("10000.00")}`);

    await user.click(addButton(/^Card \(ref AUTH-482913\)/));
    expect(cashAmount()).toHaveValue("55590.00");
    expect(within(cardRow()).getByLabelText("Amount (LKR)")).toHaveValue("10000.00");
  });

  it("a card-only sale: removing the card puts its amount in a new Cash row (the dev-backend case)", async () => {
    const user = userEvent.setup();
    renderDialog({ sale: cardOnlySale() });
    await toRefund(user);
    await user.click(within(dialog()).getByRole("button", { name: "Remove the Card refund" }));
    expect(cashAmount()).toHaveValue("65590.00");
    expect(total()).toHaveTextContent(`Refunding ${lkr("65590.00")} of ${lkr("65590.00")} due`);
  });

  it("an empty cash amount is no cash: the refund is lower, the detail says why, cash isn't sent", async () => {
    const user = userEvent.setup();
    salesService.createReturn.mockResolvedValue({ ...createReturnResponse(), resent: false });
    renderDialog();
    await toRefund(user);
    await refundToCard(user);
    await user.clear(cashAmount());

    expect(total()).toHaveTextContent(`Refunding ${lkr("10000.00")} of ${lkr("65590.00")} due`);
    expect(total()).toHaveTextContent(`${lkr("55590.00")} less than due: say why in the reason detail.`);
    expect(within(within(dialog()).getByTestId("refund-row-cash")).queryByText(/Enter an amount/)).not.toBeInTheDocument();
    await fillApproval(user, { detail: "Cash kept as store credit agreed" });
    expect(returnButton()).toBeEnabled();
    await user.click(returnButton());
    expect(salesService.createReturn.mock.calls[0][1].refunds).toEqual([
      { method: "CARD", amount: 10000, original_payment_id: "pay-card", reference_number: "REV-482913" },
    ]);
  });

  it("the card's cap follows the earlier returns' refunds", async () => {
    const user = userEvent.setup();
    renderDialog({ sale: saleWithReturnsEntity() }); // 10,000.00 already back to the card
    await toRefund(user, { [CASE]: "b" });
    const card = addButton(/^Card \(ref AUTH-482913\)/);
    expect(card).toHaveTextContent("nothing left to refund");
    expect(card).toBeDisabled();
  });

  it("a lower refund asks the detail to say why", async () => {
    const user = userEvent.setup();
    renderDialog();
    await toRefund(user);
    await refundToCard(user);
    await user.clear(cashAmount());
    await user.type(cashAmount(), "55000");

    expect(total()).toHaveTextContent(`${lkr("590.00")} less than due: say why in the reason detail.`);
    expect(within(dialog()).getByLabelText("Detail (required)")).toBeInTheDocument();
    await fillApproval(user, { detail: null });
    expect(returnButton()).toBeDisabled();

    await user.type(within(dialog()).getByLabelText("Detail (required)"), "Scratched, agreed 65,000");
    expect(returnButton()).toBeEnabled();
  });

  it("no refund at all: refunds is empty and the detail says why", async () => {
    const user = userEvent.setup();
    salesService.createReturn.mockResolvedValue({ ...createReturnResponse(), resent: false });
    renderDialog();
    await toRefund(user);
    // The card's amount goes back to cash, then the cash row goes
    await user.click(within(dialog()).getByRole("button", { name: "Remove the Card refund" }));
    await user.click(within(dialog()).getByRole("button", { name: "Remove the cash refund" }));
    expect(total()).toHaveTextContent(`Refunding ${lkr("0.00")} of ${lkr("65590.00")} due`);
    await fillApproval(user, { detail: "Store policy" });
    await user.click(returnButton());

    expect(salesService.createReturn.mock.calls[0][1]).toMatchObject({
      refunds: [],
      reason: "Faulty item — Store policy",
    });
  });

  it("the override reason is asked only when a line is outside warranty", async () => {
    const user = userEvent.setup();
    renderDialog();
    await toRefund(user, { [PHONE]: null });
    expect(within(dialog()).queryByTestId("return-override")).not.toBeInTheDocument();

    await user.click(within(dialog()).getByRole("button", { name: "Back" }));
    row(CASE).focus();
    await user.keyboard("{ArrowRight}b");
    await user.click(next());
    const override = within(dialog()).getByTestId("return-override");
    expect(override).toHaveTextContent("Silicone Case A15 (Checking only)");
  });

  it("1–5 pick a reason while the group has focus", async () => {
    const user = userEvent.setup();
    renderDialog();
    await toRefund(user);
    within(dialog()).getByRole("radio", { name: "Faulty item" }).focus();
    await user.keyboard("3");
    expect(within(dialog()).getByRole("radio", { name: "Changed their mind" })).toBeChecked();
  });
});

describe("ReturnDialog: sending (P7-9, P7-15)", () => {
  let idSpy;
  beforeEach(() => {
    idSpy = vi.spyOn(requestId, "newClientRequestId").mockReturnValue(CLIENT_REQUEST_ID);
  });
  afterEach(() => idSpy.mockRestore());

  const fillFixtureReturn = async (user) => {
    await toRefund(user);
    await refundToCard(user);
    await fillApproval(user);
  };

  it("sends exactly the server's body and shows what was recorded", async () => {
    const user = userEvent.setup();
    const response = createReturnResponse();
    salesService.createReturn.mockResolvedValue({ ...response, resent: false });
    const { onReturned } = renderDialog();
    await fillFixtureReturn(user);
    await user.click(returnButton());

    expect(salesService.createReturn).toHaveBeenCalledTimes(1);
    expect(salesService.createReturn).toHaveBeenCalledWith("sale-7", {
      client_request_id: CLIENT_REQUEST_ID,
      lines: [
        { sale_line_id: "line-phone", quantity: 1 },
        { sale_line_id: "line-case", quantity: 1, condition: "RESALEABLE" },
      ],
      refunds: [
        { method: "CARD", amount: 10000, original_payment_id: "pay-card", reference_number: "REV-482913" },
        { method: "CASH", amount: 55590 },
      ],
      reason: "Faulty item — screen flickers",
      override_reason: "Case split at the seam on day two",
      approval: { approver_id: "user-manager", pin: PIN },
    });

    const panel = await within(dialog()).findByTestId("return-recorded");
    expect(panel).toHaveTextContent("Return RET-20261023-0001 recorded.");
    expect(panel).toHaveTextContent("Approved by Asha Perera.");
    expect(within(panel).getByTestId("return-hand-over")).toHaveTextContent(
      `Card reversal of ${lkr("10000.00")}, ref REV-482913.Give ${lkr("55590.00")} cash.`,
    );
    expect(panel).toHaveTextContent(`Includes ${lkr("35300.00")} from a trade-in.`);
    expect(within(panel).getByTestId("return-items")).toHaveTextContent(
      `1 × ${PHONE} (IMEI 356789012345671): goes to inspection: put it aside`,
    );
    expect(panel).toHaveTextContent("Outside warranty — approved by Asha Perera: Case split at the seam on day two");
    expect(onReturned).toHaveBeenCalledWith(response.sale);
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Done" })).toHaveFocus());
  });

  it("a double click sends one POST", async () => {
    const user = userEvent.setup();
    let release;
    salesService.createReturn.mockReturnValue(new Promise((r) => (release = r)));
    renderDialog();
    await fillFixtureReturn(user);
    await user.dblClick(returnButton());
    release({ ...createReturnResponse(), resent: false });

    await within(dialog()).findByTestId("return-recorded");
    expect(salesService.createReturn).toHaveBeenCalledTimes(1);
  });

  it("a wrong PIN shows under the PIN and clears it", async () => {
    const user = userEvent.setup();
    salesService.createReturn.mockRejectedValue(wrongPinError(4));
    renderDialog();
    await fillFixtureReturn(user);
    await user.click(returnButton());

    expect(await within(dialog()).findByText("Wrong PIN. 4 attempts left.")).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Approval PIN")).toHaveValue("");
    expect(returnButton()).toBeDisabled();
    expect(salesService.getSale).not.toHaveBeenCalled();
  });

  it("the server's outside-warranty lines bring the override field, focused", async () => {
    const user = userEvent.setup();
    salesService.createReturn
      .mockRejectedValueOnce(overrideRequiredError(["line-phone"]))
      .mockResolvedValueOnce({ ...createReturnResponse(), resent: false });
    renderDialog();
    await toRefund(user, { [PHONE]: null });
    await refundToCard(user);
    await fillApproval(user, { override: null });
    await user.click(returnButton());

    const field = await within(dialog()).findByLabelText(/override reason/);
    await waitFor(() => expect(field).toHaveFocus());
    expect(within(dialog()).getByTestId("return-override")).toHaveTextContent(
      "Outside warranty: a manager or admin must give an override reason.",
    );
    await user.type(field, "Customer's day-one fault");
    await user.type(within(dialog()).getByLabelText("Approval PIN"), PIN);
    await user.click(returnButton());
    expect(salesService.createReturn.mock.calls[1][1].override_reason).toBe("Customer's day-one fault");
  });

  it("a phone traded back in links the later sale", async () => {
    const user = userEvent.setup();
    salesService.createReturn.mockRejectedValue(phoneTakenBackError("TAKEN_BACK_ON_SALE"));
    renderDialog();
    await fillFixtureReturn(user);
    await user.click(returnButton());

    const link = await within(dialog()).findByRole("link", { name: "INV-20261022-0015" });
    expect(link).toHaveAttribute("href", "/pos/sales/sale-15");
  });

  it("another return meanwhile: re-reads the sale and goes back to the items", async () => {
    const user = userEvent.setup();
    salesService.createReturn.mockRejectedValue(qtyExceededError(0));
    const fresh = saleWithReturnsEntity();
    salesService.getSale.mockResolvedValue(fresh);
    const { onSaleChanged } = renderDialog();
    await fillFixtureReturn(user);
    await user.click(returnButton());

    await waitFor(() => expect(onSaleChanged).toHaveBeenCalledWith(fresh));
    expect(next()).toBeInTheDocument();
    expect(row(CASE)).toHaveTextContent(`${CASE} has already been returned. The sale was updated.`);
  });

  it("a refusal nothing here can fix blocks Return", async () => {
    const user = userEvent.setup();
    salesService.createReturn.mockRejectedValue(returnWrongBranchError());
    renderDialog();
    await fillFixtureReturn(user);
    await user.click(returnButton());

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "You can only make returns on sales at your own branch.",
    );
    await user.type(within(dialog()).getByLabelText("Approval PIN"), PIN);
    expect(returnButton()).toBeDisabled();
  });

  it("refund errors show under Refund", async () => {
    const user = userEvent.setup();
    salesService.createReturn.mockRejectedValue(refundExceedsPaymentError("2500.00"));
    renderDialog();
    await fillFixtureReturn(user);
    await user.click(returnButton());
    expect(await within(total()).findByText(`Only ${lkr("2500.00")} can still go back to that payment.`)).toBeInTheDocument();
  });
});

describe("ReturnDialog: a lost response (P7-15)", () => {
  let idSpy;
  beforeEach(() => {
    idSpy = vi.spyOn(requestId, "newClientRequestId").mockReturnValue(CLIENT_REQUEST_ID);
  });
  afterEach(() => idSpy.mockRestore());

  const send = async (user) => {
    await toRefund(user);
    await refundToCard(user);
    await fillApproval(user);
    await user.click(returnButton());
  };

  it("found on re-read: it went through, and nothing is sent again", async () => {
    const user = userEvent.setup();
    salesService.createReturn.mockRejectedValue(returnTimeoutError());
    salesService.getSale.mockResolvedValue(saleWithReturnsEntity());
    const { onReturned } = renderDialog();
    await send(user);

    expect(await within(dialog()).findByTestId("return-recorded")).toHaveTextContent("RET-20261023-0001");
    expect(salesService.createReturn).toHaveBeenCalledTimes(1);
    expect(onReturned).toHaveBeenCalledWith(saleWithReturnsEntity());
  });

  it("not found: Try again resends the same request id, with the PIN typed again", async () => {
    const user = userEvent.setup();
    salesService.createReturn
      .mockRejectedValueOnce(returnNetworkError())
      .mockResolvedValueOnce({ ...createReturnResponse(), resent: true });
    salesService.getSale.mockResolvedValue(saleEntity());
    renderDialog();
    await send(user);

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "The return wasn't recorded. Enter the PIN again and press Try again.",
    );
    expect(returnButton()).toHaveAccessibleName("Try again");
    expect(returnButton()).toBeDisabled(); // the PIN went with the attempt
    await user.type(within(dialog()).getByLabelText("Approval PIN"), PIN);
    await user.click(returnButton());

    const panel = await within(dialog()).findByTestId("return-recorded");
    expect(panel).toHaveTextContent("This return was already recorded; nothing was added twice.");
    const [first, second] = salesService.createReturn.mock.calls;
    expect(second[1].client_request_id).toBe(CLIENT_REQUEST_ID);
    expect(second[1]).toEqual(first[1]);
  });

  it("the re-read fails too: Check again only re-reads", async () => {
    const user = userEvent.setup();
    salesService.createReturn.mockRejectedValue(returnServerError());
    salesService.getSale.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValueOnce(saleWithReturnsEntity());
    renderDialog();
    await send(user);

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "Couldn't confirm whether the return went through. Check again before trying again.",
    );
    await user.click(within(dialog()).getByRole("button", { name: "Check again" }));

    expect(await within(dialog()).findByTestId("return-recorded")).toBeInTheDocument();
    expect(salesService.createReturn).toHaveBeenCalledTimes(1);
    expect(salesService.getSale).toHaveBeenCalledTimes(2);
  });
});

describe("ReturnDialog: the return slip (P7-17)", () => {
  let idSpy;
  beforeEach(() => {
    idSpy = vi.spyOn(requestId, "newClientRequestId").mockReturnValue(CLIENT_REQUEST_ID);
  });
  afterEach(() => idSpy.mockRestore());

  const send = async (user) => {
    await toRefund(user);
    await refundToCard(user);
    await fillApproval(user);
    await user.click(returnButton());
  };
  const slipStatus = () => within(dialog()).getByTestId("return-slip-status");

  it("prints both copies on its own once the return is recorded, unmarked; Done keeps the focus", async () => {
    const user = userEvent.setup();
    const response = createReturnResponse();
    salesService.createReturn.mockResolvedValue({ ...response, resent: false });
    renderDialog();
    await send(user);

    await waitFor(() => expect(slipStatus()).toHaveTextContent("Return slip printed: the customer's copy and the shop's."));
    expect(printing.printReturnSlip).toHaveBeenCalledTimes(1);
    expect(printing.printReturnSlip).toHaveBeenCalledWith(response.sale, "ret-1");
    expect(within(dialog()).getByRole("button", { name: "Done" })).toHaveFocus();
  });

  it("a phone sent to inspection tells the header's Phones to check to read again (P7-7)", async () => {
    const user = userEvent.setup();
    const seen = [];
    const listen = (e) => seen.push(e.detail?.count);
    window.addEventListener(INSPECTION_CHANGED, listen);
    salesService.createReturn.mockResolvedValue({ ...createReturnResponse(), resent: false }); // the phone → INSPECTION
    try {
      renderDialog();
      await send(user);
      await within(dialog()).findByTestId("return-recorded");
      expect(seen).toEqual([undefined]); // no count: the header reads it again
    } finally {
      window.removeEventListener(INSPECTION_CHANGED, listen);
    }
  });

  it("says it's printing while the copies go out", async () => {
    const user = userEvent.setup();
    let release;
    printing.printReturnSlip.mockReturnValue(new Promise((r) => (release = r)));
    salesService.createReturn.mockResolvedValue({ ...createReturnResponse(), resent: false });
    renderDialog();
    await send(user);

    expect(await within(dialog()).findByText("Printing the return slip (2 copies)…")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Print again" })).not.toBeInTheDocument();
    release([160, 213]);
    expect(await within(dialog()).findByRole("button", { name: "Print again" })).toBeInTheDocument();
  });

  it("prints after a lost response found on re-read, and after a resend answered 200", async () => {
    const user = userEvent.setup();
    salesService.createReturn
      .mockRejectedValueOnce(returnTimeoutError())
      .mockResolvedValueOnce({ ...createReturnResponse(), resent: true });
    const fresh = saleWithReturnsEntity();
    salesService.getSale.mockResolvedValue(fresh);
    renderDialog();
    await send(user);

    await within(dialog()).findByTestId("return-recorded");
    expect(printing.printReturnSlip).toHaveBeenCalledWith(fresh, "ret-1");
  });

  it("a failed print says so; Print again prints both copies again, unmarked", async () => {
    const user = userEvent.setup();
    printing.printReturnSlip.mockRejectedValueOnce(new Error("print failed")).mockResolvedValueOnce([160, 213]);
    const response = createReturnResponse();
    salesService.createReturn.mockResolvedValue({ ...response, resent: false });
    renderDialog();
    await send(user);

    expect(await within(slipStatus()).findByRole("alert")).toHaveTextContent("Couldn't print the return slip.");
    await user.click(within(dialog()).getByRole("button", { name: "Print again" }));

    await waitFor(() => expect(slipStatus()).toHaveTextContent("Return slip printed"));
    expect(printing.printReturnSlip).toHaveBeenCalledTimes(2);
    expect(printing.printReturnSlip).toHaveBeenLastCalledWith(response.sale, "ret-1");
  });
});
