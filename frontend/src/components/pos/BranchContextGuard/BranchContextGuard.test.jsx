import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BranchContextGuard from "./index";
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
  closedShop,
  mainShop,
} from "../../../test/fixtures";

const renderGuard = ({
  user,
  branches = branchesState([mainShop, cityShop, closedShop]),
}) =>
  renderWithProviders(
    <BranchContextGuard>
      <p>terminal content</p>
    </BranchContextGuard>,
    { preloadedState: { auth: authState(user), branches } },
  );

describe("BranchContextGuard", () => {
  beforeEach(() => {
    useActiveBranchStore.setState({ activeBranchId: null });
  });

  it("renders the terminal for a cashier with a branch", () => {
    renderGuard({ user: cashierUser });
    expect(screen.getByText("terminal content")).toBeInTheDocument();
  });

  it("renders the terminal for a cashier even before branches load", () => {
    renderGuard({
      user: cashierUser,
      branches: branchesState([], { initialized: false }),
    });
    expect(screen.getByText("terminal content")).toBeInTheDocument();
  });

  it("blocks staff without a branch", () => {
    renderGuard({ user: { ...cashierUser, branch_id: null, branch: null } });
    expect(screen.getByText("No branch assigned")).toBeInTheDocument();
    expect(screen.queryByText("terminal content")).not.toBeInTheDocument();
  });

  it("renders the terminal for an admin with an active branch selected", () => {
    useActiveBranchStore.setState({ activeBranchId: cityShop.id });
    renderGuard({ user: adminUser });
    expect(screen.getByText("terminal content")).toBeInTheDocument();
  });

  it("tells an admin with no branch to pick one from the app header", () => {
    renderGuard({ user: adminUser });

    expect(
      screen.getByText("Pick a branch from the header to open the terminal"),
    ).toBeInTheDocument();
    // The global header selector is the only picker on the page.
    expect(
      screen.getByRole("button", { name: /select branch/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Main Shop" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("terminal content")).not.toBeInTheDocument();
  });

  it("does not auto-pick a branch for the admin", () => {
    renderGuard({ user: adminUser });
    expect(useActiveBranchStore.getState().activeBranchId).toBeNull();
  });

  it("opens the terminal once the admin picks a branch in the header", async () => {
    renderGuard({ user: adminUser });

    await userEvent.click(
      screen.getByRole("button", { name: /select branch/i }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /city shop/i }),
    );

    expect(useActiveBranchStore.getState().activeBranchId).toBe(cityShop.id);
    expect(await screen.findByText("terminal content")).toBeInTheDocument();
  });

  it("asks the admin to pick when the stored branch is inactive", () => {
    useActiveBranchStore.setState({ activeBranchId: closedShop.id });
    renderGuard({ user: adminUser });
    expect(
      screen.getByText("Pick a branch from the header to open the terminal"),
    ).toBeInTheDocument();
  });

  it("shows a loader while an admin's branches are loading", () => {
    renderGuard({
      user: adminUser,
      branches: branchesState([], { initialized: false, loading: true }),
    });
    expect(screen.getByText("Loading branches...")).toBeInTheDocument();
  });

  it("shows a retry when the admin's branches fail to load", () => {
    renderGuard({
      user: adminUser,
      branches: branchesState([], { error: "Network Error" }),
    });
    expect(screen.getByText("Couldn't load branches")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});
