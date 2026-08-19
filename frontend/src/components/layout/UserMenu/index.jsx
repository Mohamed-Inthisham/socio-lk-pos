import { Fragment } from "react";
import {
  Menu,
  MenuButton,
  MenuItems,
  MenuItem,
  Transition,
} from "@headlessui/react";
import { useDispatch, useSelector } from "react-redux";
import { LogOut, ChevronDown } from "lucide-react";
import { logoutUser } from "../../../store/slices/authSlice";
import { ROLE_INFO } from "../../../constants/rolePermissions";

/**
 * UserMenu Component
 *
 * Dropdown menu triggered by the user's avatar + name in the header.
 * Uses Headless UI Menu for accessible keyboard nav + click-outside.
 *
 * TRIGGER (on the header):
 * - Avatar circle with initials, colored by role
 * - Name text (hidden on mobile — space is precious there)
 * - Chevron indicator
 *
 * DROPDOWN CONTENT:
 * - Header block: full name + email + role badge
 * - Divider
 * - Logout action
 */

// Compute initials from the user's name.
// "John Doe" → "JD", "Jane" → "J", "test@example.com" → "T"
const getInitials = (name, email) => {
  const source = (name || email || "").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0][0].toUpperCase();
};

const UserMenu = () => {
  const dispatch = useDispatch();
  const user = useSelector((state) => state.auth.user);

  if (!user) return null;

  const initials = getInitials(user.name, user.email);
  const roleInfo = ROLE_INFO[user.role] || {};

  const handleLogout = () => {
    dispatch(logoutUser());
  };

  return (
    <Menu as="div" className="relative">
      <MenuButton
        className="
          flex items-center gap-2
          h-10 pl-1 pr-2 sm:pr-3 rounded-full
          hover:bg-slate-100 dark:hover:bg-slate-800
          transition-colors
          focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
        "
      >
        <span
          className="
            w-8 h-8 flex items-center justify-center rounded-full
            text-xs font-semibold
            bg-cyan-100 dark:bg-cyan-900/50
            text-cyan-700 dark:text-cyan-300
          "
        >
          {initials}
        </span>
        <span className="hidden sm:inline text-sm font-medium text-slate-700 dark:text-slate-200 max-w-[8rem] truncate">
          {user.name || user.email}
        </span>
        <ChevronDown
          size={14}
          className="hidden sm:block text-slate-400 dark:text-slate-500"
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
          <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              {user.name || "—"}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {user.email}
            </p>
            {roleInfo.label && (
              <span
                className={`
                  inline-flex items-center mt-2 px-2 py-0.5 rounded-full
                  text-[10px] font-semibold uppercase tracking-wider
                  ${roleInfo.color || "bg-slate-100 text-slate-700"}
                `}
              >
                {roleInfo.emoji} {roleInfo.label}
              </span>
            )}
          </div>

          <div className="py-1">
            <MenuItem>
              <button
                type="button"
                onClick={handleLogout}
                className="
                  w-full flex items-center gap-2.5
                  px-3 py-2 rounded-md
                  text-sm text-slate-700 dark:text-slate-200
                  data-[focus]:bg-red-50 dark:data-[focus]:bg-red-900/30
                  data-[focus]:text-red-700 dark:data-[focus]:text-red-300
                  transition-colors
                "
              >
                <LogOut size={16} className="flex-shrink-0" />
                <span>Log out</span>
              </button>
            </MenuItem>
          </div>
        </MenuItems>
      </Transition>
    </Menu>
  );
};

export default UserMenu;
