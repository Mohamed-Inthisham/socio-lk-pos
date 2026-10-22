import { fireEvent, screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import TerminalLayout from "./index";
import useActiveBranchStore from "../../../store/zustand/activeBranchStore";
import {
  authState,
  branchesState,
  renderWithProviders,
} from "../../../test/renderWithProviders";
import {
  adminUser,
  cashierUser,
  cityShop,
  mainShop,
} from "../../../test/fixtures";

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
        preloadedState: { auth: authState(cashierUser), branches: branchesState([mainShop]) },
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
