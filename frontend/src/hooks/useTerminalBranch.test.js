import { resolveTerminalBranch } from "./useTerminalBranch";
import {
  adminUser,
  cashierUser,
  cityShop,
  closedShop,
  mainShop,
} from "../test/fixtures";

const base = {
  activeBranchId: null,
  activeBranches: [mainShop, cityShop],
  branchesInitialized: true,
  branchesError: null,
};

describe("resolveTerminalBranch", () => {
  it("uses the staff user's own branch", () => {
    expect(resolveTerminalBranch({ ...base, user: cashierUser })).toEqual({
      status: "ready",
      branch: mainShop,
    });
  });

  it("ignores a stale activeBranchId for staff", () => {
    const result = resolveTerminalBranch({
      ...base,
      user: cashierUser,
      activeBranchId: cityShop.id,
    });
    expect(result.branch).toEqual(mainShop);
  });

  it("does not wait for the branches list for staff", () => {
    const result = resolveTerminalBranch({
      ...base,
      user: cashierUser,
      activeBranches: [],
      branchesInitialized: false,
    });
    expect(result.status).toBe("ready");
  });

  it("falls back to an id-only branch when the nested branch is missing", () => {
    const result = resolveTerminalBranch({
      ...base,
      user: { ...cashierUser, branch: null },
    });
    expect(result).toEqual({
      status: "ready",
      branch: { id: mainShop.id, name: null },
    });
  });

  it("flags staff without a branch as unassigned", () => {
    const result = resolveTerminalBranch({
      ...base,
      user: { ...cashierUser, branch_id: null, branch: null },
    });
    expect(result.status).toBe("unassigned");
  });

  it("uses the admin's active branch when it is active", () => {
    const result = resolveTerminalBranch({
      ...base,
      user: adminUser,
      activeBranchId: cityShop.id,
    });
    expect(result).toEqual({ status: "ready", branch: cityShop });
  });

  it("asks the admin to pick when no branch is selected", () => {
    const result = resolveTerminalBranch({ ...base, user: adminUser });
    expect(result.status).toBe("needs-selection");
  });

  it("asks the admin to pick when the selected branch is not active", () => {
    const result = resolveTerminalBranch({
      ...base,
      user: adminUser,
      activeBranchId: closedShop.id,
    });
    expect(result.status).toBe("needs-selection");
  });

  it("waits for the branches list for admins", () => {
    const result = resolveTerminalBranch({
      ...base,
      user: adminUser,
      activeBranchId: mainShop.id,
      branchesInitialized: false,
    });
    expect(result.status).toBe("loading");
  });

  it("reports a failed branches fetch for admins", () => {
    const result = resolveTerminalBranch({
      ...base,
      user: adminUser,
      branchesError: "Network Error",
    });
    expect(result.status).toBe("error");
  });
});
