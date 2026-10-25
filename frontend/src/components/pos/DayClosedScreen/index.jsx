import { Link } from "react-router-dom";
import { CalendarCheck, ReceiptText, History } from "lucide-react";
import Button from "../../common/Button";
import TerminalPanel from "../TerminalPanel";
import { describeDifferenceForDisplay } from "../../../utils/cashDayMath";
import { formatColomboDayLabel } from "../../../utils/colomboDay";
import { formatColomboTime } from "../../../utils/colomboTime";
import { formatLKR, toCents } from "../../../utils/money";

/**
 * DayClosedScreen Component
 *
 * What /pos shows once today is closed (planning doc P9-14): the day,
 * when and by whom it closed, the counted cash and the difference. No new
 * sales until tomorrow's opening; Recent sales and Sale detail stay
 * readable (without Void or Return items).
 *
 * The heading takes focus (tabIndex -1) after the close dialog.
 *
 * PROPS:
 * - day: today's closed cash day
 * - pastDaysTo: optional; when given, a Past days link (step F)
 */

const linkClass = `
  h-10 inline-flex items-center gap-2 px-4 rounded-lg text-sm font-semibold
  border border-slate-300 dark:border-slate-600
  text-slate-700 dark:text-slate-200
  hover:bg-slate-100 dark:hover:bg-slate-800
  focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
`;

const DayClosedScreen = ({ day, pastDaysTo }) => (
  <TerminalPanel icon={CalendarCheck} title="Day closed" titleTabIndex={-1} data-testid="day-closed-screen">
    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
      {formatColomboDayLabel(day.business_date)} · closed at {formatColomboTime(day.closed_at)} by{" "}
      {day.closed_by?.full_name}
    </p>
    <dl className="mt-4 text-sm">
      <div className="flex items-baseline justify-between gap-4 py-1">
        <dt className="text-slate-600 dark:text-slate-400">Counted</dt>
        <dd className="tabular-nums">{formatLKR(day.counted_balance)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-4 py-1 font-semibold">
        <dt>Difference</dt>
        <dd className="tabular-nums" data-testid="day-closed-difference">
          {describeDifferenceForDisplay(toCents(day.difference))}
        </dd>
      </div>
    </dl>
    <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
      No more sales today. The till opens again with tomorrow&apos;s opening balance.
    </p>
    <div className="mt-5 flex flex-wrap items-center gap-3">
      {pastDaysTo && (
        <Link to={pastDaysTo} className={linkClass}>
          <History size={16} aria-hidden="true" />
          Past days
        </Link>
      )}
      <Link to="/pos/sales" className={linkClass}>
        <ReceiptText size={16} aria-hidden="true" />
        Recent sales
      </Link>
    </div>
  </TerminalPanel>
);

export default DayClosedScreen;
