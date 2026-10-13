import { useSelector } from "react-redux";
import { ROLES } from "../constants/rolePermissions";
import {
  selectActiveBranches,
  selectBranchesError,
  selectBranchesInitialized,
} from "../store/slices/branchesSlice";
import useActiveBranchStore from "../store/zustand/activeBranchStore";

/**
 * useTerminalBranch Hook
 *
 * Resolves which branch the POS terminal is operating on. Every terminal
 * call that needs a branch (POST /sales, catalog fetch, recent sales)
 * reads it from here.
 *
 * RESOLUTION (planning doc §4, Q10):
 * - Staff (manager / cashier): their own `user.branch_id`. Never the
 *   activeBranchStore — a staff browser may still hold a stale value from
 *   before the mapBackendUser fix (see FOLLOWUPS).
 * - Admin: `activeBranchStore.activeBranchId`, but only if it points at a
 *   currently active branch. Otherwise the admin has to pick one.
 *
 * STATUS VALUES:
 * - "ready":           `branch` is set, terminal can open
 * - "loading":         admin, branches list not fetched yet
 * - "error":           admin, branches fetch failed
 * - "needs-selection": admin, no valid branch picked
 * - "unassigned":      staff user without a branch (DB constraint should
 *                      prevent this, but the UI must not crash on it)
 */

export const resolveTerminalBranch = ({
  user,
  activeBranchId,
  activeBranches,
  branchesInitialized,
  branchesError,
}) => {
  if (!user) return { status: "unassigned", branch: null };

  if (user.role !== ROLES.ADMIN) {
    if (!user.branch_id) return { status: "unassigned", branch: null };
    return {
      status: "ready",
      branch: user.branch ?? { id: user.branch_id, name: null },
    };
  }

  if (!branchesInitialized) return { status: "loading", branch: null };
  if (branchesError) return { status: "error", branch: null };

  const branch = activeBranches.find((b) => b.id === activeBranchId);
  return branch
    ? { status: "ready", branch }
    : { status: "needs-selection", branch: null };
};

const useTerminalBranch = () => {
  const user = useSelector((state) => state.auth.user);
  const activeBranches = useSelector(selectActiveBranches);
  const branchesInitialized = useSelector(selectBranchesInitialized);
  const branchesError = useSelector(selectBranchesError);
  const activeBranchId = useActiveBranchStore((s) => s.activeBranchId);

  const { status, branch } = resolveTerminalBranch({
    user,
    activeBranchId,
    activeBranches,
    branchesInitialized,
    branchesError,
  });

  return { status, branch, branchId: branch?.id ?? null };
};

export default useTerminalBranch;
