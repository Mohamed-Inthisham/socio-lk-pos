import { vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OpenDayDialog from "./index";
import * as cashDaysService from "../../../services/cashDaysService";
import { cashDayState, renderWithProviders } from "../../../test/renderWithProviders";
import {
  BRANCH_ID,
  cashDayNetworkError,
  cashDayRequestIdConflictError,
  cashDayTimeoutError,
  cashDayValidationError,
  cashDayWrongBranchError,
  currentCashDayResponse,
  openCashDayEntity,
} from "../../../test/cashDayEntities";

vi.mock("../../../services/cashDaysService");

// formatLKR puts a no-break space (U+00A0) between "LKR" and the amount.
const LKR = `LKR${String.fromCharCode(0xa0)}`;

const deferred = () => {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const renderDialog = (props = {}) =>
  renderWithProviders(
    <OpenDayDialog
      branchId={BRANCH_ID}
      branchName="Main Shop"
      businessDate="2026-10-24"
      lastClosed={{ business_date: "2026-10-23", counted_balance: "15400.00" }}
      {...props}
    />,
    { preloadedState: { cashDay: cashDayState({ branchId: BRANCH_ID, current: { status: "no_day" } }) } },
  );

const amount = () => screen.getByRole("textbox", { name: "Cash in the box" });
const submit = () => screen.getByRole("button", { name: /Open day|Opening…|Try again/ });
const sentBodies = () => cashDaysService.openCashDay.mock.calls.map(([body]) => body);

beforeEach(() => {
  vi.resetAllMocks();
  cashDaysService.getCurrentCashDay.mockResolvedValue(
    currentCashDayResponse({ business_date: "2026-10-24", today: openCashDayEntity() }),
  );
});

describe("OpenDayDialog (P9-7, P9-8)", () => {
  it("is a non-modal dialog naming the day and branch, with the amount blank and focused", async () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Open the day" });
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(dialog).toHaveTextContent("Sat 24 Oct 2026 · Main Shop");
    expect(amount()).toHaveValue("");
    await waitFor(() => expect(amount()).toHaveFocus());
    expect(amount()).toHaveAttribute("inputmode", "decimal");
    expect(screen.queryByRole("button", { name: /close|cancel/i })).not.toBeInTheDocument();
  });

  it("says what yesterday closed with", () => {
    renderDialog();
    // textContent, not toHaveTextContent: that one turns the no-break space into a space.
    expect(screen.getByTestId("last-closed").textContent).toBe(`Yesterday closed with ${LKR}15,400.00`);
  });

  it("names the day when the last closed day wasn't yesterday", () => {
    renderDialog({ lastClosed: { business_date: "2026-10-23", counted_balance: "15400.00" }, businessDate: "2026-10-26" });
    expect(screen.getByTestId("last-closed").textContent).toBe(`Fri 23 Oct closed with ${LKR}15,400.00`);
  });

  it("has no line when no day was ever closed", () => {
    renderDialog({ lastClosed: null });
    expect(screen.queryByTestId("last-closed")).not.toBeInTheDocument();
  });

  it("checks the amount before sending: blank, separators, three decimals", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(submit());
    expect(await screen.findByText("Enter the cash in the box")).toBeInTheDocument();

    await user.type(amount(), "5,000");
    await user.click(submit());
    expect(await screen.findByText("Enter an amount like 5000 or 5000.50")).toBeInTheDocument();

    await user.clear(amount());
    await user.type(amount(), "5000.505");
    await user.click(submit());
    expect(await screen.findByText("Enter an amount like 5000 or 5000.50")).toBeInTheDocument();
    expect(cashDaysService.openCashDay).not.toHaveBeenCalled();
  });

  it("opens with 0 (an empty box)", async () => {
    const user = userEvent.setup();
    cashDaysService.openCashDay.mockResolvedValue(openCashDayEntity({ opening_balance: "0.00" }));
    renderDialog();

    await user.type(amount(), "0");
    await user.click(submit());

    await waitFor(() => expect(cashDaysService.openCashDay).toHaveBeenCalledTimes(1));
    expect(sentBodies()[0].opening_balance).toBe(0);
  });

  it("sends whole rupees or cents as a number with the dialog's request id; Enter submits", async () => {
    const user = userEvent.setup();
    cashDaysService.openCashDay.mockResolvedValue(openCashDayEntity({ opening_balance: "5000.50" }));
    const { store } = renderDialog();

    await user.type(amount(), "5000.50{Enter}");

    await waitFor(() => expect(cashDaysService.openCashDay).toHaveBeenCalledTimes(1));
    expect(sentBodies()[0]).toEqual({
      branch_id: BRANCH_ID,
      opening_balance: 5000.5,
      client_request_id: store.getState().cashDay.open.clientRequestId,
    });
  });

  it("is busy while opening, and a second Enter sends nothing", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    cashDaysService.openCashDay.mockReturnValue(pending.promise);
    renderDialog();

    await user.type(amount(), "5000{Enter}");
    expect(await screen.findByRole("button", { name: "Opening…" })).toBeDisabled();
    expect(amount()).toHaveAttribute("readonly");
    fireEvent.submit(amount().closest("form"));
    expect(cashDaysService.openCashDay).toHaveBeenCalledTimes(1);

    pending.resolve(openCashDayEntity());
    await waitFor(() => expect(screen.getByRole("button", { name: "Open day" })).toBeEnabled());
  });

  it("shows the server's C1 under the field, and typing clears it", async () => {
    const user = userEvent.setup();
    cashDaysService.openCashDay.mockRejectedValue(cashDayValidationError());
    renderDialog();

    await user.type(amount(), "5000{Enter}");
    expect(await screen.findByText("Enter an amount of 0 or more, with at most 2 decimals.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.type(amount(), "1");
    expect(screen.queryByText("Enter an amount of 0 or more, with at most 2 decimals.")).not.toBeInTheDocument();
  });

  it.each([
    ["C2", cashDayWrongBranchError, "You can only open, close and view cash days at your own branch."],
    ["C3", cashDayRequestIdConflictError, "This opening can't be sent. Close it and open the day again."],
  ])("shows %s in the alert", async (_, makeError, message) => {
    const user = userEvent.setup();
    cashDaysService.openCashDay.mockRejectedValue(makeError());
    renderDialog();

    await user.type(amount(), "5000{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("after a lost answer the amount is locked and only Try again is offered, resending the same id and amount", async () => {
    const user = userEvent.setup();
    cashDaysService.openCashDay.mockRejectedValueOnce(cashDayTimeoutError());
    cashDaysService.getCurrentCashDay.mockResolvedValueOnce(currentCashDayResponse({ business_date: "2026-10-24" }));
    renderDialog();

    await user.type(amount(), "5000{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("The day wasn't opened. Try again.");
    expect(amount()).toHaveAttribute("readonly");
    await user.type(amount(), "9");
    expect(amount()).toHaveValue("5000");

    cashDaysService.openCashDay.mockResolvedValueOnce(openCashDayEntity());
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(cashDaysService.openCashDay).toHaveBeenCalledTimes(2));
    const [first, second] = sentBodies();
    expect(second).toEqual(first);
  });

  it("while unconfirmed the amount looks locked but stays focusable and readable (readonly, not disabled)", async () => {
    const user = userEvent.setup();
    cashDaysService.openCashDay.mockRejectedValueOnce(cashDayTimeoutError());
    cashDaysService.getCurrentCashDay.mockResolvedValueOnce(currentCashDayResponse({ business_date: "2026-10-24" }));
    renderDialog();
    expect(amount().parentElement).not.toHaveClass("cursor-not-allowed");

    await user.type(amount(), "5000{Enter}");
    await screen.findByRole("button", { name: "Try again" });

    expect(amount()).toHaveAttribute("readonly");
    expect(amount()).not.toBeDisabled();
    expect(amount()).toHaveClass("cursor-not-allowed");
    expect(amount().parentElement).toHaveClass("opacity-60", "cursor-not-allowed");
    amount().focus();
    expect(amount()).toHaveFocus();
    expect(amount()).toHaveAccessibleName("Cash in the box");
    expect(amount()).toHaveValue("5000");
  });

  it("after a lost answer and a failed re-read, says to check the connection", async () => {
    const user = userEvent.setup();
    cashDaysService.openCashDay.mockRejectedValueOnce(cashDayNetworkError());
    cashDaysService.getCurrentCashDay.mockRejectedValueOnce(cashDayNetworkError());
    renderDialog();

    await user.type(amount(), "5000{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't reach the server. Check the connection and try again.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("can't be dismissed: Escape does nothing", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(amount(), "50");
    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog", { name: "Open the day" })).toBeInTheDocument();
    expect(amount()).toHaveValue("50");
  });

  it("makes a new request id each time it is shown", () => {
    const first = renderDialog();
    const firstId = first.store.getState().cashDay.open.clientRequestId;
    first.unmount();

    const second = renderDialog();
    expect(firstId).toBeTruthy();
    expect(second.store.getState().cashDay.open.clientRequestId).not.toBe(firstId);
  });
});
