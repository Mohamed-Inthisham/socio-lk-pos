import { useEffect } from "react";
import { vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import DayGate from "./index";
import EarlierDayPanel from "../EarlierDayPanel";
import TerminalLayout from "../../layout/TerminalLayout";
import * as cashDaysService from "../../../services/cashDaysService";
import * as saleReturnsService from "../../../services/saleReturnsService";
import useActiveBranchStore from "../../../store/zustand/activeBranchStore";
import { authState, branchesState, renderWithProviders } from "../../../test/renderWithProviders";
import { adminUser, cashierUser, cityShop, mainShop } from "../../../test/fixtures";
import {
  cashDayNetworkError,
  cashDayTimeoutError,
  closedCashDayEntity,
  currentCashDayResponse,
  openCashDayEntity,
} from "../../../test/cashDayEntities";

vi.mock("../../../services/cashDaysService");
vi.mock("../../../services/saleReturnsService");

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const noDay = () => currentCashDayResponse();
const todayOpen = () => currentCashDayResponse({ today: openCashDayEntity() });
const todayClosed = () => currentCashDayResponse({ today: closedCashDayEntity() });
const earlierOpen = () => currentCashDayResponse({ earlier_open: { id: "day-1019", business_date: "2026-10-19" } });

// Stands for a terminal page: counts its mounts, as PosTerminal's mount
// effect is what opens a draft (ensureDraftSale).
let mounts;
const Page = () => {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <p>terminal page</p>;
};

const renderGate = (user = cashierUser) =>
  renderWithProviders(
    <DayGate>
      <Page />
    </DayGate>,
    { preloadedState: { auth: authState(user), branches: branchesState([mainShop, cityShop]) } },
  );

const defineVisibility = (state) =>
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });

const setVisibility = (state) => {
  defineVisibility(state);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

beforeEach(() => {
  vi.resetAllMocks();
  mounts = 0;
  saleReturnsService.listInspection.mockResolvedValue([]);
  // Any read a test doesn't script answers "today open".
  cashDaysService.getCurrentCashDay.mockResolvedValue(todayOpen());
  useActiveBranchStore.setState({ activeBranchId: null });
});

afterEach(() => {
  defineVisibility("visible");
});

describe("DayGate states (P9-7)", () => {
  it("shows a spinner until the first answer", async () => {
    const first = deferred();
    cashDaysService.getCurrentCashDay.mockReturnValue(first.promise);
    renderGate();

    expect(screen.getByRole("status")).toHaveTextContent("Checking today's cash day…");
    expect(screen.queryByText("terminal page")).not.toBeInTheDocument();
    first.resolve(todayOpen());
    expect(await screen.findByText("terminal page")).toBeInTheDocument();
  });

  it("no day: the opening dialog, read for the terminal branch", async () => {
    cashDaysService.getCurrentCashDay.mockResolvedValue(noDay());
    renderGate();

    expect(await screen.findByRole("dialog", { name: "Open the day" })).toHaveTextContent("Tue 20 Oct 2026 · Main Shop");
    expect(cashDaysService.getCurrentCashDay).toHaveBeenCalledWith("branch-main");
    expect(mounts).toBe(0);
  });

  it("open: the page", async () => {
    cashDaysService.getCurrentCashDay.mockResolvedValue(todayOpen());
    renderGate();

    expect(await screen.findByText("terminal page")).toBeInTheDocument();
    expect(mounts).toBe(1);
  });

  it("closed: the placeholder, and no page", async () => {
    cashDaysService.getCurrentCashDay.mockResolvedValue(todayClosed());
    renderGate();

    expect(await screen.findByRole("heading", { name: "Today is closed" })).toBeInTheDocument();
    expect(screen.getByText("Sales open again after tomorrow's opening.")).toBeInTheDocument();
    expect(mounts).toBe(0);
  });

  it("earlier day open: names the day, with no Close button yet (step C)", async () => {
    cashDaysService.getCurrentCashDay.mockResolvedValue(earlierOpen());
    renderGate();

    expect(await screen.findByRole("heading", { name: "An earlier day is still open" })).toBeInTheDocument();
    expect(screen.getByText("Mon 19 Oct 2026 was not closed. Close it before opening today.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(mounts).toBe(0);
  });

  it("a failed first read: the error screen with Try again, which reads again", async () => {
    const user = userEvent.setup();
    cashDaysService.getCurrentCashDay.mockRejectedValueOnce(cashDayTimeoutError()).mockResolvedValueOnce(todayOpen());
    renderGate();

    expect(await screen.findByRole("heading", { name: "Couldn't check today's cash day" })).toBeInTheDocument();
    expect(screen.getByText("Couldn't load today's cash day. Check the connection and try again.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByTestId("day-recheck-notice")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("terminal page")).toBeInTheDocument();
    expect(cashDaysService.getCurrentCashDay).toHaveBeenCalledTimes(2);
  });
});

describe("DayGate re-reads", () => {
  it("reads again when the tab becomes visible, not when it is hidden", async () => {
    cashDaysService.getCurrentCashDay.mockResolvedValue(todayOpen());
    renderGate();
    await screen.findByText("terminal page");

    setVisibility("hidden");
    expect(cashDaysService.getCurrentCashDay).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await waitFor(() => expect(cashDaysService.getCurrentCashDay).toHaveBeenCalledTimes(2));
  });

  it("a failed re-read over an open till keeps the page mounted, with the notice and Try again", async () => {
    const user = userEvent.setup();
    cashDaysService.getCurrentCashDay.mockResolvedValueOnce(todayOpen()).mockRejectedValueOnce(cashDayNetworkError());
    renderGate();
    await screen.findByText("terminal page");

    setVisibility("visible");

    expect(await screen.findByTestId("day-recheck-notice")).toHaveTextContent("Couldn't re-check today's cash day.");
    expect(screen.getByText("terminal page")).toBeInTheDocument();

    const retry = deferred();
    cashDaysService.getCurrentCashDay.mockReturnValueOnce(retry.promise);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    // While it re-checks, the till stays (no spinner over the cart).
    expect(screen.getByText("terminal page")).toBeInTheDocument();
    retry.resolve(todayOpen());

    await waitFor(() => expect(screen.queryByTestId("day-recheck-notice")).not.toBeInTheDocument());
    expect(screen.getByText("terminal page")).toBeInTheDocument();
    expect(mounts).toBe(1);
  });

  it.each([
    ["closed", todayClosed, "Today is closed"],
    ["an earlier day open", earlierOpen, "An earlier day is still open"],
  ])("a re-read that says %s replaces the till", async (_, answer, heading) => {
    cashDaysService.getCurrentCashDay.mockResolvedValueOnce(todayOpen()).mockResolvedValueOnce(answer());
    renderGate();
    await screen.findByText("terminal page");

    setVisibility("visible");

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByText("terminal page")).not.toBeInTheDocument();
  });

  it("a failed re-read over the opening dialog keeps what was typed and the same request id", async () => {
    const user = userEvent.setup();
    cashDaysService.getCurrentCashDay.mockResolvedValueOnce(noDay()).mockRejectedValueOnce(cashDayNetworkError());
    const { store } = renderGate();
    const input = await screen.findByRole("textbox", { name: "Cash in the box" });
    await user.type(input, "5000");
    const id = store.getState().cashDay.open.clientRequestId;

    setVisibility("visible");

    expect(await screen.findByTestId("day-recheck-notice")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Cash in the box" })).toHaveValue("5000");
    expect(store.getState().cashDay.open.clientRequestId).toBe(id);
  });

  it("an admin's branch change clears the day and reads for the new branch", async () => {
    useActiveBranchStore.setState({ activeBranchId: mainShop.id });
    cashDaysService.getCurrentCashDay.mockResolvedValueOnce(todayOpen()).mockResolvedValueOnce(noDay());
    const { store } = renderGate(adminUser);
    await screen.findByText("terminal page");

    act(() => {
      useActiveBranchStore.setState({ activeBranchId: cityShop.id });
    });

    expect(await screen.findByRole("dialog", { name: "Open the day" })).toHaveTextContent("City Shop");
    expect(cashDaysService.getCurrentCashDay).toHaveBeenLastCalledWith(cityShop.id);
    expect(store.getState().cashDay.branchId).toBe(cityShop.id);
  });
});

describe("DayGate inside the terminal", () => {
  const Where = () => <p data-testid="where">{useLocation().pathname}</p>;

  const renderAt = (route, user = { ...cashierUser, id: "user-manager", role: "manager", name: "Test Manager" }) =>
    renderWithProviders(
      <>
        <Where />
        <Routes>
          <Route element={<TerminalLayout />}>
            <Route path="/pos" element={<Page />} />
            <Route path="/pos/sales" element={<p>sales list</p>} />
            <Route path="/pos/sales/:id" element={<p>sale detail</p>} />
            <Route path="/pos/inspection" element={<p>phones to check</p>} />
          </Route>
        </Routes>
      </>,
      { route, preloadedState: { auth: authState(user), branches: branchesState([mainShop]) } },
    );

  it.each([
    ["/pos", "terminal page"],
    ["/pos/sales", "sales list"],
    ["/pos/sales/sale-1", "sale detail"],
    ["/pos/inspection", "phones to check"],
  ])("gates %s", async (route, page) => {
    cashDaysService.getCurrentCashDay.mockResolvedValue(noDay());
    renderAt(route);

    expect(await screen.findByRole("dialog", { name: "Open the day" })).toBeInTheDocument();
    expect(screen.queryByText(page)).not.toBeInTheDocument();
  });

  it("no page is mounted while gated (no draft is opened), and Alt+R does nothing", async () => {
    cashDaysService.getCurrentCashDay.mockResolvedValue(noDay());
    renderAt("/pos");
    await screen.findByRole("dialog", { name: "Open the day" });

    fireEvent.keyDown(document.body, { key: "r", code: "KeyR", altKey: true });

    expect(screen.getByTestId("where").textContent).toBe("/pos");
    expect(mounts).toBe(0);
  });
});

describe("EarlierDayPanel", () => {
  it("offers Close <day> when given onCloseDay (step C)", async () => {
    const user = userEvent.setup();
    const onCloseDay = vi.fn();
    render(<EarlierDayPanel businessDate="2026-10-19" today="2026-10-20" onCloseDay={onCloseDay} />);

    await user.click(screen.getByRole("button", { name: "Close Mon 19 Oct" }));

    expect(onCloseDay).toHaveBeenCalledTimes(1);
  });
});
