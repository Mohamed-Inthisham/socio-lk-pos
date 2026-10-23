import { useState } from "react";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { ArrowLeft } from "lucide-react";
import Button from "../../common/Button";
import ScrollFade from "../../common/ScrollFade";
import SaleStatusBadge from "../SaleStatusBadge";
import SaleDetailLines from "../SaleDetailLines";
import SaleDetailReturns from "../SaleDetailReturns";
import SaleDetailTenders from "../SaleDetailTenders";
import VoidedSaleBanner from "../VoidedSaleBanner";
import { formatLKR, fromCents } from "../../../utils/money";
import { refundedCents, saleReturnState } from "../../../utils/returnMath";
import { formatSlPhone } from "../../../utils/phone";
import { receiptDateTime } from "../../../utils/receipt";

/**
 * SaleDetailView Component
 *
 * A completed or voided sale, read-only (planning doc P6-6):
 * - Header: sale number, status, completion time, cashier, customer name
 *   and phone (never the NIC, as the receipt), or Walk-in
 * - Voided: a banner with when, why, who approved it and whose session
 * - Lines (SaleDetailLines); tenders (SaleDetailTenders); totals
 * - Returns (P7-18): a Part returned / Returned badge by the status, a
 *   Refunded row under the totals (the sale's own figures never change),
 *   and the left card's title as two tabs, Items and Returns
 *   (SaleDetailReturns, with Reprint slip); with no returns, no tabs.
 *   Arrow keys move between the tabs, so they never clash with the page's
 *   P, V, R and Esc
 * - Actions: what the page passes (Reprint; Void in D2)
 *
 * LAYOUT (P6-14): ≥ lg two columns that never scroll the page: lines on
 * the left, tenders, totals and actions on the right. Totals and actions
 * share one card at the bottom of the right column, its own region in the
 * column's flex layout (not sticky); the tenders card above it shrinks
 * and scrolls inside, clipped at its own edge, so the total is always in
 * view (measured at 1366×650 and 1526×640). Both lists fade at the bottom
 * while there is more below (ScrollFade). < lg one column and the page
 * scrolls.
 *
 * PROPS:
 * - sale: the hydrated sale (GET /sales/:id)
 * - today: "YYYY-MM-DD" in Colombo (warranty Expired tags)
 * - onBack: () => void — back to the list (Esc)
 * - backLabel: the back button's label, "Sales" by default ("Phones to
 *   check" when opened from there)
 * - actions: ReactNode for the actions dock
 * - returnActions: { onReprint, reprinting, errors, disabled } for the
 *   Returns tab's Reprint slip (SaleDetailReturns)
 * - initialTab: "items" (default) or "returns" (opened from a search for
 *   one of this sale's RET numbers)
 */

const Card = ({ className = "", children, ...rest }) => (
  <div
    className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm ${className}`}
    {...rest}
  >
    {children}
  </div>
);

const CardTitle = ({ children }) => (
  <p className="px-4 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
    {children}
  </p>
);

const TotalRow = ({ label, value, strong = false }) => (
  <div className={`flex justify-between gap-3 ${strong ? "text-base font-semibold text-slate-900 dark:text-slate-100" : ""}`}>
    <dt>{label}</dt>
    <dd className="tabular-nums">{value}</dd>
  </div>
);

const TAB_CLASS = `
  px-2.5 py-1.5 -mb-px border-b-2 border-transparent rounded-t-md
  text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400
  hover:text-slate-800 dark:hover:text-slate-200
  data-selected:border-cyan-500 data-selected:text-slate-900 dark:data-selected:text-slate-100
  focus:outline-none data-focus:ring-2 data-focus:ring-cyan-500
`;

const SaleDetailView = ({
  sale,
  today,
  onBack,
  backLabel = "Sales",
  actions,
  returnActions = {},
  initialTab = "items",
}) => {
  const voided = sale.status === "VOIDED";
  const lines = sale.lines ?? [];
  const payments = sale.payments ?? [];
  const returns = sale.returns ?? [];
  const items = lines.reduce((sum, l) => sum + l.quantity, 0);
  const refunded = refundedCents(sale);
  const returnState = saleReturnState(sale);
  // Kept while the page shows this sale: a return made here keeps the tab
  // (the Returns count updates); not kept in the URL.
  const [tab, setTab] = useState(initialTab === "returns" && returns.length > 0 ? 1 : 0);

  const linesPanel = (
    <ScrollFade
      className="lg:flex-1 lg:min-h-0 lg:flex lg:flex-col"
      scrollClassName="lg:flex-1 lg:min-h-0 lg:overflow-y-auto"
      testId="detail-lines-scroll"
    >
      <SaleDetailLines lines={lines} today={today} />
    </ScrollFade>
  );

  return (
    <div className="h-full overflow-y-auto lg:overflow-hidden">
      <div className="min-h-full lg:h-full flex flex-col gap-3 p-3 sm:p-4">
        <Card className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button size="sm" variant="ghost" icon={ArrowLeft} label={backLabel} title={backLabel === "Sales" ? "Back to the sales list (Esc)" : `Back to ${backLabel} (Esc)`} onClick={onBack} className="-ml-2" />
            <h1 className="text-lg font-semibold tabular-nums">{sale.sale_number}</h1>
            <SaleStatusBadge state={voided ? "VOIDED" : "COMPLETED"} />
            {returnState !== "NONE" && <SaleStatusBadge state={returnState} />}
          </div>
          <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600 dark:text-slate-300" data-testid="detail-meta">
            <div className="flex gap-1.5">
              <dt className="text-slate-400 dark:text-slate-500">Completed</dt>
              <dd>{receiptDateTime(sale.completed_at)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-slate-400 dark:text-slate-500">Cashier</dt>
              <dd>{sale.cashier?.full_name ?? "—"}</dd>
            </div>
            <div className="flex gap-1.5 min-w-0">
              <dt className="text-slate-400 dark:text-slate-500">Customer</dt>
              <dd className="min-w-0 truncate">
                {sale.customer
                  ? `${sale.customer.name}${sale.customer.phone ? ` · ${formatSlPhone(sale.customer.phone)}` : ""}`
                  : "Walk-in"}
              </dd>
            </div>
          </dl>
        </Card>

        {voided && <VoidedSaleBanner sale={sale} />}

        <div className="flex-1 lg:min-h-0 flex flex-col lg:flex-row gap-3">
          {/* One card, the whole column ≥ lg. With returns its title becomes
              two tabs, Items and Returns (measured: a Returns card under
              Items left one line and no whole return in view at ~640px). */}
          <Card className="flex-1 min-w-0 lg:min-h-0 flex flex-col overflow-hidden" data-testid="detail-main">
            {returns.length === 0 ? (
              <>
                <CardTitle>
                  Items · {items}
                </CardTitle>
                {linesPanel}
              </>
            ) : (
              <TabGroup selectedIndex={tab} onChange={setTab} className="lg:flex-1 lg:min-h-0 flex flex-col">
                <TabList
                  aria-label="Items and returns"
                  className="flex gap-1 px-2 pt-2 border-b border-slate-100 dark:border-slate-800"
                >
                  <Tab className={TAB_CLASS}>Items · {items}</Tab>
                  <Tab className={TAB_CLASS}>Returns · {returns.length}</Tab>
                </TabList>
                <TabPanels className="lg:flex-1 lg:min-h-0 flex flex-col">
                  <TabPanel className="lg:flex-1 lg:min-h-0 flex flex-col focus:outline-none">{linesPanel}</TabPanel>
                  <TabPanel className="lg:flex-1 lg:min-h-0 flex flex-col focus:outline-none">
                    <ScrollFade
                      className="lg:flex-1 lg:min-h-0 lg:flex lg:flex-col"
                      scrollClassName="lg:flex-1 lg:min-h-0 lg:overflow-y-auto"
                      testId="detail-returns-scroll"
                    >
                      <SaleDetailReturns sale={sale} {...returnActions} />
                    </ScrollFade>
                  </TabPanel>
                </TabPanels>
              </TabGroup>
            )}
          </Card>

          <aside
            aria-label="Payment"
            className="lg:w-96 xl:w-104 shrink-0 flex flex-col gap-3 lg:min-h-0"
            data-testid="detail-side"
          >
            {/* Its natural height when it fits; ≥ lg it shrinks to the space
                above the totals card and scrolls inside, clipped at its own
                bottom edge (nothing passes under the totals). */}
            <Card className="lg:min-h-0 flex flex-col overflow-hidden">
              <CardTitle>Tenders</CardTitle>
              <ScrollFade
                className="lg:flex-1 lg:min-h-0 lg:flex lg:flex-col"
                scrollClassName="lg:flex-1 lg:min-h-0 lg:overflow-y-auto"
                testId="detail-tenders-scroll"
              >
                <SaleDetailTenders payments={payments} />
              </ScrollFade>
            </Card>

            {/* Totals and actions: their own region at the bottom of the
                column, never shrunk, so the total stays in view at ~640px. */}
            <div className="shrink-0 lg:mt-auto" data-testid="detail-actions">
              <Card className="px-4 py-3">
                <dl className="space-y-0.5 text-sm text-slate-600 dark:text-slate-300" aria-label="Totals">
                  <TotalRow label="Subtotal" value={formatLKR(sale.subtotal)} />
                  {Number(sale.discount_total) > 0 && (
                    <TotalRow label="Discount" value={`−${formatLKR(sale.discount_total)}`} />
                  )}
                  <TotalRow label="Total" value={formatLKR(sale.total)} strong />
                  <TotalRow label="Paid" value={formatLKR(sale.amount_paid)} />
                  {Number(sale.change_due) > 0 && <TotalRow label="Change" value={formatLKR(sale.change_due)} />}
                  {refunded > 0 && <TotalRow label="Refunded" value={formatLKR(fromCents(refunded))} />}
                </dl>
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">{actions}</div>
              </Card>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default SaleDetailView;
