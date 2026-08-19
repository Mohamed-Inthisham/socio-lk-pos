import HeaderLogo from "../HeaderLogo";
import MobileMenuButton from "../MobileMenuButton";
import ThemeToggle from "../../common/ThemeToggle";
import UserMenu from "../UserMenu";

/**
 * AppHeader Component
 *
 * Sticky top header that spans the full width of the viewport. Contains:
 * - MobileMenuButton (mobile only): hamburger that opens the sidebar drawer
 * - HeaderLogo: brand mark, always visible
 * - Spacer: pushes right-side actions to the right
 * - ThemeToggle: light/dark switcher
 * - UserMenu: avatar + dropdown with logout
 *
 * 56px tall on all breakpoints (compact — POS staff maximize content area).
 * Sticky positioning keeps it in view when scrolling long pages.
 *
 * The header sits ABOVE both the sidebar and content on the visual stack,
 * spanning full width. On desktop, this means the sidebar starts BELOW
 * the header, not next to it. AppLayout handles that composition.
 */

const AppHeader = () => {
  return (
    <header
      className="
        sticky top-0 z-40
        h-14 flex items-center gap-2 px-3 sm:px-4
        bg-white dark:bg-slate-900
        border-b border-slate-200 dark:border-slate-800
      "
    >
      {/* Mobile hamburger — only shows below lg */}
      <MobileMenuButton />

      {/* Brand mark */}
      <HeaderLogo />

      {/* Spacer pushes right-side actions to the right */}
      <div className="flex-1" />

      {/* Right side: theme toggle + user menu */}
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
};

export default AppHeader;
