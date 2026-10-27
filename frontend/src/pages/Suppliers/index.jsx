import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Pencil, Plus, Search, ToggleLeft, ToggleRight, Truck } from "lucide-react";
import Button from "../../components/common/Button";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import Dialog from "../../components/common/Dialog";
import InputField from "../../components/common/InputField";
import Table from "../../components/common/Table";
import usePermissions from "../../hooks/usePermissions";
import { deactivateSupplier, listSuppliers, reactivateSupplier } from "../../services/suppliersService";
import { listSupplierPurchaseBalances } from "../../services/stockPurchasesService";
import { formatLKR } from "../../utils/money";
import SupplierFormDialog from "./SupplierFormDialog";

const PAGE_SIZE = 10;
const panel = "rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";

export default function Suppliers() {
  const { isAdmin, isManager } = usePermissions();
  const [suppliers, setSuppliers] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [changingStatus, setChangingStatus] = useState(null);
  const [supplierBalances, setSupplierBalances] = useState({});

  const load = useCallback(() => {
    let live = true;
    setStatus("loading");
    setError("");
    Promise.all([
      listSuppliers({ includeInactive }),
      isAdmin || isManager ? listSupplierPurchaseBalances().catch(() => []) : Promise.resolve([]),
    ])
      .then(([rows, balanceRows]) => { if (live) {
        setSuppliers(rows);
        setSupplierBalances(Object.fromEntries(balanceRows.map((row) => [row.supplier_id, row])));
        setStatus("ready");
      } })
      .catch(() => { if (live) { setError("Couldn’t load suppliers. Try again."); setStatus("error"); } });
    return () => { live = false; };
  }, [includeInactive, isAdmin, isManager]);

  useEffect(() => load(), [load]);

  const filtered = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return suppliers;
    return suppliers.filter((supplier) => [supplier.name, supplier.contact_person, supplier.phone, supplier.email]
      .some((field) => field?.toLowerCase().includes(value)));
  }, [search, suppliers]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const activeCount = suppliers.filter((supplier) => supplier.is_active).length;

  const columns = useMemo(() => [
    { key: "name", header: "Supplier", primary: true, render: (row) => <span className="font-semibold text-slate-900 dark:text-slate-100">{row.name}</span> },
    { key: "contact_person", header: "Contact person", render: (row) => row.contact_person || <span className="text-slate-400">—</span> },
    { key: "phone", header: "Phone", render: (row) => row.phone || <span className="text-slate-400">—</span> },
    { key: "email", header: "Email", render: (row) => row.email || <span className="text-slate-400">—</span> },
    ...((isAdmin || isManager) ? [{
      key: "outstanding_balance",
      header: isManager ? "Outstanding (branch)" : "Outstanding",
      align: "right",
      render: (row) => {
        const balance = supplierBalances[row.id];
        return (
          <div className="text-right">
            <span className="font-medium tabular-nums">{formatLKR(balance?.outstanding_amount || "0.00")}</span>
            {Number(balance?.pending_cheque_amount || 0) > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">{formatLKR(balance.pending_cheque_amount)} cheque pending</p>}
          </div>
        );
      },
    }] : []),
    { key: "status", header: "Status", render: (row) => <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${row.is_active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{row.is_active ? "Active" : "Inactive"}</span> },
    { key: "actions", header: "Actions", align: "right", render: (row) => (
      <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
        <Button size="sm" variant="ghost" icon={Eye} label="View" aria-label={`View ${row.name}`} onClick={() => setViewing(row)} />
        {isAdmin && <>
          <Button size="sm" variant="ghost" icon={Pencil} label="Edit" aria-label={`Edit ${row.name}`} onClick={() => { setEditing(row); setFormOpen(true); }} />
          <Button size="sm" variant="ghost" icon={row.is_active ? ToggleLeft : ToggleRight} label={row.is_active ? "Deactivate" : "Reactivate"} aria-label={`${row.is_active ? "Deactivate" : "Reactivate"} ${row.name}`} onClick={() => setChangingStatus(row)} />
        </>}
      </div>
    ) },
  ], [isAdmin, isManager, supplierBalances]);

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const submitStatusChange = async () => {
    if (changingStatus.is_active) await deactivateSupplier(changingStatus.id);
    else await reactivateSupplier(changingStatus.id);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Suppliers</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage supplier contact details and status.</p>
        </div>
      </header>

      <section aria-label="Supplier count" className={`${panel} flex items-center justify-between gap-4 p-5 sm:max-w-sm`}>
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Active suppliers</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{status === "ready" ? activeCount : <span className="text-slate-400">—</span>}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{includeInactive ? `${suppliers.length} total records` : "Active supplier records"}</p>
        </div>
        <span className="rounded-xl bg-cyan-50 p-3 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300"><Truck size={22} aria-hidden="true" /></span>
      </section>

      <section className={`${panel} overflow-hidden`} aria-label="Supplier directory">
        <div className="grid gap-3 border-b border-slate-200 p-4 dark:border-slate-800 sm:grid-cols-[1fr_auto] sm:items-center">
          <h2 className="font-semibold">All suppliers <span className="ml-1 text-sm font-normal text-slate-500">({filtered.length})</span></h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-72">
              <InputField aria-label="Search suppliers" name="supplier-search" type="search" icon={Search} placeholder="Search name, contact, phone or email" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            </div>
            <label className="flex items-center gap-2 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={includeInactive} onChange={(event) => { setIncludeInactive(event.target.checked); setPage(1); }} className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
              Include inactive
            </label>
            {isAdmin && <Button variant="accent" icon={Plus} label="Add supplier" onClick={openCreate} className="shrink-0 self-start sm:self-auto" />}
          </div>
        </div>
        {error ? (
          <div className="p-5 text-center"><p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p><Button className="mt-3" size="sm" variant="secondary" label="Try again" onClick={load} /></div>
        ) : (
          <Table columns={columns} data={rows} loading={status === "loading"} onRowClick={setViewing} ariaLabel="Suppliers" emptyMessage={search.trim() ? "No suppliers match your search." : "No suppliers have been added yet."} dense />
        )}
        {pages > 1 && <nav aria-label="Supplier pages" className="flex items-center justify-center gap-3 border-t border-slate-200 p-3 dark:border-slate-800">
          <Button size="sm" variant="secondary" label="Previous" disabled={page <= 1 || status === "loading"} onClick={() => setPage((current) => Math.max(1, current - 1))} />
          <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">Page {page} of {pages}</span>
          <Button size="sm" variant="secondary" label="Next" disabled={page >= pages || status === "loading"} onClick={() => setPage((current) => Math.min(pages, current + 1))} />
        </nav>}
      </section>

      <SupplierFormDialog open={formOpen} supplier={editing} onClose={() => setFormOpen(false)} onSaved={load} />
      <SupplierProfileDialog supplier={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog open={!!changingStatus} onClose={() => setChangingStatus(null)} onSuccess={() => { setChangingStatus(null); load(); }}
        onConfirm={submitStatusChange} action={changingStatus?.is_active ? "deactivate" : "reactivate"} entityLabel="supplier" entityName={changingStatus?.name ?? ""}
        descriptionOverride={changingStatus?.is_active ? "This supplier will be removed from active supplier lists. Existing sale records remain intact." : undefined} />
    </div>
  );
}

function SupplierProfileDialog({ supplier, onClose }) {
  const details = [
    ["Contact person", supplier?.contact_person],
    ["Phone", supplier?.phone],
    ["Email", supplier?.email],
    ["Address", supplier?.address],
  ];

  return (
    <Dialog open={!!supplier} onClose={onClose} title={supplier?.name ?? "Supplier profile"}
      description="Supplier profile and contact information." size="md"
      footer={<Button variant="secondary" label="Close" onClick={onClose} />}>
      {supplier && <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
          <span className="text-sm text-slate-500 dark:text-slate-400">Status</span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${supplier.is_active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{supplier.is_active ? "Active" : "Inactive"}</span>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          {details.map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className="mt-1 break-words text-sm text-slate-900 dark:text-slate-100">{value || "—"}</dd>
          </div>)}
        </dl>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900 dark:text-slate-100">{supplier.notes || "—"}</p>
        </div>
      </div>}
    </Dialog>
  );
}
