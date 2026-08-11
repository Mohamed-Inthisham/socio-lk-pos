import { Sun, Moon } from "lucide-react";
import useThemeStore from "../../../store/zustand/themeStore";

/**
 * ThemeToggle Component
 *
 * A single-icon button that flips between light and dark modes.
 * Shows a Sun icon in dark mode (implying "click to go light") and a
 * Moon icon in light mode. Standard convention.
 *
 * Sized as a 40x40 touch target — meets accessibility minimums on mobile.
 */
const ThemeToggle = () => {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const toggle = useThemeStore((s) => s.toggle);
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="
        w-10 h-10 flex items-center justify-center
        rounded-lg border border-slate-200 dark:border-slate-700
        bg-white dark:bg-slate-800
        text-slate-600 dark:text-slate-300
        hover:bg-slate-50 dark:hover:bg-slate-700
        hover:text-slate-900 dark:hover:text-white
        transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2
        dark:focus-visible:ring-offset-slate-900
      "
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
};

export default ThemeToggle;
