import { AlertTriangle } from "lucide-react";

/**
 * StockShortfallAlert Component
 *
 * "Not enough stock": every product the sale needs more of than the
 * branch has (posTerminalSlice selectStockShortfall), and the way out.
 * Shown at the top of the terminal's cart column, where the shortage
 * blocks Pay, and in the CompleteSaleDialog, which adds Check again.
 *
 * PROPS:
 * - items: [{ product_id, name, required, available }]
 * - className: spacing and text size from the parent
 * - children: an action under the text (the dialog's Check again)
 */
const StockShortfallAlert = ({ items, className = "", children }) => (
  <div
    role="alert"
    data-testid="stock-shortfall"
    className={`rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-amber-800 dark:text-amber-200 ${className}`}
  >
    <p className="flex items-center gap-1.5 font-semibold">
      <AlertTriangle size={14} aria-hidden="true" />
      Not enough stock
    </p>
    <ul className="mt-1 space-y-0.5">
      {items.map((item) => (
        <li key={item.product_id}>
          {item.name}: {item.required} needed, {item.available} in stock
        </li>
      ))}
    </ul>
    <p className="mt-1 text-xs">Remove or reduce the item, or ask a manager to adjust stock.</p>
    {children}
  </div>
);

export default StockShortfallAlert;
