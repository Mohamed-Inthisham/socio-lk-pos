/**
 * DetailSection Component
 *
 * The titled card a detail page groups its information in, and the
 * label-and-value row inside it. Stacked on phones, side by side from sm.
 *
 * Section PROPS:
 * - title: the heading
 * - children: the section's content
 * - className: extra classes on the card
 *
 * Field PROPS:
 * - label: the row's caption
 * - value: text or a node; null or undefined shows as —
 * - mono: monospace, for identifiers
 */

const Section = ({ title, children, className = "" }) => (
  <div
    className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 ${className}`}
  >
    <h2 className="text-xs uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400 mb-4">
      {title}
    </h2>
    {children}
  </div>
);

export const Field = ({ label, value, mono = false }) => (
  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline gap-1 py-2 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
    <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">
      {label}
    </span>
    <span
      className={`text-sm text-slate-800 dark:text-slate-200 text-left sm:text-right ${
        mono ? "font-mono" : ""
      }`}
    >
      {value ?? "—"}
    </span>
  </div>
);

export default Section;
