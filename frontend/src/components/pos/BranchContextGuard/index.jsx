import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { Store, AlertTriangle } from "lucide-react";
import Button from "../../common/Button";
import AppLayout from "../../layout/AppLayout";
import Panel from "../TerminalPanel";
import useTerminalBranch from "../../../hooks/useTerminalBranch";
import {
  fetchBranches,
  selectActiveBranches,
  selectBranchesError,
} from "../../../store/slices/branchesSlice";

/**
 * BranchContextGuard Component
 *
 * Wraps the POS terminal and only renders it once a branch is resolved
 * (see useTerminalBranch). Sits inside ProtectedRoute + RoleProtectedRoute.
 *
 * - Staff: always resolved from their own branch; renders children.
 * - Admin with a valid active branch: renders children.
 * - Admin without one: the normal app shell (AppLayout) with a "pick a
 *   branch from the header" message. The global header BranchSelector is
 *   the only branch picker — there is no picker inside the terminal.
 *
 * WHY autoSelectBranch={false}:
 * BranchSelector normally defaults an admin to the first active branch.
 * Here that would open the till on whichever branch is first without the
 * admin choosing; the terminal must only unlock after an explicit pick.
 */

const FullScreen = ({ children }) => (
  <div className="min-h-dvh flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
    {children}
  </div>
);

const BackToDashboard = () => (
  <Link
    to="/dashboard"
    className="inline-block mt-5 text-sm font-medium text-cyan-700 dark:text-cyan-400 hover:underline"
  >
    Back to dashboard
  </Link>
);

const BranchContextGuard = ({ children }) => {
  const dispatch = useDispatch();
  const { status } = useTerminalBranch();
  const activeBranches = useSelector(selectActiveBranches);
  const branchesError = useSelector(selectBranchesError);

  if (status === "ready") return children;

  if (status === "loading") {
    return (
      <FullScreen>
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Loading branches...
          </p>
        </div>
      </FullScreen>
    );
  }

  if (status === "unassigned") {
    return (
      <FullScreen>
        <Panel icon={AlertTriangle} tone="warning" title="No branch assigned">
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Your account isn&apos;t linked to a branch, so the terminal
            can&apos;t open. Ask an admin to assign you to one.
          </p>
          <BackToDashboard />
        </Panel>
      </FullScreen>
    );
  }

  if (status === "error") {
    return (
      <FullScreen>
        <Panel
          icon={AlertTriangle}
          tone="warning"
          title="Couldn't load branches"
        >
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {branchesError}
          </p>
          <div className="mt-5 flex items-center gap-4">
            <Button
              variant="accent"
              label="Try again"
              onClick={() => dispatch(fetchBranches())}
            />
            <BackToDashboard />
          </div>
        </Panel>
      </FullScreen>
    );
  }

  // status === "needs-selection" (admin only)
  return (
    <AppLayout autoSelectBranch={false}>
      <div className="h-full flex items-center justify-center p-4">
        <Panel icon={Store} title="Pick a branch from the header to open the terminal">
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {activeBranches.length === 0
              ? "There are no active branches."
              : "Sales are recorded against the branch selected in the header."}
          </p>
        </Panel>
      </div>
    </AppLayout>
  );
};

export default BranchContextGuard;
