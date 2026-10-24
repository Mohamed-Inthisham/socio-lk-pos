/**
 * TerminalPanel Component
 *
 * The centred card the terminal shows in place of a page: an icon, a
 * title and the body. Used by BranchContextGuard (no branch, a failed
 * branches read, pick a branch) and DayGate (opening the day, an earlier
 * day still open, today closed, a failed read).
 *
 * PROPS:
 * - icon: lucide-react component
 * - tone: "neutral" (cyan) | "warning" (amber)
 * - title: the heading text
 * - titleId: id for the heading, so a panel with role="dialog" can be
 *   aria-labelledby it
 * - any other prop (role, aria-*) goes on the card
 */

const TerminalPanel = ({ icon: Icon, tone = "neutral", title, titleId, children, ...rest }) => (
  <div
    className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-6"
    {...rest}
  >
    <div
      className={`
        w-11 h-11 rounded-xl flex items-center justify-center mb-4
        ${
          tone === "warning"
            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            : "bg-cyan-50 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300"
        }
      `}
    >
      <Icon size={22} aria-hidden="true" />
    </div>
    <h1 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
      {title}
    </h1>
    {children}
  </div>
);

export default TerminalPanel;
