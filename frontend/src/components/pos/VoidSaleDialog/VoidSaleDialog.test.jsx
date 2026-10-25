import { vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import SaleDetail from "../../../pages/SaleDetail";
import RecentSales from "../../../pages/RecentSales";
import { authState, branchesState, cashDayState, renderWithProviders } from "../../../test/renderWithProviders";
import {
  BRANCH_ID,
  closedCashDayEntity,
  currentCashDayResponse,
  dayClosedError,
  dayNotOpenError,
  openCashDayEntity,
} from "../../../test/cashDayEntities";
import { GATE } from "../../../store/slices/cashDaySlice";
import * as cashDaysService from "../../../services/cashDaysService";
import { mainShop } from "../../../test/fixtures";
import { cashierSessionUser, managerSessionUser } from "../../../test/authEntities";
import { paymentEntity, saleEntity, saleLineEntity, voidedSaleEntity } from "../../../test/saleEntities";
import {
  approverRefusedError,
  approversResponse,
  boughtBackError,
  integrityConflictError,
  pinLockedError,
  resoldError,
  serverError,
  voidNetworkError,
  voidTimeoutError,
  voidWrongBranchError,
  wrongPinError,
} from "../../../test/voidEntities";
import * as salesService from "../../../services/salesService";
import * as approvalsService from "../../../services/approvalsService";

vi.mock("../../../services/salesService");
vi.mock("../../../services/approvalsService");
vi.mock("../../../services/cashDaysService");

const PIN = "482915";

const Where = () => {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
};

const renderDetail = (user = managerSessionUser()) =>
  renderWithProviders(
    <>
      <Where />
      <Routes>
        <Route path="/pos/sales" element={<p>sales list</p>} />
        <Route path="/pos/sales/:id" element={<SaleDetail />} />
      </Routes>
    </>,
    {
      route: "/pos/sales/sale-7",
      preloadedState: { auth: authState(user), branches: branchesState([mainShop]) },
    },
  );

const heading = () => screen.findByRole("heading", { name: "INV-20261021-0007" });
const dialog = () => screen.queryByRole("dialog");
const inDialog = () => within(dialog());
const voidButton = () => inDialog().getByRole("button", { name: "Void sale" });
const approver = () => inDialog().getByLabelText("Approver");
const pin = () => inDialog().getByLabelText("Approval PIN");
const where = () => screen.getByTestId("where").textContent;

const openVoid = async (user) => {
  await heading();
  await user.click(screen.getByRole("button", { name: "Void sale" }));
  await screen.findByRole("dialog");
  await inDialog().findByRole("option", { name: "Asha Perera" });
};

/** Wrong price + detail, the given approver, the PIN. */
const fillVoid = async (user, { approverId = "user-manager", p = PIN, detail = "rang 1500" } = {}) => {
  await user.click(inDialog().getByLabelText("Wrong price"));
  if (detail) await user.type(inDialog().getByLabelText(/^Detail/), detail);
  if (approverId) await user.selectOptions(approver(), approverId);
  if (p) await user.type(pin(), p);
};

let consoleSpies;

beforeEach(() => {
  vi.resetAllMocks();
  salesService.getSale.mockResolvedValue(saleEntity());
  approvalsService.listApprovers.mockResolvedValue(approversResponse());
  consoleSpies = ["log", "info", "warn", "error", "debug"].map((m) => vi.spyOn(console, m));
});

afterEach(() => {
  consoleSpies.forEach((s) => s.mockRestore());
});

const expectNoPin = (store) => {
  const everything = [
    JSON.stringify(store.getState()),
    JSON.stringify({ ...localStorage }),
    JSON.stringify({ ...sessionStorage }),
    JSON.stringify(consoleSpies.flatMap((s) => s.mock.calls.map((c) => c.map(String)))),
  ].join("\n");
  expect(everything).not.toContain(PIN);
};

describe("Void on the sale detail page (P6-8)", () => {
  it("a COMPLETED sale has Void; V opens the dialog on the reason, with Void not focused and disabled", async () => {
    const user = userEvent.setup();
    renderDetail();
    await heading();

    await user.keyboard("v");

    await screen.findByRole("dialog");
    expect(inDialog().getByRole("heading", { name: "Void INV-20261021-0007" })).toBeInTheDocument();
    await waitFor(() => expect(inDialog().getByLabelText("Customer returned the items")).toHaveFocus());
    expect(voidButton()).toBeDisabled();
    expect(voidButton()).not.toHaveFocus();
  });

  it("a VOIDED sale has no Void button, and V does nothing", async () => {
    salesService.getSale.mockResolvedValue(voidedSaleEntity());
    const user = userEvent.setup();
    renderDetail();
    await heading();

    expect(screen.queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
    await user.keyboard("v");
    expect(dialog()).not.toBeInTheDocument();
  });

  it("a cashier sees Void enabled too: the PIN is the authority", async () => {
    renderDetail(cashierSessionUser());
    await heading();
    expect(screen.getByRole("button", { name: "Void sale" })).toBeEnabled();
  });
});

describe("VoidSaleDialog: no browser autofill (P6 fix)", () => {
  it("Detail and the PIN open empty, with no hint, and opt out of password managers", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);
    await user.click(inDialog().getByLabelText("Other"));

    const detail = inDialog().getByLabelText(/^Detail/);
    expect(detail).toHaveValue("");
    expect(detail).toHaveAttribute("autocomplete", "off");
    expect(detail).toHaveAttribute("data-lpignore", "true");
    expect(detail).toHaveAttribute("data-1p-ignore");
    expect(detail).toHaveAttribute("data-form-type", "other");
    expect(detail.getAttribute("name")).not.toMatch(/user|email|login/i);

    expect(pin()).toHaveValue("");
    expect(pin()).toHaveAttribute("autocomplete", "one-time-code");
    expect(inDialog().queryByText("Digits only")).not.toBeInTheDocument();
  });

  it("a PIN filled by something other than the user is thrown away, without a hint", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);

    fireEvent.input(pin(), { target: { value: "HarnessPass1" } });

    expect(pin()).toHaveValue("");
    expect(inDialog().queryByText("Digits only")).not.toBeInTheDocument();
  });
});

describe("VoidSaleDialog: the reason (P6-9)", () => {
  it("keys 1–6 pick a preset while the reasons have focus; digits in Detail are just typed", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);
    await waitFor(() => expect(inDialog().getByLabelText("Customer returned the items")).toHaveFocus());

    await user.keyboard("3");
    expect(inDialog().getByLabelText("Wrong price")).toBeChecked();
    await user.keyboard("5");
    expect(inDialog().getByLabelText("Payment failed")).toBeChecked();

    await user.type(inDialog().getByLabelText(/^Detail/), "12");
    expect(inDialog().getByLabelText("Payment failed")).toBeChecked();
    expect(inDialog().getByLabelText(/^Detail/)).toHaveValue("12");
  });

  it("Other needs a detail of at least 3 characters before Void is enabled", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);

    await user.click(inDialog().getByLabelText("Other"));
    await user.selectOptions(approver(), "user-manager");
    await user.type(pin(), PIN);
    expect(inDialog().getByText("Detail (required)")).toBeInTheDocument();
    expect(voidButton()).toBeDisabled();

    await user.type(inDialog().getByLabelText(/^Detail/), "Test sale");
    await waitFor(() => expect(voidButton()).toBeEnabled());
  });
});

describe("VoidSaleDialog: what the void does and what to hand back (P6-10, P6-12)", () => {
  it("lists stock, phones, the trade-in leaving, cash and the card to reverse", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);

    const effects = inDialog().getByTestId("void-effects");
    expect(effects).toHaveTextContent("5 items go back to stock.");
    expect(effects).toHaveTextContent("Phones back in stock: IMEI 356789012345671.");
    expect(effects).toHaveTextContent(
      "Trade-in phone goes back to the customer: Used iPhone 12 128GB · IMEI 354789102345678. Take it off the shelf.",
    );
    const giveBack = inDialog().getByTestId("void-give-back");
    expect(giveBack).toHaveTextContent(/LKR\s20,290\.00 cash\./);
    expect(giveBack).toHaveTextContent(/Reverse the Card payment of LKR\s10,000\.00 \(ref AUTH-482913\)\./);
    expect(dialog()).toHaveTextContent(
      "A void doesn't record a refund. Give the money back as listed. If the customer is returning items, close this and use Return items instead.",
    );
  });

  it("puts Hand back first, above what the void does to stock", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);

    const headings = within(inDialog().getByTestId("void-summary")).getAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(["Hand back, outside the system", "What the void does"]);
    const giveBack = inDialog().getByTestId("void-give-back");
    const effects = inDialog().getByTestId("void-effects");
    expect(giveBack.compareDocumentPosition(effects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says plainly that items from another shop aren't added to our stock", async () => {
    salesService.getSale.mockResolvedValue(
      saleEntity({
        lines: [
          saleLineEntity({ id: "own", quantity: 1 }),
          saleLineEntity({ id: "theirs", quantity: 2, external_supplier_id: "sup-1" }),
        ],
        payments: [paymentEntity({ id: "c", payment_method: "CASH", amount: "4500.00", cash_received: "5000.00" })],
      }),
    );
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);

    const effects = inDialog().getByTestId("void-effects");
    expect(effects).toHaveTextContent("1 item goes back to stock.");
    expect(effects).toHaveTextContent(
      "2 items from another shop: not added to our stock. Return them to that shop yourself.",
    );
    expect(effects).not.toHaveTextContent("supplier");
  });
});

describe("VoidSaleDialog: the approver (P6-20)", () => {
  it("fetches the sale branch's approvers fresh every time it opens", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);
    expect(approvalsService.listApprovers).toHaveBeenCalledWith("branch-main");

    await user.click(inDialog().getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    // A manager sets a PIN meanwhile
    approvalsService.listApprovers.mockResolvedValue([
      ...approversResponse(),
      { id: "user-mgr2", full_name: "Dilini Jayasuriya" },
    ]);
    await user.click(screen.getByRole("button", { name: "Void sale" }));
    await screen.findByRole("dialog");

    expect(await inDialog().findByRole("option", { name: "Dilini Jayasuriya" })).toBeInTheDocument();
    expect(approvalsService.listApprovers).toHaveBeenCalledTimes(2);
  });

  it("defaults to the session's manager when they're on the list", async () => {
    const user = userEvent.setup();
    renderDetail(managerSessionUser());
    await openVoid(user);

    await waitFor(() => expect(approver()).toHaveValue("user-manager"));
  });

  it("picks nobody on a cashier's session", async () => {
    const user = userEvent.setup();
    renderDetail(cashierSessionUser());
    await openVoid(user);

    expect(approver()).toHaveValue("");
  });

  it("tells a manager without a PIN to set one or pick another approver", async () => {
    const user = userEvent.setup();
    renderDetail(managerSessionUser({ id: "user-mgr-nopin", full_name: "Kasun Silva" }));
    await openVoid(user);

    expect(approver()).toHaveValue("");
    expect(dialog()).toHaveTextContent(
      "Set your approval PIN first (user menu → Approval PIN), or pick another approver.",
    );
  });

  it("with nobody to approve, says how to set a PIN, and Void stays disabled", async () => {
    approvalsService.listApprovers.mockResolvedValue([]);
    const user = userEvent.setup();
    renderDetail();
    await heading();
    await user.click(screen.getByRole("button", { name: "Void sale" }));
    await screen.findByRole("dialog");

    expect(await inDialog().findByText(
      "No manager has set an approval PIN yet. A manager sets it from the user menu → Approval PIN.",
    )).toBeInTheDocument();
    await user.click(inDialog().getByLabelText("Wrong price"));
    expect(approver()).toBeDisabled();
    expect(voidButton()).toBeDisabled();
  });

  it("a failed approver list offers Retry", async () => {
    approvalsService.listApprovers.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue(approversResponse());
    const user = userEvent.setup();
    renderDetail();
    await heading();
    await user.click(screen.getByRole("button", { name: "Void sale" }));
    await screen.findByRole("dialog");

    await user.click(await inDialog().findByRole("button", { name: "Retry" }));

    expect(await inDialog().findByRole("option", { name: "Asha Perera" })).toBeInTheDocument();
  });
});

describe("VoidSaleDialog: voiding", () => {
  it("sends one POST with the reason and approval, then shows the voided sale and focuses Reprint", async () => {
    salesService.voidSale.mockResolvedValue(voidedSaleEntity());
    const user = userEvent.setup();
    const { store } = renderDetail();
    await openVoid(user);
    await fillVoid(user);

    await user.click(voidButton());

    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(salesService.voidSale).toHaveBeenCalledTimes(1);
    expect(salesService.voidSale).toHaveBeenCalledWith("sale-7", {
      void_reason: "Wrong price — rang 1500",
      approval: { approver_id: "user-manager", pin: PIN },
    });
    expect(screen.getByRole("region", { name: "Voided" })).toHaveTextContent("Approved by Asha Perera");
    expect(screen.queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Reprint receipt/ })).toHaveFocus());
    expectNoPin(store);
  });

  it("a cashier's session voids with a manager picked as approver", async () => {
    salesService.voidSale.mockResolvedValue(voidedSaleEntity());
    const user = userEvent.setup();
    renderDetail(cashierSessionUser());
    await openVoid(user);
    await fillVoid(user, { approverId: "user-manager" });

    await user.keyboard("{Enter}");

    await waitFor(() => expect(salesService.voidSale).toHaveBeenCalledTimes(1));
    expect(salesService.voidSale.mock.calls[0][1].approval).toEqual({ approver_id: "user-manager", pin: PIN });
  });

  it("a double click on Void sends exactly one POST", async () => {
    let finish;
    salesService.voidSale.mockImplementation(() => new Promise((r) => { finish = r; }));
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);
    await fillVoid(user);

    await user.dblClick(voidButton());
    fireEvent.click(voidButton());

    expect(salesService.voidSale).toHaveBeenCalledTimes(1);
    expect(voidButton()).toBeDisabled();
    await act(async () => finish(voidedSaleEntity()));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(salesService.voidSale).toHaveBeenCalledTimes(1);
  });

  it("Enter pressed twice quickly sends exactly one POST", async () => {
    let finish;
    salesService.voidSale.mockImplementation(() => new Promise((r) => { finish = r; }));
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);
    await fillVoid(user);

    fireEvent.keyDown(pin(), { key: "Enter" });
    fireEvent.keyDown(pin(), { key: "Enter" });
    await user.keyboard("{Enter}");

    expect(salesService.voidSale).toHaveBeenCalledTimes(1);
    await act(async () => finish(voidedSaleEntity()));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(salesService.voidSale).toHaveBeenCalledTimes(1);
  });

  it("Esc doesn't close it while voiding", async () => {
    let finish;
    salesService.voidSale.mockImplementation(() => new Promise((r) => { finish = r; }));
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);
    await fillVoid(user);
    await user.click(voidButton());

    await user.keyboard("{Escape}");

    expect(dialog()).toBeInTheDocument();
    await act(async () => finish(voidedSaleEntity()));
  });
});

describe("VoidSaleDialog: errors in the dialog (P6-11, P6-19, P6-22)", () => {
  const voidWith = async (user, error, fill = {}) => {
    salesService.voidSale.mockRejectedValueOnce(error);
    await fillVoid(user, fill);
    await user.click(voidButton());
  };

  it("WRONG_PIN: under the PIN, the PIN cleared, then a correct PIN goes through", async () => {
    const user = userEvent.setup();
    const { store } = renderDetail();
    await openVoid(user);

    await voidWith(user, wrongPinError(4));

    expect(await inDialog().findByText("Wrong PIN. 4 attempts left.")).toBeInTheDocument();
    expect(pin()).toHaveValue("");
    expect(pin()).toHaveAttribute("aria-invalid", "true");
    expectNoPin(store);

    salesService.voidSale.mockResolvedValueOnce(voidedSaleEntity());
    await user.type(pin(), PIN);
    await user.click(voidButton());
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(salesService.voidSale).toHaveBeenCalledTimes(2);
  });

  it("PIN_LOCKED: the unlock time and what to do instead", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);

    await voidWith(user, pinLockedError());

    expect(await inDialog().findByText(
      "Asha Perera's PIN is locked until 2:32 PM. Another manager can approve, or an admin can clear the PIN.",
    )).toBeInTheDocument();
    expect(pin()).toHaveValue("");
  });

  it("APPROVER_NO_PIN for yourself: set your PIN first, under the approver", async () => {
    const user = userEvent.setup();
    renderDetail(managerSessionUser());
    await openVoid(user);

    await voidWith(user, approverRefusedError("APPROVER_NO_PIN"), { approverId: "user-manager" });

    expect(await inDialog().findByText(
      "Set your approval PIN first (user menu → Approval PIN), or pick another approver.",
    )).toBeInTheDocument();
    expect(approver()).toHaveAttribute("aria-invalid", "true");
  });

  it("another approver refusal shows the server's message under the approver", async () => {
    const user = userEvent.setup();
    renderDetail(cashierSessionUser());
    await openVoid(user);

    await voidWith(user, approverRefusedError("APPROVER_WRONG_BRANCH"));

    expect(await inDialog().findByText("Asha Perera can only approve for their own branch.")).toBeInTheDocument();
  });

  it("VOID_WRONG_BRANCH: an alert, and Void stays disabled", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);

    await voidWith(user, voidWrongBranchError());

    expect(await inDialog().findByRole("alert")).toHaveTextContent("You can only void sales at your own branch.");
    await user.type(pin(), PIN);
    expect(voidButton()).toBeDisabled();
  });

  it("RESOLD: names the later sale, and its link opens it", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);

    await voidWith(user, resoldError());

    const alert = await inDialog().findByRole("alert");
    expect(alert).toHaveTextContent(
      "The trade-in phone (IMEI 354789102345678) was sold on INV-20261022-0012. Void that sale first.",
    );
    salesService.getSale.mockResolvedValue(saleEntity({ id: "sale-12", sale_number: "INV-20261022-0012" }));
    await user.click(within(alert).getByRole("link", { name: "INV-20261022-0012" }));

    await waitFor(() => expect(where()).toBe("/pos/sales/sale-12"));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
  });

  it("BOUGHT_BACK_ON_PURCHASE: can't be voided, Void stays disabled", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);

    await voidWith(user, boughtBackError());

    expect(await inDialog().findByRole("alert")).toHaveTextContent(
      "This sale can't be voided: the phone (IMEI 356789012345671) was bought back on a later purchase.",
    );
    await user.type(pin(), PIN);
    expect(voidButton()).toBeDisabled();
  });

  it("the integrity 409: nothing was changed", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);

    await voidWith(user, integrityConflictError());

    expect(await inDialog().findByRole("alert")).toHaveTextContent("Couldn't void. Nothing was changed.");
  });
});

describe("VoidSaleDialog: today isn't open (P9-9, C10, C11)", () => {
  // The sale detail with the gate's last answer: today open.
  const renderOpenDay = () =>
    renderWithProviders(
      <Routes>
        <Route path="/pos/sales/:id" element={<SaleDetail />} />
      </Routes>,
      {
        route: "/pos/sales/sale-7",
        preloadedState: {
          auth: authState(managerSessionUser()),
          branches: branchesState([mainShop]),
          cashDay: cashDayState({
            branchId: BRANCH_ID,
            current: { status: GATE.OPEN, businessDate: "2026-10-20", today: openCashDayEntity() },
          }),
        },
      },
    );

  const refuse = async (user, error) => {
    salesService.voidSale.mockRejectedValueOnce(error);
    await fillVoid(user);
    await user.click(voidButton());
  };

  it("DAY_CLOSED: the date, nothing changed, no PIN attempt; PIN cleared; only Close, focused; never resent or re-read yet", async () => {
    const user = userEvent.setup();
    const { store } = renderOpenDay();
    await openVoid(user);

    await refuse(user, dayClosedError());

    const alert = await inDialog().findByRole("alert");
    expect(alert).toHaveTextContent(
      "Tue 20 Oct 2026 is closed: no voids until tomorrow's opening. Nothing was changed and no PIN attempt was used.",
    );
    expect(dialog()).not.toHaveTextContent("2026-10-20");
    expect(pin()).toHaveValue("");
    await waitFor(() => expect(inDialog().getByRole("button", { name: "Close" })).toHaveFocus());
    expect(inDialog().queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
    expect(inDialog().queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(cashDaysService.getCurrentCashDay).not.toHaveBeenCalled();
    expect(salesService.voidSale).toHaveBeenCalledTimes(1);
    // No re-read of the sale either: nothing changed.
    expect(salesService.getSale).toHaveBeenCalledTimes(1);
    expectNoPin(store);
  });

  it("Close re-reads the gate: the page stays without Void and Return items, and focus goes to Reprint", async () => {
    const user = userEvent.setup();
    cashDaysService.getCurrentCashDay.mockResolvedValue(currentCashDayResponse({ today: closedCashDayEntity() }));
    renderOpenDay();
    await openVoid(user);
    await refuse(user, dayClosedError());

    await user.click(await inDialog().findByRole("button", { name: "Close" }));

    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(cashDaysService.getCurrentCashDay).toHaveBeenCalledWith(BRANCH_ID);
    expect(await screen.findByTestId("day-closed-note")).toHaveTextContent(
      "Today is closed: no voids or returns until tomorrow's opening.",
    );
    expect(screen.queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Return items" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reprint receipt" })).toHaveFocus());
    expect(salesService.voidSale).toHaveBeenCalledTimes(1);
  });

  it("DAY_NOT_OPEN: open the day, then void; only Close", async () => {
    const user = userEvent.setup();
    renderOpenDay();
    await openVoid(user);

    await refuse(user, dayNotOpenError());

    expect(await inDialog().findByRole("alert")).toHaveTextContent(
      "Tue 20 Oct 2026 hasn't been opened yet. Nothing was changed and no PIN attempt was used. Enter the opening balance, then void the sale.",
    );
    await waitFor(() => expect(inDialog().getByRole("button", { name: "Close" })).toHaveFocus());
  });
});

describe("VoidSaleDialog: no answer — re-read, never resend (P6-11)", () => {
  it("a timeout, then the sale reads VOIDED: done, with one POST", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);
    salesService.voidSale.mockRejectedValueOnce(voidTimeoutError());
    salesService.getSale.mockResolvedValue(voidedSaleEntity());
    await fillVoid(user);

    await user.click(voidButton());

    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Voided" })).toBeInTheDocument();
    expect(salesService.voidSale).toHaveBeenCalledTimes(1);
  });

  it("a 500, then the sale is still COMPLETED: nothing was voided, PIN cleared, one POST", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);
    salesService.voidSale.mockRejectedValueOnce(serverError());
    await fillVoid(user);

    await user.click(voidButton());

    expect(await inDialog().findByRole("alert")).toHaveTextContent(
      "Couldn't void: no answer from the server. Nothing was voided; try again.",
    );
    expect(pin()).toHaveValue("");
    expect(salesService.voidSale).toHaveBeenCalledTimes(1);
  });

  it("no answer and the re-read fails too: Check again re-reads only, never resends", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);
    salesService.voidSale.mockRejectedValueOnce(voidNetworkError());
    salesService.getSale.mockRejectedValueOnce(new Error("Network Error"));
    await fillVoid(user);

    await user.click(voidButton());

    expect(await inDialog().findByRole("alert")).toHaveTextContent(
      "Couldn't confirm whether the sale was voided. Check again before trying again.",
    );
    expect(inDialog().queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
    salesService.getSale.mockResolvedValue(voidedSaleEntity());
    await user.click(inDialog().getByRole("button", { name: "Check again" }));

    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(salesService.voidSale).toHaveBeenCalledTimes(1);
  });
});

describe("VoidSaleDialog: closing", () => {
  it("Cancel clears the PIN: reopening starts empty, and focus returns to Void", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openVoid(user);
    await fillVoid(user);

    await user.click(inDialog().getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Void sale" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Void sale" }));
    await screen.findByRole("dialog");

    expect(pin()).toHaveValue("");
    expect(inDialog().getByLabelText("Wrong price")).not.toBeChecked();
  });
});

describe("Back on the list after a void (P6-13)", () => {
  it("the row re-reads with the Voided badge", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T10:00:00.000Z"));
    const row = (status) => ({ ...saleEntity(), status, lines: undefined, payments: undefined });
    salesService.listSales
      .mockResolvedValueOnce({ data: [row("COMPLETED")], meta: { total: 1 } })
      .mockResolvedValueOnce({ data: [row("VOIDED")], meta: { total: 1 } });
    salesService.voidSale.mockResolvedValue(voidedSaleEntity());
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/pos/sales" element={<RecentSales />} />
        <Route path="/pos/sales/:id" element={<SaleDetail />} />
      </Routes>,
      { route: "/pos/sales", preloadedState: { auth: authState(managerSessionUser()), branches: branchesState([mainShop]) } },
    );
    const table = () => screen.getByRole("table");
    await waitFor(() => within(table()).getByText("INV-20261021-0007"));
    expect(within(table()).queryByText("Voided")).not.toBeInTheDocument();

    await user.keyboard("{Enter}");
    await openVoid(user);
    await fillVoid(user);
    await user.click(voidButton());
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await user.keyboard("{Escape}");

    await waitFor(() => expect(within(table()).getAllByText("Voided").length).toBeGreaterThan(0));
    vi.useRealTimers();
  });
});
