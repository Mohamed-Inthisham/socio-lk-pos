import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { AlertCircle } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import ScrollFade from "../../common/ScrollFade";
import ReturnLineRow from "./ReturnLineRow";
import { itemsIssues, returnContext, returnFormDefaults } from "../../../schemas/returnSchema";
import { listStock } from "../../../services/stockService";
import { colomboToday } from "../../../utils/colomboDay";
import { formatLKR, fromCents, toCents } from "../../../utils/money";
import { formatSlPhone } from "../../../utils/phone";
import { receiptDate } from "../../../utils/receipt";
import { newClientRequestId } from "../../../utils/requestId";
import {
  daysSinceSale,
  lineDisposition,
  lineWarrantyStatus,
  refundShareCents,
  returnableQuantity,
} from "../../../utils/returnMath";

/**
 * ReturnDialog Component
 *
 * Return items from a COMPLETED sale (planning doc P7-16, P7-20). Two
 * steps in one form: 1 items, 2 refund and approval (step C).
 *
 * ITEMS: every line, in line order, with what is left to return
 * (ReturnLineRow): a quantity stepper capped at it; Back to stock /
 * Damaged where the cashier decides; "Goes to inspection" for our
 * phones, "Not our stock" for another shop's lines, "Not stock-tracked"
 * for untracked products (lineDisposition, P7-8); each line's warranty
 * status (P7-22). The header says how long ago it was sold (information
 * only, no time limit). Next checks the items alone (itemsIssues);
 * Back keeps them.
 *
 * STOCK TRACKING decides whether a line takes a condition, and sale lines
 * don't carry it: one GET /stock?branchId= when the dialog opens, only
 * when a line could need it (FOLLOWUPS). Until it answers Next waits; if
 * it fails, Try again.
 *
 * THE REQUEST ID (P7-15) is made once, when the dialog opens, and kept
 * for every attempt from this dialog (step C sends it).
 *
 * KEYS: each row is a stop; ↑/↓ move between rows, ←/→ (or −/+) change
 * the quantity, B / D pick Back to stock / Damaged, Enter is Next, Esc
 * closes. Page hotkeys stay off while a dialog is open.
 *
 * PROPS:
 * - open, onClose
 * - sale: the COMPLETED sale (hydrated, with returned_quantity and returns[])
 * - afterLeave: forwarded to Dialog (the page hands focus on)
 */

const STEP_ITEMS = "items";
const STEP_REFUND = "refund";

/** Whether any line still to return needs the stock-tracking read. */
const needsStockRead = (sale) =>
  sale.lines.some((l) => !l.external_supplier_id && !l.product_unit_id && returnableQuantity(l) > 0);

const soldLine = (sale, today) => {
  const days = daysSinceSale(sale, today);
  const when = receiptDate(colomboToday(new Date(sale.completed_at)));
  if (days === 0) return `Sold today · ${when}`;
  return `Sold ${days} ${days === 1 ? "day" : "days"} ago · ${when}`;
};

const customerLine = (sale) =>
  sale.customer
    ? `${sale.customer.name}${sale.customer.phone ? ` · ${formatSlPhone(sale.customer.phone)}` : ""}`
    : "Walk-in customer";

const ReturnDialog = ({ open, onClose, sale, afterLeave }) => {
  const [step, setStep] = useState(STEP_ITEMS);
  const [stock, setStock] = useState({ status: "loading", tracked: {} });
  const [stockAttempt, setStockAttempt] = useState(0);
  const [rowErrors, setRowErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [active, setActive] = useState(0);
  const requestId = useRef(null);
  const rowRefs = useRef({});

  const { reset, setValue, getValues, control } = useForm({ defaultValues: returnFormDefaults(sale) });
  const quantities = useWatch({ control, name: "quantities" });
  const conditions = useWatch({ control, name: "conditions" });

  const today = colomboToday();
  const openLines = sale.lines.filter((l) => returnableQuantity(l) > 0);
  const readNeeded = needsStockRead(sale);
  const stockReady = !readNeeded || stock.status === "ready";

  // One request id per opening (P7-15): made when the dialog opens, kept
  // until it closes (clearAll).
  useEffect(() => {
    if (open && !requestId.current) requestId.current = newClientRequestId();
  }, [open]);

  // The stock-tracking read, on open and on Try again. clearAll puts it
  // back to "loading" when the dialog closes.
  useEffect(() => {
    if (!open || !readNeeded) return;
    let live = true;
    listStock({ branchId: sale.branch_id })
      .then((rows) => {
        if (!live) return;
        setStock({
          status: "ready",
          tracked: Object.fromEntries(rows.map((row) => [row.product_id, row.manage_stock])),
        });
      })
      .catch(() => {
        if (live) setStock({ status: "error", tracked: {} });
      });
    return () => {
      live = false;
    };
    // The branch and the need for it don't change while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stockAttempt]);

  const retryStock = () => {
    setStock({ status: "loading", tracked: {} });
    setStockAttempt((n) => n + 1);
  };

  const context = useMemo(
    () => returnContext(sale, { stockTracked: stock.tracked, today }),
    [sale, stock.tracked, today],
  );

  const dispositionOf = (line) => {
    const fixed = lineDisposition(line, { stockTracked: true });
    if (fixed) return fixed; // another shop's line or a phone: no read needed
    if (!stockReady) return "pending";
    return lineDisposition(line, { stockTracked: stock.tracked[line.product_id] !== false });
  };

  const selectedLines = sale.lines.filter((l) => (quantities?.[l.id] ?? 0) > 0);
  const itemCount = selectedLines.reduce((sum, l) => sum + quantities[l.id], 0);
  const dueCents = context.refundDueCents(quantities ?? {});
  const outside = context.outsideIds(quantities ?? {}).length > 0;

  const clearRowError = (lineId) => {
    if (rowErrors[lineId]) setRowErrors((all) => ({ ...all, [lineId]: null }));
  };

  const setQuantity = (line, n) => {
    const q = Math.max(0, Math.min(returnableQuantity(line), n));
    setValue(`quantities.${line.id}`, q);
    if (q === 0) setValue(`conditions.${line.id}`, "");
    clearRowError(line.id);
    if (q > 0) setFormError(null);
  };

  const setCondition = (line, value) => {
    setValue(`conditions.${line.id}`, value);
    clearRowError(line.id);
  };

  const focusRow = (index) => {
    const line = openLines[index];
    if (!line) return;
    setActive(index);
    rowRefs.current[line.id]?.focus();
  };

  // Everything back to a fresh return, ready for the next opening.
  const clearAll = () => {
    reset(returnFormDefaults(sale));
    setStep(STEP_ITEMS);
    setRowErrors({});
    setFormError(null);
    setActive(0);
    setStock({ status: "loading", tracked: {} });
    requestId.current = null;
  };

  const close = () => {
    clearAll();
    onClose();
  };

  const next = () => {
    if (!stockReady) return;
    const values = getValues();
    const issues = itemsIssues(values, context);
    const byLine = {};
    let top = null;
    for (const { path, message } of issues) {
      if (path.length === 1) top = message;
      else byLine[path[1]] ??= message;
    }
    setRowErrors(byLine);
    setFormError(top);
    if (issues.length > 0) {
      const first = openLines.findIndex((l) => byLine[l.id]);
      focusRow(first === -1 ? 0 : first);
      return;
    }
    setStep(STEP_REFUND);
  };

  const back = () => {
    setStep(STEP_ITEMS);
    const first = openLines.findIndex((l) => (quantities?.[l.id] ?? 0) > 0);
    setTimeout(() => focusRow(first === -1 ? 0 : first), 0);
  };

  const summary = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm" data-testid="return-summary">
      <span className="text-slate-600 dark:text-slate-300">
        {itemCount === 0 ? "No items picked yet" : `${itemCount} ${itemCount === 1 ? "item" : "items"}`}
      </span>
      <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        Refund due {formatLKR(fromCents(dueCents))}
      </span>
      {outside && (
        <p className="basis-full text-xs text-amber-700 dark:text-amber-300">
          Outside warranty: a manager&apos;s override reason is needed.
        </p>
      )}
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={close}
      afterLeave={afterLeave}
      title={`Return items · ${sale.sale_number}`}
      description={`${customerLine(sale)} · ${soldLine(sale, today)}`}
      // xl: a picked line's controls sit beside its full name (ReturnLineRow)
      size="xl"
      footer={
        step === STEP_ITEMS ? (
          <>
            <Button type="button" variant="secondary" label="Cancel" onClick={close} />
            <Button type="button" variant="accent" label="Next: refund" disabled={!stockReady} onClick={next} />
          </>
        ) : (
          <>
            <Button type="button" variant="secondary" label="Back" onClick={back} />
            <Button type="button" variant="danger" label="Return items" disabled />
          </>
        )
      }
    >
      {step === STEP_ITEMS ? (
        // The body is capped at what the screen leaves after the dialog's
        // title, footer and margins; only the line list gives up height
        // (min-h-0), so an alert or a note never pushes Next off a ~640px
        // screen (Q23). The title wraps at phone width, hence the larger
        // allowance there.
        <div
          className="flex flex-col gap-3 min-h-0 max-h-[calc(100dvh-16.5rem)] sm:max-h-[calc(100dvh-13.5rem)]"
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.target.tagName === "BUTTON") return;
            e.preventDefault();
            next();
          }}
        >
          {readNeeded && stock.status === "error" && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-2.5 text-xs text-amber-800 dark:text-amber-200"
            >
              <AlertCircle size={16} aria-hidden="true" className="shrink-0" />
              <span className="flex-1">Couldn&apos;t check which items are stock-tracked.</span>
              <Button size="sm" variant="secondary" label="Try again" onClick={retryStock} />
            </div>
          )}

          <ScrollFade
            className="min-h-0 flex flex-col"
            scrollClassName="min-h-0 flex flex-col gap-2 overflow-y-auto pr-1"
            testId="return-lines"
          >
            {sale.lines.map((line) => {
              const left = returnableQuantity(line);
              const index = openLines.indexOf(line);
              const q = quantities?.[line.id] ?? 0;
              return (
                <ReturnLineRow
                  key={line.id}
                  ref={(el) => {
                    rowRefs.current[line.id] = el;
                  }}
                  line={line}
                  quantity={q}
                  left={left}
                  disposition={dispositionOf(line)}
                  condition={conditions?.[line.id] ?? ""}
                  onCondition={(v) => setCondition(line, v)}
                  warranty={lineWarrantyStatus(line, today)}
                  shareCents={
                    q > 0 ? refundShareCents(toCents(line.line_total), line.quantity, line.returned_quantity ?? 0, q) : null
                  }
                  error={rowErrors[line.id] ?? null}
                  active={index === active}
                  onQuantity={(n) => setQuantity(line, n)}
                  onMove={(delta) => focusRow(Math.max(0, Math.min(openLines.length - 1, index + delta)))}
                  onFocus={() => index !== -1 && setActive(index)}
                />
              );
            })}
          </ScrollFade>

          {formError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
          {summary}
        </div>
      ) : (
        // Step C replaces this with the refund rows, reason and approval.
        <div className="flex flex-col gap-3" data-testid="return-refund-step">
          {summary}
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Refund, reason and manager approval come here.
          </p>
        </div>
      )}
    </Dialog>
  );
};

export default ReturnDialog;
