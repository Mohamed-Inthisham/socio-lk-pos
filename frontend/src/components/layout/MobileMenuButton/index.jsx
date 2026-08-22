import { Menu } from "lucide-react";
import useLayoutStore from "../../../store/zustand/layoutStore";

/**
 * MobileMenuButton Component
 *
 * Hamburger button that opens the mobile SidebarDrawer. Only visible
 * below the lg breakpoint (1024px) — hidden on desktop where the
 * sidebar is always in view.
 *
 * Sized as a 40x40 touch target to meet accessibility minimums.
 * Lives in the header (added in the AppLayout commit).
 */

const MobileMenuButton = () => {
  const openMobileDrawer = useLayoutStore((s) => s.openMobileDrawer);

  return (
    <button
      type="button"
      onClick={openMobileDrawer}
      aria-label="Open menu"
      className="
        lg:hidden
        w-10 h-10 flex items-center justify-center
        rounded-lg
        text-slate-600 dark:text-slate-300
        hover:bg-slate-100 dark:hover:bg-slate-800
        hover:text-slate-900 dark:hover:text-white
        transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
      "
    >
      <Menu size={20} />
    </button>
  );
};

export default MobileMenuButton;
