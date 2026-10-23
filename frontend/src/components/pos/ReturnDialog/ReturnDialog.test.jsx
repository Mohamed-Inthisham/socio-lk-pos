import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReturnDialog from ".";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { saleEntity, saleLineEntity } from "../../../test/saleEntities";
import { branchStockResponse, saleWithReturnsEntity } from "../../../test/returnEntities";
import * as stockService from "../../../services/stockService";
import * as requestId from "../../../utils/requestId";
import { formatLKR } from "../../../utils/money";

// formatLKR puts a no-break space after LKR; toHaveTextContent folds it to a space.
const lkr = (value) => formatLKR(value).replace(/\s/g, " ");

vi.mock("../../../services/stockService");

// 10:30 on Fri 23 Oct 2026 in Colombo; saleEntity was completed on the 21st.
const NOW = new Date("2026-10-23T05:00:00.000Z");

const renderDialog = ({ sale = saleEntity(), open = true } = {}) => {
  const onClose = vi.fn();
  const view = renderWithProviders(<ReturnDialog open={open} onClose={onClose} sale={sale} />);
  const rerender = (props) =>
    view.rerender(<ReturnDialog open={props.open} onClose={onClose} sale={props.sale ?? sale} />);
  return { ...view, onClose, rerender };
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

  it("the refund step's Return items stays disabled until step C", async () => {
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
