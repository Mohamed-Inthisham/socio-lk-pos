import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, Info } from "lucide-react";
import Button from "../../components/common/Button";
import Dialog from "../../components/common/Dialog";
import Table from "../../components/common/Table";
import useTerminalBranch from "../../hooks/useTerminalBranch";
import { announceInspectionChange } from "../../hooks/useInspectionCount";
import { passInspection } from "../../services/productUnitsService";
import { listInspection } from "../../services/saleReturnsService";
import { colomboDaysSince, colomboToday } from "../../utils/colomboDay";
import { classifyInspectionError } from "../../utils/inspectionErrors";
import { receiptDateTime } from "../../utils/receipt";

/**
 * PhonesToCheck Page
 *
 * Route: /pos/inspection, inside TerminalLayout, admins and managers only
 * (planning doc P7-7). The terminal branch's returned phones waiting for a
 * check (GET /sale-returns/inspection), oldest first as the server sends
 * them: when it came back and how many days it has waited (amber from 8),
 * the phone (product and IMEI), and the return and sale it came from, each
 * a link to the sale on its Returns tab (Esc there comes back here).
 *
 * PASSED (the row's button, or P on the active row): a confirm with the
 * focus on Cancel, so Enter alone never puts a phone back on sale; one
 * POST /product-units/:id/inspection-pass per press. The row leaves, a
 * status line says so, the header count follows (announceInspectionChange
 * with the list's own length) and focus moves to the next row. Errors by
 * code in the dialog (utils/inspectionErrors.js); a lost answer re-reads
 * the list first (gone = it went through), then Try again.
 *
 * FAULTY: nothing to do here yet: it stays on the list, set aside for its
 * supplier (the supplier-receiving phase).
 *
 * KEYS: ↑/↓ the active row; Enter opens its sale; P passes it (confirm);
 * Esc back to the terminal. All ignored while a dialog is open.
 */

const AMBER_FROM_DAYS = 8;
const PATH = "/pos/inspection";

const dialogOpen = () => !!document.querySelector('[role="dialog"]');

/** The sale a phone came from, on its Returns tab; Back / Esc there comes here. */
const saleLink = (row) => ({
  pathname: `/pos/sales/${row.sale_id}`,
  state: { tab: "returns", from: { path: PATH, label: "Phones to check" } },
});

const waitingText = (days) => (days <= 0 ? "Returned today" : `${days} ${days === 1 ? "day" : "days"} waiting`);

const PhonesToCheck = () => {
  const navigate = useNavigate();
  const { branchId } = useTerminalBranch();
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState({ key: null, status: "loading", rows: [] });
  const [activeId, setActiveId] = useState(null);
  const [confirming, setConfirming] = useState(null); // the row being passed
  const [sending, setSending] = useState(false);
  const [dialogError, setDialogError] = useState(null); // { message, retry }
  const [notice, setNotice] = useState(null);
  const sendingRef = useRef(false);
  const nextFocus = useRef(null);
  const backRef = useRef(null);
  const listRef = useRef(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  const queryKey = `${branchId}#${reloadKey}`;
  const current = result.key === queryKey;
  const status = current ? result.status : "loading";
  const rows = current ? result.rows : [];
  const today = colomboToday();
  const active = rows.find((r) => r.id === activeId) ?? rows[0] ?? null;

  useEffect(() => {
    if (!branchId) return undefined;
    let live = true;
    listInspection(branchId)
      .then((data) => {
        if (!live) return;
        const withIds = data.map((r) => ({ ...r, id: r.product_unit.id }));
        setResult({ key: queryKey, status: "ready", rows: withIds });
        // The header's count follows this list, so the two always agree.
        announceInspectionChange(withIds.length);
      })
      .catch(() => {
        if (live) setResult({ key: queryKey, status: "error", rows: [] });
      });
    return () => {
      live = false;
    };
  }, [branchId, queryKey]);

  // Focus the list when it first has rows, so the keys work at once.
  const focused = useRef(false);
  useEffect(() => {
    if (status === "ready" && !focused.current) {
      focused.current = true;
      listRef.current?.focus();
    }
  }, [status]);

  const reread = () => setReloadKey((k) => k + 1);

  const openSale = (row) => {
    if (row) navigate(saleLink(row).pathname, { state: saleLink(row).state });
  };

  const moveActive = (delta) => {
    if (!rows.length) return;
    const index = Math.max(0, rows.findIndex((r) => r.id === active?.id));
    setActiveId(rows[Math.min(Math.max(index + delta, 0), rows.length - 1)].id);
  };

  const startPass = (row) => {
    if (!row) return;
    setActiveId(row.id);
    setDialogError(null);
    setConfirming(row);
  };

  const closeConfirm = () => {
    if (sending) return;
    setConfirming(null);
    setDialogError(null);
  };

  // The row is gone (passed here, or by someone else): out of the list,
  // the status line, the header count, and focus on the next row.
  const passed = (row, message) => {
    const index = rows.findIndex((r) => r.id === row.id);
    const remaining = rows.filter((r) => r.id !== row.id);
    const next = remaining[Math.min(index, remaining.length - 1)] ?? null;
    setResult((prev) => ({ ...prev, rows: remaining }));
    setActiveId(next?.id ?? null);
    nextFocus.current = next ? "list" : "back";
    setNotice(message);
    announceInspectionChange(remaining.length);
    setConfirming(null);
    setDialogError(null);
  };

  const confirmPass = async () => {
    const row = confirming;
    if (!row || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setDialogError(null);
    try {
      await passInspection(row.product_unit.id);
      passed(row, `IMEI ${row.product_unit.imei} is back in stock.`);
    } catch (err) {
      const error = classifyInspectionError(err);
      if (error.retry) {
        // No answer: is it still waiting? Gone from the list = it went through.
        try {
          const fresh = await listInspection(branchId);
          if (!fresh.some((r) => r.product_unit.id === row.product_unit.id)) {
            passed(row, `IMEI ${row.product_unit.imei} is back in stock.`);
            return;
          }
        } catch {
          // Still unknown: Try again resends; a pass that went through
          // answers NOT_IN_INSPECTION (IN_STOCK), shown as done.
        }
        setDialogError({ message: error.message, retry: true });
      } else if (error.done) {
        passed(row, `IMEI ${row.product_unit.imei}: ${error.message}`);
      } else {
        setDialogError({ message: error.message, retry: false });
        if (error.reread) reread();
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  // While the POST is in flight both buttons are disabled, so the focus
  // drops out of the dialog. Once it settles with an error, put it back:
  // on Try again after a lost answer, on Cancel after a refusal (the
  // confirm is then disabled).
  useEffect(() => {
    if (sending || !dialogError) return;
    (dialogError.retry ? confirmRef : cancelRef).current?.focus();
  }, [dialogError, sending]);

  const afterConfirmLeave = () => {
    const where = nextFocus.current;
    nextFocus.current = null;
    setTimeout(() => (where === "back" ? backRef.current : listRef.current)?.focus(), 0);
  };

  const keyOptions = { preventDefault: true };
  useHotkeys("down", () => !dialogOpen() && moveActive(1), keyOptions, [rows, active]);
  useHotkeys("up", () => !dialogOpen() && moveActive(-1), keyOptions, [rows, active]);
  useHotkeys(
    "enter",
    (e) => {
      if (dialogOpen() || e.target.closest?.("button, a")) return;
      e.preventDefault();
      openSale(active);
    },
    {},
    [active],
  );
  useHotkeys("p", () => !dialogOpen() && startPass(active), keyOptions, [active]);
  useHotkeys(
    "esc",
    (e) => {
      if (dialogOpen()) return;
      e.preventDefault();
      navigate("/pos");
    },
    {},
  );

  const columns = [
    {
      key: "returned",
      header: "Returned",
      render: (r) => {
        const days = colomboDaysSince(r.returned_at, today);
        return (
          <span className="flex flex-col">
            <span className="tabular-nums whitespace-nowrap">{receiptDateTime(r.returned_at)}</span>
            <span
              className={`text-xs ${days >= AMBER_FROM_DAYS ? "font-semibold text-amber-700 dark:text-amber-300" : "text-slate-500 dark:text-slate-400"}`}
              data-testid="days-waiting"
            >
              {waitingText(days)}
            </span>
          </span>
        );
      },
    },
    {
      key: "phone",
      header: "Phone",
      primary: true,
      render: (r) => (
        <span className="flex flex-col min-w-0">
          <span className="font-semibold text-slate-900 dark:text-slate-100 wrap-break-word">{r.product_unit.product_name}</span>
          <span className="font-mono text-xs tracking-tight text-slate-600 dark:text-slate-300">IMEI {r.product_unit.imei}</span>
        </span>
      ),
    },
    {
      key: "from",
      header: "From",
      render: (r) => (
        <span className="flex flex-col text-sm" onClick={(e) => e.stopPropagation()}>
          <Link to={saleLink(r).pathname} state={saleLink(r).state} className="font-medium text-cyan-700 dark:text-cyan-300 underline-offset-2 hover:underline tabular-nums">
            {r.return_number}
          </Link>
          <Link to={saleLink(r).pathname} state={saleLink(r).state} className="text-xs text-slate-600 dark:text-slate-300 underline-offset-2 hover:underline tabular-nums">
            Sale {r.sale_number}
          </Link>
        </span>
      ),
    },
    {
      key: "action",
      header: <span className="sr-only">Action</span>,
      align: "right",
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="secondary"
            icon={CheckCircle2}
            label="Passed: back to stock"
            title="Passed: back to stock (P)"
            onClick={() => startPass(r)}
          />
        </span>
      ),
    },
  ];

  return (
    <div className="h-full overflow-y-auto md:overflow-hidden">
      <div className="min-h-full md:h-full flex flex-col gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button
            ref={backRef}
            size="sm"
            variant="ghost"
            icon={ArrowLeft}
            label="Terminal"
            title="Back to the terminal (Esc)"
            onClick={() => navigate("/pos")}
          />
          <h1 className="text-lg font-semibold">
            Phones to check{" "}
            {status === "ready" && <span className="text-slate-500 dark:text-slate-400 font-normal">· {rows.length}</span>}
          </h1>
        </div>

        <p
          className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 -mt-1"
          data-testid="inspection-note"
        >
          <Info size={14} aria-hidden="true" className="shrink-0 mt-px" />
          <span>
            Passed: the phone goes back to stock and can be sold. Faulty: leave it here and set it aside: returning
            faulty phones to the supplier comes with supplier receiving.
          </span>
        </p>

        <p role="status" aria-live="polite" className="text-xs text-emerald-700 dark:text-emerald-400 empty:hidden -mt-1">
          {notice}
        </p>

        <div ref={listRef} tabIndex={-1} aria-label="Phones to check" className="flex-1 md:min-h-0 focus:outline-none">
          {status === "error" ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
            >
              <AlertTriangle size={16} aria-hidden="true" />
              <span className="flex-1">Couldn&apos;t load the phones to check.</span>
              <Button size="sm" variant="accent" label="Try again" onClick={reread} />
            </div>
          ) : (
            <Table
              columns={columns}
              data={rows}
              loading={status === "loading"}
              onRowClick={openSale}
              activeKey={active?.id}
              ariaLabel="Returned phones waiting to be checked"
              emptyMessage="No phones are waiting to be checked."
              fill
              dense
            />
          )}
        </div>
      </div>

      <Dialog
        open={!!confirming}
        onClose={closeConfirm}
        afterLeave={afterConfirmLeave}
        title="Passed: back to stock?"
        size="sm"
        dismissible={!sending}
        footer={
          <>
            <Button
              ref={cancelRef}
              type="button"
              variant="secondary"
              label="Cancel"
              onClick={closeConfirm}
              disabled={sending}
              data-autofocus
            />
            <Button
              ref={confirmRef}
              type="button"
              variant="accent"
              label={dialogError?.retry ? "Try again" : "Passed: back to stock"}
              loading={sending}
              // A refusal Try again can't fix (sold meanwhile, another branch…)
              disabled={!!dialogError && !dialogError.retry}
              onClick={confirmPass}
            />
          </>
        }
      >
        {confirming && (
          <div className="flex flex-col gap-3 text-sm text-slate-700 dark:text-slate-200">
            <p>
              <span className="font-semibold">{confirming.product_unit.product_name}</span>
              {" · "}
              <span className="font-mono tracking-tight">IMEI {confirming.product_unit.imei}</span>
              {" "}goes back to stock and can be sold again.
            </p>
            <p className="text-slate-600 dark:text-slate-300">Only confirm once it&apos;s been checked and has no fault.</p>
            {dialogError && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-2.5 text-xs text-red-700 dark:text-red-300"
              >
                <AlertCircle size={14} aria-hidden="true" className="shrink-0 mt-px" />
                {dialogError.message}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
};

export default PhonesToCheck;
