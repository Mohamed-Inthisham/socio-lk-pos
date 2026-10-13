import { Store } from "lucide-react";

/**
 * BranchChip Component
 *
 * Read-only pill showing a branch name. Used by BranchSelector for staff
 * (who can't switch) and by TerminalLayout for everyone — in the terminal,
 * branch switching happens only from the main app header.
 */
const BranchChip = ({ name, title }) => (
  <div
    className="
      flex items-center gap-1 sm:gap-2
      h-10 px-2 sm:px-3 rounded-full
      bg-slate-100 dark:bg-slate-800
      text-sm font-medium text-slate-700 dark:text-slate-200
    "
    title={title}
  >
    <Store
      size={14}
      className="text-slate-500 dark:text-slate-400 flex-shrink-0"
      aria-hidden="true"
    />
    <span className="max-w-[5rem] sm:max-w-[8rem] truncate">{name}</span>
  </div>
);

export default BranchChip;
