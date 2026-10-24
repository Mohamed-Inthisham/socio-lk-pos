import { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { AlertTriangle, Lock } from "lucide-react";
import Button from "../../common/Button";
import TerminalPanel from "../TerminalPanel";
import OpenDayDialog from "../OpenDayDialog";
import EarlierDayPanel from "../EarlierDayPanel";
import useTerminalBranch from "../../../hooks/useTerminalBranch";
import {
  GATE,
  fetchCurrentCashDay,
  gateStatusOf,
  selectCashDayCurrent,
  selectOpenDay,
} from "../../../store/slices/cashDaySlice";
import { cashDayErrorView } from "../../../utils/cashDayErrors";

/**
 * DayGate Component
 *
 * Wraps TerminalLayout's <Outlet/> (planning doc P9-7), so it covers every
 * terminal route: /pos, /pos/sales, /pos/sales/:id, /pos/inspection.
 * Nothing is sold, returned or voided before the day's opening: until
 * today is open the gate renders instead of the page, so no draft is made
 * and the page's hotkeys don't exist. The header and status strip stay.
 *
 * READS GET /cash-days/current on mount, when the branch changes (the
 * slice starts that branch from a clean state), when the tab becomes
 * visible again and on Try again.
 *
 * STATES (cashDaySlice current.status):
 * - idle / loading, no answer yet: a spinner
 * - no_day: OpenDayDialog
 * - earlier_open: EarlierDayPanel (closing it arrives with step C)
 * - open: the page
 * - closed: a placeholder until step C's Day closed screen
 * - error, no answer yet: the error with Try again
 *
 * A FAILED RE-READ keeps the last good answer on screen (the till keeps
 * its cart) with a one-line notice and Try again; the full error screen
 * is only for a gate that never had an answer. A re-read that answers
 * closed or earlier_open does replace the page.
 *
 * STABLE TREE: every state renders inside the same wrapper, so the notice
 * coming and going never remounts the page or the opening dialog (which
 * would lose the cart, or make a new request id).
 */

const Centred = ({ children }) => (
  <div className="h-full overflow-y-auto">
    <div className="min-h-full flex items-center justify-center p-4">{children}</div>
  </div>
);

const BackToDashboard = () => (
  <Link
    to="/dashboard"
    className="text-sm font-medium text-cyan-700 dark:text-cyan-400 hover:underline"
  >
    Back to dashboard
  </Link>
);

const RecheckNotice = ({ onRetry, reading }) => (
  <div
    role="status"
    data-testid="day-recheck-notice"
    className="
      flex-shrink-0 flex items-center gap-2 px-3 sm:px-4 py-1.5
      bg-amber-50 dark:bg-amber-950/40
      border-b border-amber-200 dark:border-amber-900
      text-xs text-amber-800 dark:text-amber-200
    "
  >
    <AlertTriangle size={14} aria-hidden="true" className="flex-shrink-0" />
    <span className="truncate">Couldn&apos;t re-check today&apos;s cash day.</span>
    <button
      type="button"
      onClick={onRetry}
      disabled={reading}
      className="ml-auto flex-shrink-0 font-semibold underline hover:no-underline disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded"
    >
      Try again
    </button>
  </div>
);

const DayGate = ({ children }) => {
  const dispatch = useDispatch();
  const { branch } = useTerminalBranch();
  const branchId = branch?.id;
  const current = useSelector(selectCashDayCurrent);
  const open = useSelector(selectOpenDay);

  const read = useCallback(() => {
    if (branchId) dispatch(fetchCurrentCashDay({ branchId }));
  }, [dispatch, branchId]);

  useEffect(() => {
    read();
  }, [read]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") read();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [read]);

  // The last answer the server gave, kept by the slice through a failed read.
  const lastGood =
    current.businessDate !== null
      ? gateStatusOf({ today: current.today, earlier_open: current.earlierOpen })
      : null;
  const retrying = current.status === GATE.LOADING || current.status === GATE.ERROR;
  const shown = retrying && lastGood ? lastGood : current.status;
  // The opening dialog already says when its own re-check failed.
  const showNotice =
    current.status === GATE.ERROR && lastGood !== null && !(shown === GATE.NO_DAY && open.error?.reconcile);

  let body;
  switch (shown) {
    case GATE.OPEN:
      body = children;
      break;
    case GATE.NO_DAY:
      body = (
        <Centred>
          <OpenDayDialog
            branchId={branchId}
            branchName={branch?.name}
            businessDate={current.businessDate}
            lastClosed={current.lastClosed}
          />
        </Centred>
      );
      break;
    case GATE.EARLIER_OPEN:
      body = (
        <Centred>
          <EarlierDayPanel businessDate={current.earlierOpen.business_date} today={current.businessDate} />
        </Centred>
      );
      break;
    case GATE.CLOSED:
      body = (
        <Centred>
          <TerminalPanel icon={Lock} title="Today is closed">
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Sales open again after tomorrow&apos;s opening.
            </p>
          </TerminalPanel>
        </Centred>
      );
      break;
    case GATE.ERROR:
      body = (
        <Centred>
          <TerminalPanel icon={AlertTriangle} tone="warning" title="Couldn't check today's cash day">
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {cashDayErrorView(current.error).message}
            </p>
            <div className="mt-5 flex items-center gap-4">
              <Button variant="accent" label="Try again" onClick={read} />
              <BackToDashboard />
            </div>
          </TerminalPanel>
        </Centred>
      );
      break;
    default:
      body = (
        <Centred>
          <div className="text-center" role="status">
            <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Checking today&apos;s cash day…</p>
          </div>
        </Centred>
      );
  }

  return (
    <div className="h-full flex flex-col">
      {showNotice && <RecheckNotice onRetry={read} reading={current.reading} />}
      <div className="flex-1 min-h-0" data-testid="day-gate-body">
        {body}
      </div>
    </div>
  );
};

export default DayGate;
