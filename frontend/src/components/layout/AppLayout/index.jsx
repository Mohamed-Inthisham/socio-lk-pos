import { Outlet } from "react-router-dom";
import AppHeader from "../AppHeader";
import Sidebar from "../Sidebar";
import SidebarDrawer from "../SidebarDrawer";

/**
 * AppLayout Component
 *
 * The main authenticated app shell. Composes:
 * - AppHeader across the top (sticky)
 * - Sidebar on the left (desktop only, always visible)
 * - SidebarDrawer (mobile only, hidden until hamburger opens it)
 * - <Outlet /> for the routed page content
 *
 * LAYOUT MATH:
 * - Header spans full width at top (h-14 sticky)
 * - Below header: flex row with Sidebar (left, fixed width) and main
 *   content (right, fills remaining space)
 * - min-h-screen on the root so short pages still fill the viewport
 *
 * MOBILE VS DESKTOP:
 * - Desktop (lg+): Sidebar always visible via `hidden lg:block`
 * - Mobile: SidebarDrawer renders in a portal (via Headless UI Dialog)
 *   and is invisible until layoutStore's mobileDrawerOpen flips to true.
 *   SidebarDrawer is always mounted; visibility is controlled internally.
 *
 * PAGE BACKGROUND:
 * The main content area owns the page background (slate-50/slate-950).
 * Individual page components should NOT set their own min-h-screen or
 * background — this container handles it, so pages just render their
 * content. Existing pages will be refactored to drop their wrappers in
 * a follow-up commit.
 */

const AppLayout = () => {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      {/* Header spans full width at top */}
      <AppHeader />

      {/* Row below the header: sidebar + main content */}
      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar — always visible on lg+ */}
        <div className="hidden lg:block flex-shrink-0">
          <Sidebar />
        </div>

        {/* Mobile drawer — always mounted, visibility controlled internally */}
        <SidebarDrawer />

        {/* Main content area — page renders here via Outlet */}
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
