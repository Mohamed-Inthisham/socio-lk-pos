import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Tag,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import Tooltip from "../../common/Tooltip";
import useLayoutStore from "../../../store/zustand/layoutStore";
import usePermissions from "../../../hooks/usePermissions";
import { PERMISSIONS } from "../../../constants/rolePermissions";

/**
 * Sidebar Component
 *
 * Desktop-only sidebar. On mobile, this same component is rendered inside
 * a slide-in drawer (added in the next commit). The drawer wrapper handles
 * mobile visibility; here we just render the nav.
 *
 * NAV ITEMS:
 * Each item can gate itself by permission. Cashiers see fewer items than
 * admins. Filter happens at render time via usePermissions.
 *
 * COLLAPSED STATE:
 * When collapsed, labels hide and Tooltip on hover reveals them. Uses the
 * Tooltip primitive from the previous commit.
 *
 * ACTIVE ROUTE:
 * React Router's NavLink handles active state via className function.
 * We add a left-side accent bar on active items.
 *
 * PROPS:
 * - onNavigate: optional callback fired when a nav item is clicked.
 *   Used by mobile drawer to close itself after navigation.
 */

// Nav items — extend this list as new pages are built.
// permission: optional PERMISSIONS key. If omitted, item is visible to all
// authenticated users.
const NAV_ITEMS = [
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    permission: PERMISSIONS.VIEW_DASHBOARD,
  },
  {
    to: "/products",
    label: "Products",
    icon: Package,
    permission: PERMISSIONS.VIEW_PRODUCTS,
  },
  {
    to: "/brands",
    label: "Brands",
    icon: Tag,
    permission: PERMISSIONS.MANAGE_BRANDS,
  },
];
const Sidebar = ({ onNavigate }) => {
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const { can } = usePermissions();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.permission || can(item.permission),
  );

  return (
    <aside
      className={`
        h-full flex flex-col
        bg-white dark:bg-slate-900
        border-r border-slate-200 dark:border-slate-800
        transition-[width] duration-200 ease-in-out
        ${collapsed ? "w-16" : "w-60"}
      `}
    >
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3">
        <ul className="space-y-0.5 px-2">
          {visibleItems.map((item) => (
            <li key={item.to}>
              <NavItem
                item={item}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      </nav>

      <div className="hidden lg:block border-t border-slate-200 dark:border-slate-800 p-2">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="
            w-full flex items-center justify-center
            h-9 rounded-lg
            text-slate-500 dark:text-slate-400
            hover:bg-slate-100 dark:hover:bg-slate-800
            hover:text-slate-700 dark:hover:text-slate-200
            transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
          "
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>
    </aside>
  );
};

const NavItem = ({ item, collapsed, onNavigate }) => {
  const Icon = item.icon;

  const linkClass = ({ isActive }) => `
    relative flex items-center gap-3
    h-10 px-3 rounded-lg
    text-sm font-medium
    transition-colors
    focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
    ${
      isActive
        ? "bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300"
        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
    }
  `;

  const linkContent = ({ isActive }) => (
    <>
      {isActive && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-cyan-500 dark:bg-cyan-400 rounded-r"
          aria-hidden="true"
        />
      )}
      <Icon size={18} className="flex-shrink-0" />
      <span
        className={`
          truncate transition-opacity duration-200
          ${collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"}
        `}
      >
        {item.label}
      </span>
    </>
  );

  const link = (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={linkClass}
      end={item.to === "/dashboard"}
    >
      {linkContent}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip content={item.label} side="right">
        {link}
      </Tooltip>
    );
  }

  return link;
};

export default Sidebar;
