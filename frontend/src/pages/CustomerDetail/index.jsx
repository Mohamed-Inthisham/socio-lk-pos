import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Mail, Pencil, Phone, Trash2, UserRound } from "lucide-react";
import Button from "../../components/common/Button";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import Table from "../../components/common/Table";
import SaleStatusBadge from "../../components/pos/SaleStatusBadge";
import usePermissions from "../../hooks/usePermissions";
import { PERMISSIONS } from "../../constants/rolePermissions";
import { deleteCustomer, getCustomer } from "../../services/customersService";
import { listSales } from "../../services/salesService";
import { saleListStatus } from "../../utils/returnMath";
import { formatLKR } from "../../utils/money";
import { receiptDateTime } from "../../utils/receipt";
import CustomerFormDialog from "../Customers/CustomerFormDialog";

const PAGE_SIZE = 10;
const panel = "rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [customer, setCustomer] = useState(null);
  const [customerState, setCustomerState] = useState("loading");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [history, setHistory] = useState({ status: "loading", rows: [], total: 0, pages: 1, page: 1 });

  useEffect(() => {
    let live = true;
    setCustomerState("loading");
    getCustomer(id)
      .then((data) => { if (live) { setCustomer(data); setCustomerState("ready"); } })
      .catch(() => live && setCustomerState("error"));
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    let live = true;
    setHistory((current) => ({ ...current, status: "loading" }));
    listSales({ customerId: id, sort: "completed_at", page: history.page, limit: PAGE_SIZE })
      .then(({ data, meta }) => live && setHistory({ status: "ready", rows: data, total: meta.total, pages: Math.max(meta.totalPages, 1), page: meta.page }))
      .catch(() => live && setHistory((current) => ({ ...current, status: "error" })));
    return () => { live = false; };
  }, [id, history.page]);

  const columns = [
    { key: "completed_at", header: "Date", secondary: true, render: (sale) => <span className="whitespace-nowrap tabular-nums">{sale.completed_at ? receiptDateTime(sale.completed_at) : "—"}</span> },
    { key: "sale_number", header: "Sale", primary: true, render: (sale) => <span className="font-semibold tabular-nums">{sale.sale_number ?? "Draft"}</span> },
    { key: "cashier", header: "Cashier", render: (sale) => sale.cashier?.full_name ?? "—" },
    { key: "total", header: "Total", align: "right", render: (sale) => <span className="whitespace-nowrap tabular-nums">{formatLKR(sale.total)}</span> },
    { key: "status", header: "Status", render: (sale) => <SaleStatusBadge state={saleListStatus(sale)} /> },
  ];

  if (customerState === "loading") return <p role="status" className="p-6 text-sm text-slate-500">Loading customer…</p>;
  if (customerState === "error" || !customer) return <div className="p-6"><Link to="/customers" className="text-sm text-cyan-700 dark:text-cyan-300">← All customers</Link><p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">Couldn’t load this customer.</p></div>;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <Link to="/customers" className="inline-flex items-center gap-2 text-sm text-cyan-700 hover:underline dark:text-cyan-300"><ArrowLeft size={16} aria-hidden="true" />All customers</Link>
      <header className={`${panel} flex flex-wrap items-start justify-between gap-5 p-5 sm:p-6`}>
        <div className="flex min-w-0 items-start gap-4">
          <span className="rounded-xl bg-cyan-50 p-3 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300"><UserRound size={24} aria-hidden="true" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold">{customer.name}</h1>{customer.deleted_at && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">Deleted</span>}</div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-2"><Phone size={15} aria-hidden="true" />{customer.phone}</span>
              {customer.email && <span className="inline-flex items-center gap-2"><Mail size={15} aria-hidden="true" />{customer.email}</span>}
              {customer.nic && <span>NIC: {customer.nic}</span>}
            </div>
            {customer.notes && <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm text-slate-500 dark:text-slate-400">{customer.notes}</p>}
          </div>
        </div>
        {!customer.deleted_at && <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Pencil} label="Edit customer" disabled={!can(PERMISSIONS.EDIT_CUSTOMER)} title={can(PERMISSIONS.EDIT_CUSTOMER) ? "Edit customer" : "You don’t have permission to edit customers"} onClick={() => setEditing(true)} />
          <Button variant="danger" icon={Trash2} label="Delete customer" disabled={!can(PERMISSIONS.DELETE_CUSTOMER)} title={can(PERMISSIONS.DELETE_CUSTOMER) ? "Delete customer" : "Only managers and admins can delete customers"} onClick={() => setDeleting(true)} />
        </div>}
      </header>

      <section aria-label="Customer sales history" className={`${panel} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div><h2 className="font-semibold">Sales history</h2><p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{history.total} recorded sales, newest first</p></div>
          <Link to={`/sales/history?q=${encodeURIComponent(customer.phone)}`} className="text-sm font-medium text-cyan-700 hover:underline dark:text-cyan-300">Open sales search</Link>
        </div>
        {history.status === "error" ? <p role="alert" className="p-5 text-sm text-red-600 dark:text-red-400">Couldn’t load this customer’s sales history.</p> : (
          <Table columns={columns} data={history.rows} loading={history.status === "loading"} onRowClick={(sale) => navigate(`/sales/history/${sale.id}`)} ariaLabel={`${customer.name} sales history`} emptyMessage="No sales are linked to this customer." dense />
        )}
        {history.pages > 1 && <nav aria-label="Sales history pages" className="flex items-center justify-center gap-3 border-t border-slate-200 p-3 dark:border-slate-800">
          <Button size="sm" variant="secondary" label="Previous" disabled={history.page <= 1 || history.status === "loading"} onClick={() => setHistory((current) => ({ ...current, page: current.page - 1 }))} />
          <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">Page {history.page} of {history.pages}</span>
          <Button size="sm" variant="secondary" label="Next" disabled={history.page >= history.pages || history.status === "loading"} onClick={() => setHistory((current) => ({ ...current, page: current.page + 1 }))} />
        </nav>}
      </section>
      <CustomerFormDialog open={editing} customer={customer} onClose={() => setEditing(false)} onSaved={setCustomer} />
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} action="delete" entityLabel="customer" entityName={customer.name}
        descriptionOverride="This customer will be removed from the active list. Their existing sales records will be kept."
        onConfirm={() => deleteCustomer(customer.id)} onSuccess={() => navigate("/customers")} />
    </div>
  );
}
