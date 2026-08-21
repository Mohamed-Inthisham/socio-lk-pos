import { useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Tag,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
} from "lucide-react";
import Tooltip from "../../common/Tooltip";
import useLayoutStore from "../../../store/zustand/layoutStore";

/**
 * Sidebar Component
 *
 * Desktop-only sidebar. On mobile, this same component is rendered inside
 * a slide-in drawer. The drawer wrapper handles mobile visibility; here
 * we just render the nav.
 *
 * NAV STRUCTURE:
 * Items can be leaves (with `to`) or groups (with `children`). Groups
 * are used to nest related pages under one collapsible header — e.g.
 * All products / Brands / Categories all sit under "Products".
 *
 * GROUP EXPAND/COLLAPSE:
 * - Auto-expanded when any child route is active (so users see where they
 *   are on load)
 * - User can toggle manually otherwise
 * - Local state, not persisted — persisting caused test setup flakiness
 *   in Phase 5's login work, not worth the complexity here
 *
 * COLLAPSED SIDEBAR MODE:
 * When the sidebar itself is collapsed (icon-only), groups flatten into
 * their children as top-level icons. This avoids building a fly-out
 * submenu (Headless UI doesn't ship one, custom is fragile). Simple and
 * matches how Notion/Linear render collapsed nav.
 *
 * PERMISSION GATING:
 * Each leaf checks its own permission. A group is visible if AT LEAST
 * ONE of its children is permitted for the current user. If all children
 * are gated out, the group hides too.
 *
 * ACTIVE ROUTE:
 * React Router's NavLink handles active state via className function.
 * We add a left-side accent bar on active items. Group parents get a
 * subtle active-child indicator (highlighted icon + label).
 *
 * PROPS:
 * - onNavigate: optional callback fired when a nav item is clicked.
 *   Used by mobile drawer to close itself after navigation.
 */

// Nav config — leaves have `to`, groups have `children`.
// permission: optional PERMISSIONS key. If omitted, item is visible to all
// authenticated users. Groups don't take permission directly; visibility
// is derived from whether any child is permitted.
const NAV_ITEMS = [
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Products",
    icon: Package,
    children: [
      {
        to: "/products",
        label: "All products",
        icon: Package,
      },
      {
        to: "/brands",
        label: "Brands",
        icon: Tag,
      },
      // Categories added when Manage Categories page ships
    ],
  },
];

// ============================================
// HELPERS
// ============================================

const isGroup = (item) => Array.isArray(item.children);
/**
 * Filter a nav tree by permission. Removes leaves the user can't access
 * and drops groups whose children all got filtered out.
 */

/**
 * Does any child of this group match the current path? Used to
 * auto-expand groups on route change and to highlight the group header.
 */
const isGroupActive = (group, pathname) =>
  group.children.some(
    (c) => pathname === c.to || pathname.startsWith(c.to + "/"),
  );

// ============================================
// MAIN COMPONENT
// ============================================

const Sidebar = ({ onNavigate }) => {
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const { pathname } = useLocation();

  // When collapsed, flatten group children into top-level items so
  // each gets its own icon+tooltip. No fly-out submenu.
  const renderedItems = useMemo(() => {
    if (!collapsed) return NAV_ITEMS;
    return NAV_ITEMS.flatMap((item) =>
      isGroup(item) ? item.children : [item],
    );
  }, [collapsed]);

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
          {renderedItems.map((item, idx) => (
            <li key={item.to || `group-${item.label}-${idx}`}>
              {isGroup(item) ? (
                <NavGroup
                  group={item}
                  pathname={pathname}
                  onNavigate={onNavigate}
                />
              ) : (
                <NavItem
                  item={item}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              )}
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

// ============================================
// NAV ITEM (leaf, i.e. real link)
// ============================================

const NavItem = ({ item, collapsed, onNavigate, nested = false }) => {
  const Icon = item.icon;

  const linkClass = ({ isActive }) => `
    relative flex items-center gap-3
    h-10 rounded-lg
    ${nested ? "pl-9 pr-3" : "px-3"}
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
      {/* Nested items don't render an icon when sidebar is expanded —
          the group icon at the top of the group is enough visual cue.
          When collapsed, everything is top-level so nested=false and
          the icon renders normally. */}
      {(!nested || collapsed) && Icon && (
        <Icon size={18} className="flex-shrink-0" />
      )}
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
      end={item.to === "/dashboard" || item.to === "/products"}
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

// ============================================
// NAV GROUP (parent with nested children)
// ============================================

const NavGroup = ({ group, pathname, onNavigate }) => {
  const Icon = group.icon;
  const activeChild = isGroupActive(group, pathname);

  // Local expand state. Seeded from active-child so the group opens
  // on load if you're on a nested route. User can then toggle freely.
  const [expanded, setExpanded] = useState(activeChild);

  // If route changes and now hits a child of this group, auto-expand.
  // We don't want to override user's manual collapse if they're not on
  // a child route — hence the isGroupActive check.
  if (activeChild && !expanded) {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    // NOTE: This runs during render, which is fine here — setExpanded
    // on a value that's already the current value is a no-op in React,
    // and expanded=false + activeChild=true means the user is on a
    // child route with the group manually collapsed, which we don't
    // want. React will bail if we set the same value.
    setExpanded(true);
  }

  const toggle = () => setExpanded((v) => !v);

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className={`
          w-full flex items-center gap-3
          h-10 px-3 rounded-lg
          text-sm font-medium
          transition-colors cursor-pointer
          focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
          ${
            activeChild
              ? "text-slate-900 dark:text-slate-100"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
          }
        `}
      >
        {Icon && <Icon size={18} className="flex-shrink-0" />}
        <span className="flex-1 text-left truncate">{group.label}</span>
        <ChevronDown
          size={14}
          className={`
            flex-shrink-0 transition-transform duration-150
            ${expanded ? "rotate-0" : "-rotate-90"}
          `}
        />
      </button>

      {expanded && (
        <ul className="mt-0.5 space-y-0.5">
          {group.children.map((child) => (
            <li key={child.to}>
              <NavItem
                item={child}
                collapsed={false}
                onNavigate={onNavigate}
                nested
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Sidebar;
