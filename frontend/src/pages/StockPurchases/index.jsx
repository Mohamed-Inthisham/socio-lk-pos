import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, ShoppingCart } from "lucide-react";
import Button from "../../components/common/Button";
import InputField from "../../components/common/InputField";
import Table from "../../components/common/Table";
import usePermissions from "../../hooks/usePermissions";
import { listStockPurchases } from "../../services/stockPurchasesService";
import { formatLKR } from "../../utils/money";

const panel = "rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";
const dateLabel = (value) => {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-LK", { year: "numeric", month: "short", day: "numeric" });
};

export default function StockPurchases() {
  const navigate = useNavigate();
  const { isAdmin, isManager } = usePermissions();
  const [purchases, setPurchases] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    let live = true;
    setStatus("loading");
    setError("");
    listStockPurchases()
      .then((rows) => { if (live) { setPurchases(rows); setStatus("ready"); } })
      .catch((err) => { if (live) { setError(err.response?.data?.message || "Couldn’t load stock purchases."); setStatus("error"); } });
    return () => { live = false; };
  }, []);

  useEffect(() => load(), [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return purchases;
    return purchases.filter((purchase) => [
      purchase.purchase_number,
      purchase.supplier_invoice_number,
      purchase.supplier?.name,
      purchase.branch?.name,
    ].some((value) => value?.toLowerCase().includes(query)));
  }, [purchases, search]);

  const columns = useMemo(() => [
    { key: "purchase_number", header: "Purchase", primary: true, render: (row) => <span className="font-semibold text-slate-900 dark:text-slate-100">{row.purchase_number}</span> },
    { key: "purchase_date", header: "Date", render: (row) => dateLabel(row.purchase_date) },
    { key: "supplier", header: "Supplier", render: (row) => row.supplier?.name || "—" },
    { key: "branch", header: "Branch", render: (row) => row.branch?.name || "—" },
    { key: "items", header: "Products", align: "right", render: (row) => row.items?.length ?? 0 },
    { key: "total_amount", header: "Total cost", align: "right", render: (row) => <span className="font-medium tabular-nums">{formatLKR(row.total_amount)}</span> },
    { key: "payment_status", header: "Payment", render: (row) => {
      const payments = row.payments ?? [];
      const totalCents = Math.round(Number(row.total_amount) * 100);
      const paidCents = payments.filter((payment) => payment.status === "CLEARED")
        .reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0);
      const hasPendingCheque = payments.some((payment) => payment.status === "PENDING");
      const label = paidCents >= totalCents ? "Paid" : paidCents > 0 ? "Partially paid" : hasPendingCheque ? "Cheque pending" : "On credit";
      return <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>;
    } },
  ], []);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Stock purchases</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Receive supplier stock into a branch and record its purchase cost.</p>
        </div>
        {(isAdmin || isManager) && <Button icon={Plus} label="New stock purchase" onClick={() => navigate("/stock-purchases/new")} />}
      </header>

      <section className={`${panel} overflow-hidden`} aria-label="Stock purchase history">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold">Purchase history <span className="ml-1 text-sm font-normal text-slate-500">({visible.length})</span></h2>
          <div className="w-full sm:w-80">
            <InputField aria-label="Search stock purchases" name="stock-purchase-search" type="search" icon={Search} placeholder="Search purchase, invoice, supplier or branch" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>
        {error && <p role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        {status === "error" ? (
          <div className="p-4"><Button variant="secondary" label="Try again" onClick={load} /></div>
        ) : status === "ready" && visible.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-14 text-center">
            <ShoppingCart size={28} className="mb-3 text-slate-400" aria-hidden="true" />
            <p className="font-medium">{search ? "No purchases match your search." : "No stock purchases yet."}</p>
            <p className="mt-1 text-sm text-slate-500">Record a supplier delivery to add stock to a branch.</p>
          </div>
        ) : (
          <Table columns={columns} data={visible} loading={status === "loading"} onRowClick={(row) => navigate(`/stock-purchases/${row.id}`)} emptyMessage="No stock purchases found." ariaLabel="Stock purchase history" />
        )}
      </section>
    </div>
  );
}
