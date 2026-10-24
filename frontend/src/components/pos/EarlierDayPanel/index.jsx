import { CalendarX } from "lucide-react";
import Button from "../../common/Button";
import TerminalPanel from "../TerminalPanel";
import { formatColomboDayLabel } from "../../../utils/colomboDay";
import { shortDayLabel } from "../../../utils/cashDayLabels";

/**
 * EarlierDayPanel Component
 *
 * What the day gate shows while an earlier day is still open (planning
 * doc P9-7): "Mon 19 Oct 2026 was not closed. Close it before opening
 * today." The server refuses today's opening until it is closed
 * (EARLIER_DAY_NOT_CLOSED).
 *
 * PROPS:
 * - businessDate: the earlier day still open, "YYYY-MM-DD"
 * - today: the server's business_date (for the button's short label)
 * - onCloseDay: optional; when given, a "Close Mon 19 Oct" button calls
 *   it (CloseDayDialog, P9 step C). Without it the panel only tells.
 */

const EarlierDayPanel = ({ businessDate, today, onCloseDay }) => (
  <TerminalPanel icon={CalendarX} tone="warning" title="An earlier day is still open">
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
      {formatColomboDayLabel(businessDate)} was not closed. Close it before opening today.
    </p>
    {onCloseDay && (
      <div className="mt-5">
        <Button
          variant="accent"
          label={`Close ${shortDayLabel(businessDate, today)}`}
          onClick={onCloseDay}
        />
      </div>
    )}
  </TerminalPanel>
);

export default EarlierDayPanel;
