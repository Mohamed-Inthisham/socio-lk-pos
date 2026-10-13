import { screen } from "@testing-library/react";
import BranchSelector from "./index";
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

const renderSelector = (user, props = {}) =>
  renderWithProviders(<BranchSelector {...props} />, {
    preloadedState: {
      auth: authState(user),
      branches: branchesState([mainShop, cityShop]),
    },
  });

describe("BranchSelector", () => {
  beforeEach(() => {
    useActiveBranchStore.setState({ activeBranchId: null });
  });

  it("defaults an admin to the first active branch", () => {
    renderSelector(adminUser);
    expect(useActiveBranchStore.getState().activeBranchId).toBe(mainShop.id);
  });

  it("leaves an admin unselected when autoSelect is off", () => {
    renderSelector(adminUser, { autoSelect: false });
    expect(useActiveBranchStore.getState().activeBranchId).toBeNull();
    expect(
      screen.getByRole("button", { name: /select branch/i }),
    ).toBeInTheDocument();
  });

  it("defaults staff to their own branch and shows it as a chip", () => {
    renderSelector(cashierUser);
    expect(useActiveBranchStore.getState().activeBranchId).toBe(mainShop.id);
    expect(screen.getByTitle("You're assigned to Main Shop")).toBeInTheDocument();
  });
});
