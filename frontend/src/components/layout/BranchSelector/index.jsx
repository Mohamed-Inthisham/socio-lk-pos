import { Fragment, useEffect } from "react";
import {
  Menu,
  MenuButton,
  MenuItems,
  MenuItem,
  Transition,
} from "@headlessui/react";
import { useSelector } from "react-redux";
import { Store, ChevronDown, Check } from "lucide-react";
import { selectActiveBranches } from "../../../store/slices/branchesSlice";
import useActiveBranchStore from "../../../store/zustand/activeBranchStore";

/**
 * BranchSelector Component
 *
 * Header widget showing the user's currently active branch context.
 * Renders two shapes depending on role:
 *
 * - Admins get an interactive dropdown to switch between any active branch.
 *   Admins have `branch_id: null` on their user record — they're not pinned
 *   anywhere, so they need a way to pick a "viewing context" from the header.
 *
 * - Managers/cashiers get a static, non-interactive chip showing their
 *   pinned branch. The DB constraint CHK_users_branch_role guarantees they
 *   have a non-null branch_id, so `user.branch` is always populated.
 *   Rendering a dropdown for them would be misleading — they can't switch.
 *
 * WHY THIS IS SCAFFOLD-ONLY IN PATH B:
 * The store update wires up. ProductsList's existing filter does NOT yet
 * subscribe to activeBranchId — that's a deliberate deferral. R1 is single-
 * branch; scoping the products list per-branch is deferred to R9 (or the
 * moment a second branch launches). This selector exists so R2's mental
 * model is already in place and the switch to per-branch filters is a
 * small, focused change rather than a UX invention.
 *
 * DEFAULTING LOGIC:
 * On first render (or whenever the trio of user, branches list, and stored
 * activeBranchId settle), we default the store value to:
 *   1. The user's own branch_id if set (staff always, admin sometimes), else
 *   2. The first active branch (admin without a home branch), else
 *   3. Stay null (no branches loaded yet, or none exist).
 * Only sets the store if it's currently null — never overwrites a user pick.
 *
 * NULL activeBranchId is a valid transitional state and must not crash the
 * render. This shows as a disabled placeholder button until defaulting resolves.
 */

const BranchSelector = () => {
  const user = useSelector((state) => state.auth.user);
  const activeBranches = useSelector(selectActiveBranches);
  const activeBranchId = useActiveBranchStore((s) => s.activeBranchId);
  const setActiveBranch = useActiveBranchStore((s) => s.setActiveBranch);

  const isAdmin = user?.role === "admin";

  // Default the store if it's null and we have enough data to pick.
  // Effect not selector: setting state during render is a React anti-pattern
  // and would cascade re-renders across every subscriber.
  useEffect(() => {
    if (!user) return;
    if (activeBranchId !== null) return;

    // Prefer the user's pinned branch (staff always have one; some admins do).
    if (user.branch_id) {
      setActiveBranch(user.branch_id);
      return;
    }

    // Admin with no pinned branch — fall back to the first active branch.
    // Staff without branch_id shouldn't exist (DB constraint), but if the
    // fetch hasn't populated `branches` yet we just wait until it does.
    if (activeBranches.length > 0) {
      setActiveBranch(activeBranches[0].id);
    }
  }, [user, activeBranchId, activeBranches, setActiveBranch]);

  if (!user) return null;

  // ────────────────────────────────────────────────────────────────────
  // Staff: static chip. Read the branch name from user.branch (nested on
  // the auth response) — no dependency on branchesSlice being loaded.
  // ────────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    const staffBranchName = user.branch?.name || "—";
    return (
      <div
        className="
          hidden sm:flex items-center gap-2
          h-10 px-3 rounded-full
          bg-slate-100 dark:bg-slate-800
          text-sm font-medium text-slate-700 dark:text-slate-200
        "
        title={`You're assigned to ${staffBranchName}`}
      >
        <Store
          size={14}
          className="text-slate-500 dark:text-slate-400"
          aria-hidden="true"
        />
        <span className="max-w-[8rem] truncate">{staffBranchName}</span>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // Admin: interactive dropdown. Reads options from branchesSlice.
  // ────────────────────────────────────────────────────────────────────

  const selectedBranch = activeBranches.find((b) => b.id === activeBranchId);
  const buttonLabel = selectedBranch?.name || "Select branch";
  const hasBranches = activeBranches.length > 0;

  return (
    <Menu as="div" className="relative">
      <MenuButton
        // Disabled state covers two real cases:
        //   - Branches haven't loaded yet
        //   - Every branch has been deactivated (unlikely but possible)
        disabled={!hasBranches}
        className="
          hidden sm:flex items-center gap-2
          h-10 pl-3 pr-2 rounded-full
          bg-slate-100 dark:bg-slate-800
          hover:bg-slate-200 dark:hover:bg-slate-700
          disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-slate-100 dark:disabled:hover:bg-slate-800
          transition-colors
          focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
        "
      >
        <Store
          size={14}
          className="text-slate-500 dark:text-slate-400"
          aria-hidden="true"
        />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 max-w-[8rem] truncate">
          {buttonLabel}
        </span>
        <ChevronDown
          size={14}
          className="text-slate-400 dark:text-slate-500"
          aria-hidden="true"
        />
      </MenuButton>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <MenuItems
          anchor={{ to: "bottom end", gap: 8 }}
          className="
            z-50 w-64 origin-top-right
            rounded-lg p-1
            bg-white dark:bg-slate-900
            border border-slate-200 dark:border-slate-700
            shadow-xl shadow-slate-900/10 dark:shadow-black/40
            focus:outline-none
          "
        >
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active branch
            </p>
          </div>

          <div className="py-1 max-h-64 overflow-y-auto">
            {activeBranches.map((branch) => {
              const isSelected = branch.id === activeBranchId;
              return (
                <MenuItem key={branch.id}>
                  <button
                    type="button"
                    onClick={() => setActiveBranch(branch.id)}
                    className="
                      w-full flex items-center gap-2.5
                      px-3 py-2 rounded-md
                      text-sm text-slate-700 dark:text-slate-200
                      data-[focus]:bg-slate-100 dark:data-[focus]:bg-slate-800
                      transition-colors
                    "
                  >
                    <span className="flex-1 text-left truncate">
                      {branch.name}
                    </span>
                    {isSelected && (
                      <Check
                        size={16}
                        className="flex-shrink-0 text-cyan-600 dark:text-cyan-400"
                        aria-label="Selected"
                      />
                    )}
                  </button>
                </MenuItem>
              );
            })}
          </div>
        </MenuItems>
      </Transition>
    </Menu>
  );
};

export default BranchSelector;
