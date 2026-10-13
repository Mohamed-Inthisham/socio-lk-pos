import { ScanBarcode } from "lucide-react";
import useTerminalBranch from "../../hooks/useTerminalBranch";

/**
 * PosTerminal Page
 *
 * Route: /pos. Phase 6.4 P0 ships the empty shell only — the scan bar,
 * cart, totals and payments arrive in P1 and replace this empty state.
 */
const PosTerminal = () => {
  const { branch } = useTerminalBranch();

  return (
    <div className="h-full flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center bg-cyan-50 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300">
          <ScanBarcode size={28} aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          Terminal ready
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {branch?.name ? `${branch.name} · ` : ""}Scanning, cart and payments
          arrive in the next slice.
        </p>
      </div>
    </div>
  );
};

export default PosTerminal;
