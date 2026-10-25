import { vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CloseDayDialog from "./index";
import * as cashDaysService from "../../../services/cashDaysService";
import { beginCloseDay, fetchCloseSummary } from "../../../store/slices/cashDaySlice";
import {
  authState,
  branchesState,
  cashDayState,
  posTerminalState,
  renderWithProviders,
} from "../../../test/renderWithProviders";
import { cashierUser, mainShop } from "../../../test/fixtures";
import {
  BRANCH_ID,
  cashDaySummaryEntity,
  cashDayTimeoutError,
  closedCashDayEntity,
  currentCashDayResponse,
  dayAlreadyClosedError,
  expectedChangedError,
  openCashDayEntity,
  reasonRequiredError,
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

const todayOpen = { status: "open", businessDate: "2026-10-20", today: openCashDayEntity() };

const renderDialog = async ({
  summary = cashDaySummaryEntity(),
  current = todayOpen,
  dayId = "day-1020",
  lines = [],
  summaryReply,
  summaryFails = false,
} = {}) => {
  if (summaryFails) cashDaysService.getCashDaySummary.mockRejectedValueOnce(cashDayTimeoutError());
  else if (summaryReply) cashDaysService.getCashDaySummary.mockReturnValueOnce(summaryReply);
  else cashDaysService.getCashDaySummary.mockResolvedValue(summary);
  const utils = renderWithProviders(<CloseDayDialog />, {
    preloadedState: {
      auth: authState(cashierUser),
      branches: branchesState([mainShop]),
      cashDay: cashDayState({ branchId: BRANCH_ID, current }),
      posTerminal: posTerminalState({
        draftSale: { id: "sale-1", status: "DRAFT", branch_id: BRANCH_ID, lines, payments: [], total: "0.00" },
      }),
    },
  });
  act(() => {
    utils.store.dispatch(beginCloseDay(dayId));
  });
  if (!summaryReply) {
    await act(() => utils.store.dispatch(fetchCloseSummary({ dayId })));
  } else {
    act(() => {
      utils.store.dispatch(fetchCloseSummary({ dayId }));
    });
  }
  return utils;
};

const dialog = () => screen.getByRole("dialog");
const counted = () => screen.getByRole("textbox", { name: "Counted cash" });
const reasonBox = () => screen.queryByRole("textbox", { name: "Reason for the difference" });
const difference = () => screen.getByTestId("figure-difference").textContent;
const bodies = () => cashDaysService.closeCashDay.mock.calls.map(([, body]) => body);

/** Type the count (and a reason), go to Confirm and press Close day. */
const countAndClose = async (user, count, reason) => {
  await user.type(counted(), count);
  if (reason) await user.type(reasonBox(), reason);
  // Enter in the reason box is a newline, so go on with the button.
  await user.click(screen.getByRole("button", { name: "Close day" }));
  await user.click(await screen.findByRole("button", { name: "Close day" }));
};

beforeEach(() => {
  vi.resetAllMocks();
  cashDaysService.getCurrentCashDay.mockResolvedValue(currentCashDayResponse({ today: closedCashDayEntity() }));
});

describe("CloseDayDialog: count (P9-11)", () => {
  it("loads the figures, then shows them from the start with the count focused", async () => {
    const figures = deferred();
    await renderDialog({ summaryReply: figures.promise });

    expect(await screen.findByRole("dialog", { name: "Close the day" })).toHaveTextContent("Loading the day's figures…");
    await act(async () => figures.resolve(cashDaySummaryEntity()));

    expect(screen.getByTestId("figure-expected").textContent).toBe(`${LKR}15,500.00`);
    expect(screen.getByText("Earlier sales voided (cash back)")).toBeInTheDocument();
    expect(difference()).toBe("—");
    await waitFor(() => expect(counted()).toHaveFocus());
  });

  it("a failed figures read says so, and Try again reads again", async () => {
    const user = userEvent.setup();
    await renderDialog({ summaryFails: true });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load the day's figures. Check the connection and try again.",
    );
    cashDaysService.getCashDaySummary.mockResolvedValue(cashDaySummaryEntity());
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("figure-expected")).toBeInTheDocument();
  });

  it.each([
    ["15500", "Exact", false],
    ["15499.50", `Rounding ${LKR}0.50`, false],
    ["15500.99", `Rounding ${LKR}0.99`, false],
    ["15400", `Short ${LKR}100.00`, true],
    ["15501", `Over ${LKR}1.00`, true],
  ])("counted %s: %s, reason box %s", async (count, words, box) => {
    const user = userEvent.setup();
    await renderDialog();

    await user.type(counted(), count);

    expect(difference()).toBe(words);
    expect(!!reasonBox()).toBe(box);
  });

  it("checks the count and, from 1.00, the reason before going on", async () => {
    const user = userEvent.setup();
    await renderDialog();

    await user.keyboard("{Enter}");
    expect(await screen.findByText("Enter the cash counted in the box")).toBeInTheDocument();

    await user.type(counted(), "15400{Enter}");
    expect(await screen.findByText("Give a reason for the difference (at least 3 characters)")).toBeInTheDocument();
    expect(screen.queryByTestId("close-day-final")).not.toBeInTheDocument();
  });

  it("warns and disables closing for the open sale, counting quantities", async () => {
    await renderDialog({ lines: [{ id: "l1", quantity: 2 }, { id: "l2", quantity: 1 }] });
    expect(screen.getByTestId("cart-warning")).toHaveTextContent(
      "There is an unfinished sale with 3 items. Complete or discard it before closing the day.",
    );
    expect(screen.getByRole("button", { name: "Close day" })).toBeDisabled();
  });

  it("says 1 item for one", async () => {
    await renderDialog({ lines: [{ id: "l1", quantity: 1 }] });
    expect(screen.getByTestId("cart-warning")).toHaveTextContent(
      "There is an unfinished sale with 1 item. Complete or discard it before closing the day.",
    );
  });

  it("has no warning with an empty cart", async () => {
    await renderDialog();
    expect(screen.queryByTestId("cart-warning")).not.toBeInTheDocument();
  });

  it("Esc cancels without sending anything", async () => {
    const user = userEvent.setup();
    const { store } = await renderDialog();
    await user.type(counted(), "15500");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(store.getState().cashDay.close.dayId).toBeNull());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cashDaysService.closeCashDay).not.toHaveBeenCalled();
  });

  it("an earlier day: titled with its date, and no cart warning", async () => {
    await renderDialog({
      current: {
        status: "earlier_open",
        businessDate: "2026-10-20",
        today: null,
        earlierOpen: { id: "day-1019", business_date: "2026-10-19" },
      },
      dayId: "day-1019",
      summary: cashDaySummaryEntity({ cash_day_id: "day-1019", business_date: "2026-10-19" }),
      lines: [{ id: "l1", quantity: 2 }],
    });

    expect(screen.getByRole("dialog", { name: "Close Mon 19 Oct" })).toBeInTheDocument();
    expect(screen.queryByTestId("cart-warning")).not.toBeInTheDocument();
  });
});

describe("CloseDayDialog: confirm and send", () => {
  it("confirm shows the final warning, the inputs read-only, focus on Back; Back and Esc return to the count", async () => {
    const user = userEvent.setup();
    await renderDialog();
    await user.type(counted(), "15400");
    await user.type(reasonBox(), "Coins short");
    await user.click(screen.getByRole("button", { name: "Close day" }));

    expect(screen.getByTestId("close-day-final")).toHaveTextContent(
      "No more sales today after closing. This can't be undone.",
    );
    expect(counted()).toHaveAttribute("readonly");
    expect(counted().parentElement).toHaveClass("opacity-60", "cursor-not-allowed");
    expect(reasonBox()).toHaveAttribute("readonly");
    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByTestId("close-day-final")).not.toBeInTheDocument();
    expect(counted()).toHaveValue("15400");
    expect(counted()).not.toHaveAttribute("readonly");

    await user.keyboard("{Enter}");
    await screen.findByTestId("close-day-final");
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("close-day-final")).not.toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
    expect(cashDaysService.closeCashDay).not.toHaveBeenCalled();
  });

  it("sends the count, the expected it showed and the reason, with the dialog's request id", async () => {
    const user = userEvent.setup();
    cashDaysService.closeCashDay.mockResolvedValue(closedCashDayEntity());
    const { store } = await renderDialog();

    await countAndClose(user, "15400", "Coins short at count");

    await waitFor(() => expect(cashDaysService.closeCashDay).toHaveBeenCalledTimes(1));
    expect(cashDaysService.closeCashDay).toHaveBeenCalledWith("day-1020", {
      counted_balance: 15400,
      expected_seen: 15500,
      difference_reason: "Coins short at count",
      client_request_id: store.getState().cashDay.close.clientRequestId,
    });
  });

  it("is busy while sending: not dismissable, Back disabled", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    cashDaysService.closeCashDay.mockReturnValue(pending.promise);
    await renderDialog();

    await countAndClose(user, "15500");

    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(dialog()).toBeInTheDocument();
    await act(async () => pending.resolve(closedCashDayEntity()));
  });

  it("closed: shows the returned day's figures, not the form's, with who closed it; focus on Done", async () => {
    const user = userEvent.setup();
    // An accepted resend answers with what was recorded: an exact count.
    cashDaysService.closeCashDay.mockResolvedValue(
      closedCashDayEntity({ counted_balance: "15500.00", difference: "0.00", difference_reason: null }),
    );
    await renderDialog();

    await countAndClose(user, "15400", "Coins short at count");

    const result = await screen.findByTestId("close-day-closed");
    expect(result).toHaveTextContent("Closed at 6:15 PM by Nimal Silva.");
    expect(within(result).getByTestId("figure-counted").textContent).toBe(`${LKR}15,500.00`);
    expect(within(result).getByTestId("figure-difference").textContent).toBe("Exact");
    expect(result).not.toHaveTextContent("Coins short at count");
    await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toHaveFocus());
  });

  it("shows the reason recorded with the closed day", async () => {
    const user = userEvent.setup();
    cashDaysService.closeCashDay.mockResolvedValue(closedCashDayEntity());
    await renderDialog();

    await countAndClose(user, "15400", "Coins short at count");

    expect(await screen.findByTestId("close-day-closed")).toHaveTextContent("Reason: Coins short at count");
  });
});

describe("CloseDayDialog: server answers", () => {
  it("EXPECTED_CHANGED: back to the count with the fresh figures and the count kept; a new confirm sends the new expected", async () => {
    const user = userEvent.setup();
    cashDaysService.closeCashDay.mockRejectedValueOnce(expectedChangedError());
    await renderDialog();

    await countAndClose(user, "15400", "Coins short at count");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A sale, void or return changed the figures. Check them and close again.",
    );
    expect(screen.queryByTestId("close-day-final")).not.toBeInTheDocument();
    expect(screen.getByTestId("figure-expected").textContent).toBe(`${LKR}17,500.00`);
    expect(counted()).toHaveValue("15400");
    expect(difference()).toBe(`Short ${LKR}2,100.00`);
    expect(cashDaysService.closeCashDay).toHaveBeenCalledTimes(1);

    cashDaysService.closeCashDay.mockResolvedValueOnce(closedCashDayEntity());
    await user.click(screen.getByRole("button", { name: "Close day" }));
    await user.click(await screen.findByRole("button", { name: "Close day" }));

    await waitFor(() => expect(cashDaysService.closeCashDay).toHaveBeenCalledTimes(2));
    expect(bodies()[1]).toMatchObject({ counted_balance: 15400, expected_seen: 17500 });
    expect(bodies()[1].client_request_id).toBe(bodies()[0].client_request_id);
  });

  it("REASON_REQUIRED: back to the count with the reason box open and the error under it", async () => {
    const user = userEvent.setup();
    cashDaysService.closeCashDay.mockRejectedValueOnce(reasonRequiredError("-100.00"));
    await renderDialog();

    await countAndClose(user, "15400", "abc");

    expect(
      await screen.findByText(`Short ${LKR}100.00: give a reason (at least 3 characters).`, { normalizer: (s) => s }),
    ).toBeInTheDocument();
    expect(reasonBox()).not.toHaveAttribute("readonly");
    expect(screen.queryByTestId("close-day-final")).not.toBeInTheDocument();
  });

  it("DAY_ALREADY_CLOSED: says so and offers only Done", async () => {
    const user = userEvent.setup();
    cashDaysService.closeCashDay.mockRejectedValueOnce(dayAlreadyClosedError());
    await renderDialog();

    await countAndClose(user, "15500");

    expect(await screen.findByRole("alert")).toHaveTextContent("This day was already closed at 6:15 PM.");
    const buttons = within(dialog()).getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(["Done"]);
  });

  it("unconfirmed: inputs read-only with the locked look, only Try again, not dismissable; Try again resends the first body", async () => {
    const user = userEvent.setup();
    cashDaysService.closeCashDay.mockRejectedValueOnce(cashDayTimeoutError());
    cashDaysService.getCashDay.mockResolvedValueOnce(openCashDayEntity());
    await renderDialog();

    await countAndClose(user, "15400", "Coins short at count");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't confirm the day was closed. Try again: it sends the same count.",
    );
    expect(counted()).toHaveAttribute("readonly");
    expect(counted()).not.toBeDisabled();
    expect(counted().parentElement).toHaveClass("opacity-60", "cursor-not-allowed");
    expect(reasonBox()).toHaveAttribute("readonly");
    expect(within(dialog()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Try again"]);
    // Already confirmed: the final warning is not repeated.
    expect(screen.queryByTestId("close-day-final")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(dialog()).toBeInTheDocument();

    cashDaysService.closeCashDay.mockResolvedValueOnce(closedCashDayEntity());
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("close-day-closed")).toBeInTheDocument();
    expect(bodies()[1]).toEqual(bodies()[0]);
  });
});
