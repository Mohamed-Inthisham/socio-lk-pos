import { formatLKR } from "../../../utils/money";
import { describeDifferenceForDisplay } from "../../../utils/cashDayMath";

/**
 * CashDayFigures Component
 *
 * A day's cash figures as the close dialog shows them (planning doc P9-5,
 * P9-6, P9-11): opening, cash sales, cash refunds, earlier sales voided
 * (cash back), expected, then counted and the difference in words. Every
 * amount is the server's (GET /cash-days/:id/summary, or the closed day);
 * nothing is worked out here except formatting.
 *
 * PROPS:
 * - figures: { opening_balance, cash_sales, cash_refunds,
 *   cash_voids_earlier, expected_balance } as 2-decimal strings
 * - countedText: the counted amount to show ("15400.00"), or null while
 *   not typed yet
 * - differenceCents: counted − expected in cents, or null / NaN while
 *   not known
 */

const Row = ({ label, value, strong = false, testId }) => (
  <div className={`flex items-baseline justify-between gap-4 py-1 ${strong ? "font-semibold text-slate-900 dark:text-slate-100" : ""}`}>
    <dt className={strong ? "" : "text-slate-600 dark:text-slate-400"}>{label}</dt>
    <dd className="tabular-nums text-right" data-testid={testId}>
      {value}
    </dd>
  </div>
);

const CashDayFigures = ({ figures, countedText, differenceCents }) => {
  const known = Number.isFinite(differenceCents);
  return (
    <dl className="text-sm" data-testid="cash-day-figures">
      <Row label="Opening" value={formatLKR(figures.opening_balance)} />
      <Row label="Cash sales" value={formatLKR(figures.cash_sales)} />
      <Row label="Cash refunds" value={formatLKR(figures.cash_refunds)} />
      <Row label="Earlier sales voided (cash back)" value={formatLKR(figures.cash_voids_earlier)} />
      <div className="border-t border-slate-200 dark:border-slate-700 mt-1 pt-1">
        <Row label="Expected" value={formatLKR(figures.expected_balance)} strong testId="figure-expected" />
        <Row label="Counted" value={countedText ? formatLKR(countedText) : "—"} testId="figure-counted" />
        <Row
          label="Difference"
          value={known ? describeDifferenceForDisplay(differenceCents) : "—"}
          strong
          testId="figure-difference"
        />
      </div>
    </dl>
  );
};

export default CashDayFigures;
