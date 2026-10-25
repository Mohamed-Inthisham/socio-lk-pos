import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import useTerminalBranch from "../../../hooks/useTerminalBranch";
import { fetchCurrentCashDay, selectCashDayCurrent } from "../../../store/slices/cashDaySlice";

/**
 * Loads the selected branch's cash-day state for the app-shell Sales pages.
 * Browsing history remains available when a day is closed; SaleDetail uses
 * this state to hide void and refund actions when today's till is closed.
 */
const SalesArea = () => {
  const dispatch = useDispatch();
  const { branchId } = useTerminalBranch();
  const loadedBranchId = useSelector((state) => state.cashDay.branchId);
  const current = useSelector(selectCashDayCurrent);

  useEffect(() => {
    if (branchId && branchId !== loadedBranchId) {
      dispatch(fetchCurrentCashDay({ branchId }));
    }
  }, [branchId, dispatch, loadedBranchId]);

  if (!branchId) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400" role="status">
        Choose a branch from the header to view sales and cash days.
      </div>
    );
  }
  if (loadedBranchId !== branchId || current.status === "idle" || current.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-slate-500 dark:text-slate-400" role="status">
        Loading branch cash-day status…
      </div>
    );
  }

  return <Outlet />;
};

export default SalesArea;
