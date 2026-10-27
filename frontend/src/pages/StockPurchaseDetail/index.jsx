import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Building2, CalendarDays, Plus, Truck } from "lucide-react";
import Button from "../../components/common/Button";
import {
  getStockPurchase,
  resolveStockPurchaseCheque,
} from "../../services/stockPurchasesService";
import { formatLKR } from "../../utils/money";
import StockPurchasePaymentDialog from "./StockPurchasePaymentDialog";

const panel = "rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";
const dateLabel = (value) => {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-LK", { year: "numeric", month: "long", day: "numeric" });
};
const formatMethod = (method) => ({
  CASH: "Cash",
  CARD: "Card",
  ONLINE_TRANSFER: "Online transfer",
  CHEQUE: "Cheque",
}[method] || method);

export default function StockPurchaseDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [purchase, setPurchase] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await getStockPurchase(id);
      setPurchase(result);
      setError("");
      setStatus("ready");
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load this stock purchase.");
      setStatus("error");
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const resolveCheque = async (paymentId, nextStatus) => {
    try {
      await resolveStockPurchaseCheque(id, paymentId, nextStatus);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't update this cheque.");
    }
  };

  if (status === "loading") return <div className="mx-auto max-w-5xl p-6 text-sm text-slate-500">Loading stock purchase…</div>;
  if (status === "error") return <div className="mx-auto max-w-5xl space-y-4 p-6"><Button variant="secondary" icon={ArrowLeft} label="Purchase history" onClick={() => navigate("/stock-purchases")} /><p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p></div>;

  const payments = purchase.payments ?? [];
  const totalCents = Math.round(Number(purchase.total_amount) * 100);
  const paidCents = payments
    .filter((payment) => payment.status === "CLEARED")
    .reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0);
  const pendingChequeCents = payments
    .filter((payment) => payment.status === "PENDING")
    .reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0);
  const outstandingCents = Math.max(0, totalCents - paidCents);
  const availableToPayCents = Math.max(0, totalCents - paidCents - pendingChequeCents);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <Button variant="secondary" icon={ArrowLeft} label="Purchase history" onClick={() => navigate("/stock-purchases")} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Stock purchase</p>
          <h1 className="mt-1 text-2xl font-semibold">{purchase.purchase_number}</h1>
          {purchase.supplier_invoice_number && <p className="mt-1 text-sm text-slate-500">Invoice {purchase.supplier_invoice_number}</p>}
        </div>
        <div className="text-right"><p className="text-xs uppercase tracking-wide text-slate-500">Total purchase cost</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatLKR(purchase.total_amount)}</p></div>
      </header>

      <section className={`${panel} grid gap-4 p-5 sm:grid-cols-3`} aria-label="Purchase information">
        <div className="flex gap-3"><Truck size={18} className="mt-0.5 text-cyan-600" /><div><p className="text-xs uppercase tracking-wide text-slate-500">Supplier</p><p className="mt-1 font-medium">{purchase.supplier?.name || "—"}</p></div></div>
        <div className="flex gap-3"><Building2 size={18} className="mt-0.5 text-cyan-600" /><div><p className="text-xs uppercase tracking-wide text-slate-500">Receiving branch</p><p className="mt-1 font-medium">{purchase.branch?.name || "—"}</p></div></div>
        <div className="flex gap-3"><CalendarDays size={18} className="mt-0.5 text-cyan-600" /><div><p className="text-xs uppercase tracking-wide text-slate-500">Purchase date</p><p className="mt-1 font-medium">{dateLabel(purchase.purchase_date)}</p></div></div>
      </section>

      <section className={`${panel} space-y-4 p-5`} aria-label="Supplier payments">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Supplier payments</h2>
            <p className="mt-1 text-xs text-slate-500">Pending cheques reduce the outstanding balance only after clearing.</p>
          </div>
          {availableToPayCents > 0 && <Button icon={Plus} label="Record payment" onClick={() => setPaymentDialogOpen(true)} />}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800"><p className="text-xs uppercase tracking-wide text-slate-500">Paid</p><p className="mt-1 font-semibold tabular-nums">{formatLKR((paidCents / 100).toFixed(2))}</p></div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800"><p className="text-xs uppercase tracking-wide text-slate-500">Pending cheques</p><p className="mt-1 font-semibold tabular-nums">{formatLKR((pendingChequeCents / 100).toFixed(2))}</p></div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800"><p className="text-xs uppercase tracking-wide text-slate-500">Outstanding</p><p className="mt-1 font-semibold tabular-nums">{formatLKR((outstandingCents / 100).toFixed(2))}</p></div>
        </div>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-500">No payments recorded. The purchase is on credit.</p>
        ) : (
          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {payments.map((payment) => (
              <article key={payment.id} className="flex flex-wrap items-start justify-between gap-4 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{formatMethod(payment.method)}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${payment.status === "CLEARED" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" : payment.status === "PENDING" ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"}`}>
                      {payment.status === "CLEARED" ? "Cleared" : payment.status === "PENDING" ? "Pending" : "Bounced"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Payment date: {dateLabel(payment.payment_date)} · Recorded by {payment.created_by?.full_name || "—"}</p>
                  {payment.method === "CHEQUE" && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Cheque {payment.cheque_number} · {payment.bank} · dated {dateLabel(payment.cheque_date)}</p>}
                  {payment.reference && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Reference: {payment.reference}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{formatLKR(payment.amount)}</span>
                  {payment.method === "CHEQUE" && payment.status === "PENDING" && <>
                    <Button size="sm" variant="secondary" label="Mark cleared" onClick={() => resolveCheque(payment.id, "CLEARED")} />
                    <Button size="sm" variant="ghost" label="Mark bounced" onClick={() => resolveCheque(payment.id, "BOUNCED")} />
                  </>}
                </div>
              </article>
            ))}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      </section>

      <section className={`${panel} overflow-hidden`}>
        <div className="border-b border-slate-200 p-5 dark:border-slate-800"><h2 className="font-semibold">Received products</h2></div>
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {purchase.items?.map((item) => (
            <article key={item.id} className="space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-semibold">{item.product_name_snapshot}</h3><p className="mt-0.5 font-mono text-xs text-slate-500">{item.product_sku_snapshot}</p></div>
                <div className="text-right"><p className="text-xs text-slate-500">{item.quantity} × {formatLKR(item.unit_buying_price)}</p><p className="mt-1 font-semibold tabular-nums">{formatLKR(item.line_total)}</p></div>
              </div>
              {item.unit_selling_price && <p className="text-sm text-slate-600 dark:text-slate-300">Selling price set to {formatLKR(item.unit_selling_price)} for future sales.</p>}
              {item.imei_numbers?.length > 0 && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">IMEIs</h4><ul className="mt-1 flex flex-wrap gap-2">{item.imei_numbers.map((imei) => <li key={imei} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs dark:bg-slate-800">{imei}</li>)}</ul></div>}
              {item.serial_numbers?.length > 0 && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Serial numbers</h4><ul className="mt-1 flex flex-wrap gap-2">{item.serial_numbers.map((serial, index) => <li key={`${serial}-${index}`} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs dark:bg-slate-800">{serial}</li>)}</ul></div>}
            </article>
          ))}
        </div>
      </section>

      {purchase.notes && <section className={`${panel} p-5`}><h2 className="font-semibold">Notes</h2><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{purchase.notes}</p></section>}
      <p className="text-xs text-slate-500">Recorded by {purchase.created_by?.full_name || "—"}.</p>
      <StockPurchasePaymentDialog
        open={paymentDialogOpen}
        onClose={() => setPaymentDialogOpen(false)}
        purchaseId={purchase.id}
        maxAmount={availableToPayCents / 100}
        onSaved={load}
      />
    </div>
  );
}
