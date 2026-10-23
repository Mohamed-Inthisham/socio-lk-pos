import { useRef } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Button from "../../common/Button";
import { formatColomboDayLabel } from "../../../utils/colomboDay";

/**
 * DayStepper Component
 *
 * ← "Today · Thu 22 Oct 2026" → for the recent-sales list (P6-2). One
 * Colombo day at a time; no stepping past today. While a search is on
 * (P6-3: a search ignores the day) it reads "All dates" and the arrows are
 * disabled. The page binds ←/→ to the same moves.
 *
 * PICKING A DAY: the label is a button that opens the browser's own date
 * picker (an <input type="date"> laid over the label, opened with
 * showPicker(), or focused where showPicker isn't supported). It starts on
 * the day shown, goes no later than today (Colombo), and has no earliest
 * day. Choosing a date calls onPick; cancelling sends no change, so
 * nothing happens. During a search the label still opens it: choosing a
 * day ends the search and shows that day; cancelling keeps the search.
 *
 * PROPS:
 * - day: "YYYY-MM-DD"
 * - today: "YYYY-MM-DD" (colomboToday())
 * - onStep: (delta) => void — the ‹ and › buttons (−1 / +1)
 * - onToday: () => void — the Today button (shown on any other day)
 * - onPick: (day) => void — a day chosen in the picker (never after today)
 * - searching: the search box is in use
 */

const arrowClass = `
  w-9 h-9 flex items-center justify-center rounded-lg
  text-slate-600 dark:text-slate-300
  hover:bg-slate-100 dark:hover:bg-slate-800
  disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent
  focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
`;

const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const DayStepper = ({ day, today, onStep, onToday, onPick, searching = false }) => {
  const pickerRef = useRef(null);
  const isToday = day === today;
  const label = searching
    ? "All dates"
    : `${isToday ? "Today · " : ""}${formatColomboDayLabel(day)}`;

  const openPicker = () => {
    const input = pickerRef.current;
    if (!input) return;
    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
    } catch {
      // showPicker can refuse (e.g. outside a user gesture): fall back.
    }
    input.focus();
  };

  const onChange = (e) => {
    const value = e.target.value;
    // An empty value (cleared) or anything after today changes nothing.
    if (!DAY_SHAPE.test(value) || value > today) return;
    if (value === day && !searching) return;
    onPick?.(value);
  };

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
      <div className="relative">
        <button
          type="button"
          data-testid="day-label"
          onClick={openPicker}
          title={searching ? "Pick a day (ends the search)" : "Pick a day"}
          aria-haspopup="dialog"
          className={`
            min-w-46 h-9 px-2 inline-flex items-center justify-center gap-1.5 rounded-lg
            text-sm font-semibold whitespace-nowrap cursor-pointer
            hover:bg-slate-100 dark:hover:bg-slate-800
            focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
            ${searching ? "text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-100"}
          `}
        >
          <CalendarDays size={14} aria-hidden="true" className="shrink-0 opacity-70" />
          <span aria-live="polite">{label}</span>
        </button>
        {/* The native picker, laid over the label so it opens there. Not a
            tab stop and not clickable itself: the label opens it. */}
        <input
          ref={pickerRef}
          type="date"
          data-testid="day-picker"
          aria-label="Pick a day"
          tabIndex={-1}
          value={day}
          max={today}
          onChange={onChange}
          className="absolute inset-0 w-full h-full opacity-0 pointer-events-none scheme-light dark:scheme-dark"
        />
      </div>
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
