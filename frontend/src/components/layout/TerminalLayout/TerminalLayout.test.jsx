import { vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import TerminalLayout from "./index";
import * as saleReturnsService from "../../../services/saleReturnsService";
import * as cashDaysService from "../../../services/cashDaysService";
import { inspectionRow } from "../../../test/returnEntities";
import {
  cashDaySummaryEntity,
  closedCashDayEntity,
  currentCashDayResponse,
  openCashDayEntity,
} from "../../../test/cashDayEntities";
import useActiveBranchStore from "../../../store/zustand/activeBranchStore";
import {
  authState,
  branchesState,
  cashDayState,
  renderWithProviders,
} from "../../../test/renderWithProviders";
import {
  adminUser,
  cashierUser,
  cityShop,
  mainShop,
} from "../../../test/fixtures";

// Admins and managers read the phones to check on mount (useInspectionCount).
vi.mock("../../../services/saleReturnsService");
// The day gate (P9-7) reads today's cash day on mount: today is open.
vi.mock("../../../services/cashDaysService");
beforeEach(() => {
  vi.mocked(saleReturnsService.listInspection).mockReset().mockResolvedValue([]);
  vi.mocked(cashDaysService.getCurrentCashDay)
    .mockReset()
    .mockResolvedValue(currentCashDayResponse({ today: openCashDayEntity() }));
});

/** Today already open at the user's terminal branch, so the gate shows the page at once. */
const openDayFor = (user) => {
  const branchId = user.role === "admin" ? useActiveBranchStore.getState().activeBranchId : user.branch_id;
  return cashDayState({
    branchId,
    current: {
      status: "open",
      businessDate: "2026-10-20",
      today: openCashDayEntity({ branch_id: branchId }),
    },
  });
};

const renderLayout = (user) =>
  renderWithProviders(
    <Routes>
      <Route element={<TerminalLayout />}>
        <Route path="/pos" element={<p>terminal page</p>} />
      </Route>
    </Routes>,
    {
      route: "/pos",
      preloadedState: {
        auth: authState(user),
        branches: branchesState([mainShop, cityShop]),
        cashDay: openDayFor(user),
      },
    },
  );

describe("TerminalLayout", () => {
  beforeEach(() => {
    useActiveBranchStore.setState({ activeBranchId: null });
  });

  it("renders the routed page inside the shell", () => {
    renderLayout(cashierUser);
    expect(screen.getByText("terminal page")).toBeInTheDocument();
  });

  it("shows the cashier's branch and name in the status strip", () => {
    renderLayout(cashierUser);
    expect(screen.getByTestId("terminal-branch")).toHaveTextContent(
      "Main Shop",
    );
    expect(screen.getByRole("contentinfo")).toHaveTextContent("Test Cashier");
  });

  it("shows the admin's selected branch in the status strip", () => {
    useActiveBranchStore.setState({ activeBranchId: cityShop.id });
    renderLayout(adminUser);
    expect(screen.getByTestId("terminal-branch")).toHaveTextContent(
      "City Shop",
    );
  });

  it("shows the admin's branch read-only, with no branch dropdown", () => {
    useActiveBranchStore.setState({ activeBranchId: cityShop.id });
    renderLayout(adminUser);
    expect(screen.getByTitle("Terminal branch: City Shop")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /city shop/i }),
    ).not.toBeInTheDocument();
  });

  it("the branch chip has the header buttons' corners (rounded-lg), not a full pill", () => {
    renderLayout(cashierUser);
    const chip = screen.getByTitle("Terminal branch: Main Shop");
    const sales = screen.getByRole("link", { name: "Recent sales" });
    expect(chip.className).toContain("rounded-lg");
    expect(chip.className).not.toContain("rounded-full");
    expect(sales.className).toContain("rounded-lg");
  });

  it("the user menu button has the same corners (rounded-lg)", () => {
    renderLayout(cashierUser);
    const menu = screen.getByRole("button", { name: /Test Cashier/ });
    expect(menu.className).toContain("rounded-lg");
    expect(menu.className).not.toContain("rounded-full");
  });

  it("links back to the dashboard", () => {
    renderLayout(cashierUser);
    expect(
      screen.getByRole("link", { name: "Exit terminal" }),
    ).toHaveAttribute("href", "/dashboard");
  });

  it("does not render the app sidebar", () => {
    renderLayout(cashierUser);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /products/i }),
    ).not.toBeInTheDocument();
  });
});

describe("TerminalLayout: Phones to check (P7-7)", () => {
  const managerUser = { ...cashierUser, id: "user-manager", role: "manager", name: "Test Manager" };
  const link = () => screen.queryByRole("link", { name: /^Phones to check/ });
  const rows = (n) => Array.from({ length: n }, (_, i) => inspectionRow({ product_unit: { id: `u-${i}`, imei: `3500000000000${i}`, product_name: "Phone" } }));

  it("a manager gets the link with the number of phones waiting at the branch", async () => {
    saleReturnsService.listInspection.mockResolvedValue(rows(3));
    renderLayout(managerUser);

    await waitFor(() => expect(link()).toHaveAccessibleName("Phones to check, 3 waiting"));
    expect(link()).toHaveAttribute("href", "/pos/inspection");
    expect(within(link()).getByTestId("inspection-count")).toHaveTextContent("3");
    expect(saleReturnsService.listInspection).toHaveBeenCalledWith("branch-main");
  });

  it("an admin too, for the terminal branch", async () => {
    useActiveBranchStore.setState({ activeBranchId: cityShop.id });
    saleReturnsService.listInspection.mockResolvedValue(rows(1));
    renderLayout(adminUser);

    await waitFor(() => expect(link()).toHaveAccessibleName("Phones to check, 1 waiting"));
    expect(saleReturnsService.listInspection).toHaveBeenCalledWith(cityShop.id);
  });

  it("none waiting, or a failed read: the link without a count", async () => {
    saleReturnsService.listInspection.mockRejectedValue(new Error("Network Error"));
    renderLayout(managerUser);

    await waitFor(() => expect(saleReturnsService.listInspection).toHaveBeenCalled());
    expect(link()).toHaveAccessibleName("Phones to check");
    expect(screen.queryByTestId("inspection-count")).not.toBeInTheDocument();
  });

  it("a cashier has no link, and nothing is read", () => {
    renderLayout(cashierUser);
    expect(link()).not.toBeInTheDocument();
    expect(saleReturnsService.listInspection).not.toHaveBeenCalled();
  });
});

describe("TerminalLayout: recent sales (P6-1)", () => {
  const Where = () => {
    const location = useLocation();
    return <p data-testid="where">{location.pathname + location.search}</p>;
  };

  const renderAt = (route, page = <p>terminal page</p>) =>
    renderWithProviders(
      <>
        <Where />
        <Routes>
          <Route element={<TerminalLayout />}>
            <Route path="/pos" element={page} />
            <Route path="/pos/sales" element={<p>sales list</p>} />
            <Route path="/pos/sales/:id" element={<p>sale detail</p>} />
          </Route>
        </Routes>
      </>,
      {
        route,
        preloadedState: {
          auth: authState(cashierUser),
          branches: branchesState([mainShop]),
          cashDay: openDayFor(cashierUser),
        },
      },
    );

  const altR = () => fireEvent.keyDown(document.body, { key: "r", code: "KeyR", altKey: true });
  const where = () => screen.getByTestId("where").textContent;

  it("the header's Sales button links to /pos/sales", () => {
    renderAt("/pos");
    const link = screen.getByRole("link", { name: "Recent sales" });
    expect(link).toHaveAttribute("href", "/pos/sales");
    expect(link).toHaveTextContent("Sales");
  });

  it("Alt+R opens the sales list, and the browser's own Alt+R is cancelled", () => {
    renderAt("/pos");

    // fireEvent returns false when a handler called preventDefault().
    expect(altR()).toBe(false);

    expect(screen.getByText("sales list")).toBeInTheDocument();
  });

  it("Alt+R works from an input too (the scan bar)", () => {
    renderAt("/pos", <input aria-label="scan" />);
    const input = screen.getByRole("textbox", { name: "scan" });
    input.focus();

    fireEvent.keyDown(input, { key: "r", code: "KeyR", altKey: true });

    expect(screen.getByText("sales list")).toBeInTheDocument();
  });

  it("Alt+R is ignored while a dialog is open", () => {
    renderAt("/pos", <div role="dialog" aria-label="Take payment">payment</div>);

    altR();

    expect(where()).toBe("/pos");
  });

  it("Alt+R does nothing on the sales pages, so the list keeps its day and search", () => {
    renderAt("/pos/sales?day=2026-10-20&q=Kamal");

    altR();

    expect(where()).toBe("/pos/sales?day=2026-10-20&q=Kamal");
  });
});

describe("TerminalLayout: the cash day in the status strip (P9-13)", () => {
  const renderWithDay = (current) =>
    renderWithProviders(
      <Routes>
        <Route element={<TerminalLayout />}>
          <Route path="/pos" element={<p>terminal page</p>} />
        </Route>
      </Routes>,
      {
        route: "/pos",
        preloadedState: {
          auth: authState(cashierUser),
          branches: branchesState([mainShop]),
          cashDay: cashDayState({ branchId: "branch-main", current }),
        },
      },
    );

  it("while today is open: Opened 9:02 AM and a Close day button, the time hidden below sm", () => {
    renderWithDay({ status: "open", businessDate: "2026-10-20", today: openCashDayEntity() });

    const status = screen.getByTestId("day-status");
    expect(screen.getByRole("contentinfo")).toContainElement(status);
    expect(within(status).getByText("Opened 9:02 AM")).toHaveClass("hidden", "sm:inline");
    const button = within(status).getByRole("button", { name: "Close day" });
    expect(button).toBeVisible();
    expect(button).not.toHaveClass("hidden");
  });

  it("Close day looks like a button: the outlined secondary style at 24px, with an icon", () => {
    renderWithDay({ status: "open", businessDate: "2026-10-20", today: openCashDayEntity() });

    const button = within(screen.getByTestId("day-status")).getByRole("button", { name: "Close day" });
    expect(button).toHaveClass("border", "h-6", "bg-white", "dark:bg-slate-800");
    expect(button).toHaveClass("focus-visible:ring-2");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("Close day opens the close dialog on today's figures", async () => {
    const user = userEvent.setup();
    cashDaysService.getCashDaySummary.mockResolvedValue(cashDaySummaryEntity());
    renderWithDay({ status: "open", businessDate: "2026-10-20", today: openCashDayEntity() });

    await user.click(screen.getByRole("button", { name: "Close day" }));

    expect(await screen.findByRole("dialog", { name: "Close the day" })).toBeInTheDocument();
    expect(cashDaysService.getCashDaySummary).toHaveBeenCalledWith("day-1020");
  });

  it("once closed: Closed 6:15 PM, and no Close day", () => {
    cashDaysService.getCurrentCashDay.mockResolvedValue(currentCashDayResponse({ today: closedCashDayEntity() }));
    renderWithDay({ status: "closed", businessDate: "2026-10-20", today: closedCashDayEntity() });

    expect(screen.getByTestId("day-status")).toHaveTextContent("Closed 6:15 PM");
    expect(screen.queryByRole("button", { name: "Close day" })).not.toBeInTheDocument();
  });

  it("nothing while the day isn't open", () => {
    cashDaysService.getCurrentCashDay.mockResolvedValue(currentCashDayResponse());
    renderWithDay({ status: "no_day", businessDate: "2026-10-20", today: null });

    expect(screen.queryByTestId("day-status")).not.toBeInTheDocument();
  });
});

describe("TerminalLayout: day gate (P9-7)", () => {
  const renderGated = () =>
    renderWithProviders(
      <Routes>
        <Route element={<TerminalLayout />}>
          <Route path="/pos" element={<p>terminal page</p>} />
        </Route>
      </Routes>,
      {
        route: "/pos",
        preloadedState: { auth: authState(cashierUser), branches: branchesState([mainShop]) },
      },
    );

  it("while today isn't open the gate replaces the page inside <main>, and the header stays usable", async () => {
    cashDaysService.getCurrentCashDay.mockResolvedValue(currentCashDayResponse());
    renderGated();

    const gate = await screen.findByRole("dialog", { name: "Open the day" });
    expect(screen.getByRole("main")).toContainElement(gate);
    expect(screen.queryByText("terminal page")).not.toBeInTheDocument();
    for (const control of [
      screen.getByRole("link", { name: "Exit terminal" }),
      screen.getByRole("link", { name: "Recent sales" }),
      screen.getByRole("button", { name: /Switch to (light|dark) mode/ }),
      screen.getByRole("button", { name: /Test Cashier/ }),
    ]) {
      expect(control).toBeEnabled();
      expect(control.closest("[inert], [aria-hidden='true']")).toBeNull();
    }
    expect(screen.getByRole("contentinfo")).toHaveTextContent("Main Shop");
  });

  it("shows the routed page once the read says today is open", async () => {
    renderGated();

    expect(await screen.findByText("terminal page")).toBeInTheDocument();
    expect(cashDaysService.getCurrentCashDay).toHaveBeenCalledWith("branch-main");
  });
});
