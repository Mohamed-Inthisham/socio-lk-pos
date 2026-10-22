import { ChevronLeft, ChevronRight } from "lucide-react";
import Button from "../../common/Button";
import { formatColomboDayLabel } from "../../../utils/colomboDay";

/**
 * DayStepper Component
 *
 * ← "Today · Thu 22 Oct 2026" → for the recent-sales list (P6-2). One
 * Colombo day at a time; no stepping past today. While a search is on
 * (P6-3: a search ignores the day) it reads "All dates" and is disabled.
 * The page binds ←/→ to the same moves.
 *
 * PROPS:
 * - day: "YYYY-MM-DD"
 * - today: "YYYY-MM-DD" (colomboToday())
 * - onStep: (delta) => void — the ‹ and › buttons (−1 / +1)
 * - onToday: () => void — the Today button (shown on any other day)
 * - searching: the search box is in use
 */

const arrowClass = `
  w-9 h-9 flex items-center justify-center rounded-lg
  text-slate-600 dark:text-slate-300
  hover:bg-slate-100 dark:hover:bg-slate-800
  disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent
  focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
`;

const DayStepper = ({ day, today, onStep, onToday, searching = false }) => {
  const isToday = day === today;
  const label = searching
    ? "All dates"
    : `${isToday ? "Today · " : ""}${formatColomboDayLabel(day)}`;

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Day">
      <button
        type="button"
        className={arrowClass}
        aria-label="Previous day"
        title="Previous day (←)"
        disabled={searching}
        onClick={() => onStep(-1)}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <p
        data-testid="day-label"
        aria-live="polite"
        className={`
          min-w-46 text-center text-sm font-semibold whitespace-nowrap
          ${searching ? "text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-100"}
        `}
      >
        {label}
      </p>
      <button
        type="button"
        className={arrowClass}
        aria-label="Next day"
        title="Next day (→)"
        disabled={searching || isToday}
        onClick={() => onStep(1)}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      {!isToday && !searching && (
        <Button size="sm" variant="secondary" label="Today" onClick={onToday} className="ml-1" />
      )}
    </div>
  );
};

export default DayStepper;
