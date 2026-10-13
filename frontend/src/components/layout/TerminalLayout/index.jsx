import { Link, Outlet } from "react-router-dom";
import { useSelector } from "react-redux";
import { LogOut, Store, User } from "lucide-react";
import HeaderLogo from "../HeaderLogo";
import BranchChip from "../BranchChip";
import ThemeToggle from "../../common/ThemeToggle";
import UserMenu from "../UserMenu";
import useTerminalBranch from "../../../hooks/useTerminalBranch";
import { ROLE_INFO } from "../../../constants/rolePermissions";

/**
 * TerminalLayout Component
 *
 * Full-screen shell for the POS terminal (planning doc Q7, option a) —
 * no sidebar, so the screen goes to the cart. Composes:
 * - Top bar: brand, read-only branch chip, theme toggle, user menu, Exit link
 * - <Outlet /> for the terminal pages (fills the remaining height)
 * - Bottom status strip: branch + signed-in user
 *
 * Rendered inside BranchContextGuard, so a branch is always resolved here.
 *
 * BRANCH IS READ-ONLY HERE (admins included): switching happens only from
 * the main app header BranchSelector, same as every other page.
 *
 * LAYOUT MATH:
 * h-dvh (not h-screen) so mobile browser toolbars don't push the status
 * strip off-screen. The main area is flex-1 min-h-0; terminal pages own
 * their own internal scrolling (cart list, payments column), the shell
 * itself never scrolls. Target viewport is 1366×768 (Q23).
 */

const TerminalLayout = () => {
  const user = useSelector((state) => state.auth.user);
  const { branch } = useTerminalBranch();
  const roleInfo = ROLE_INFO[user?.role] || {};

  return (
    <div className="h-dvh flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header
        className="
          h-14 flex-shrink-0 flex items-center gap-2 px-3 sm:px-4
          bg-white dark:bg-slate-900
          border-b border-slate-200 dark:border-slate-800
        "
      >
        <HeaderLogo />

        <span
          className="
            hidden md:inline-flex items-center ml-2 px-2 py-0.5 rounded-md
            text-[11px] font-semibold uppercase tracking-wider
            bg-cyan-50 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300
          "
        >
          Terminal
        </span>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <BranchChip
            name={branch?.name || "—"}
            title={`Terminal branch: ${branch?.name || "—"}`}
          />
          <ThemeToggle />
          <UserMenu />
          <Link
            to="/dashboard"
            aria-label="Exit terminal"
            title="Exit terminal"
            className="
              h-10 flex items-center gap-2 px-2.5 sm:px-3 rounded-lg
              text-sm font-medium
              text-slate-600 dark:text-slate-300
              hover:bg-slate-100 dark:hover:bg-slate-800
              hover:text-slate-900 dark:hover:text-white
              transition-colors
              focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
            "
          >
            <LogOut size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Exit</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </main>

      <footer
        className="
          h-8 flex-shrink-0 flex items-center gap-4 px-3 sm:px-4
          bg-white dark:bg-slate-900
          border-t border-slate-200 dark:border-slate-800
          text-xs text-slate-500 dark:text-slate-400
        "
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Store size={12} aria-hidden="true" className="flex-shrink-0" />
          <span className="truncate" data-testid="terminal-branch">
            {branch?.name || "—"}
          </span>
        </span>
        <span className="flex items-center gap-1.5 min-w-0">
          <User size={12} aria-hidden="true" className="flex-shrink-0" />
          <span className="truncate">{user?.name || user?.email}</span>
          {roleInfo.label && (
            <span className="hidden sm:inline text-slate-400 dark:text-slate-500">
              · {roleInfo.label}
            </span>
          )}
        </span>
      </footer>
    </div>
  );
};

export default TerminalLayout;
