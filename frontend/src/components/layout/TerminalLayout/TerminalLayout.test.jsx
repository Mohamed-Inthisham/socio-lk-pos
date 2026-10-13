import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
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
