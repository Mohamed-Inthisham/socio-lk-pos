import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Pencil, Plus, Search, Trash2, UsersRound } from "lucide-react";
import Button from "../../components/common/Button";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import InputField from "../../components/common/InputField";
import Table from "../../components/common/Table";
import usePermissions from "../../hooks/usePermissions";
import { PERMISSIONS } from "../../constants/rolePermissions";
import { deleteCustomer, listCustomers } from "../../services/customersService";
import CustomerFormDialog from "./CustomerFormDialog";

const PAGE_SIZE = 10;
const panel = "rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";

export default function Customers() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ status: "loading", rows: [], total: 0, pages: 1, error: "" });
  const [customerCount, setCustomerCount] = useState(null);
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const searchValue = search.trim();

  const load = useCallback(() => {
    let live = true;
    setResult((current) => ({ ...current, status: "loading", error: "" }));
    listCustomers({ search: searchValue || undefined, page, limit: PAGE_SIZE })
      .then(({ data, meta }) => {
        if (!live) return;
        setResult({ status: "ready", rows: data, total: meta.total, pages: Math.max(1, meta.totalPages), error: "" });
        if (!searchValue) setCustomerCount(meta.total);
      })
      .catch(() => live && setResult((current) => ({ ...current, status: "error", error: "Couldn’t load customers. Try again." })));
    return () => { live = false; };
  }, [searchValue, page]);

  useEffect(() => load(), [load]);
  useEffect(() => { setPage(1); }, [searchValue]);

  const openEdit = (customer) => { setEditing(customer); setFormOpen(true); };
  const openCreate = () => { setEditing(null); setFormOpen(true); };

  const columns = useMemo(() => [
    { key: "name", header: "Customer", primary: true, render: (row) => <span className="font-semibold text-slate-900 dark:text-slate-100">{row.name}</span> },
    { key: "phone", header: "Phone", render: (row) => <span className="whitespace-nowrap tabular-nums">{row.phone}</span> },
    { key: "nic", header: "NIC", render: (row) => row.nic || <span className="text-slate-400">—</span> },
    { key: "email", header: "Email", render: (row) => row.email || <span className="text-slate-400">—</span> },
    { key: "actions", header: "Actions", align: "right", render: (row) => (
      <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
        <Button size="sm" variant="ghost" icon={Eye} iconOnly aria-label={`View ${row.name}`} title="View customer" onClick={() => navigate(`/customers/${row.id}`)} />
        {can(PERMISSIONS.EDIT_CUSTOMER) && <Button size="sm" variant="ghost" icon={Pencil} iconOnly aria-label={`Edit ${row.name}`} title="Edit customer" onClick={() => openEdit(row)} />}
        {can(PERMISSIONS.DELETE_CUSTOMER) && <Button size="sm" variant="ghost" icon={Trash2} iconOnly aria-label={`Delete ${row.name}`} title="Delete customer" onClick={() => setDeleting(row)} />}
      </div>
    ) },
  ], [can, navigate]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Customer details and their purchase history.</p>
        </div>
        {can(PERMISSIONS.CREATE_CUSTOMER) && <Button variant="accent" icon={Plus} label="Add customer" onClick={openCreate} />}
      </header>

      <section aria-label="Customer count" className={`${panel} flex items-center justify-between gap-4 p-5 sm:max-w-sm`}>
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Customer count</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{customerCount ?? <span className="text-slate-400">—</span>}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Active customer records</p>
        </div>
        <span className="rounded-xl bg-cyan-50 p-3 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300"><UsersRound size={22} aria-hidden="true" /></span>
      </section>

      <section className={`${panel} overflow-hidden`} aria-label="Customer directory">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <h2 className="font-semibold">All customers <span className="ml-1 text-sm font-normal text-slate-500">({result.total})</span></h2>
          <div className="relative w-full sm:max-w-sm">
            <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <InputField aria-label="Search customers" name="customer-search" placeholder="Search name, phone, NIC or email" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="pl-9" />
          </div>
        </div>
        {result.error ? (
          <div className="p-5 text-center"><p role="alert" className="text-sm text-red-600 dark:text-red-400">{result.error}</p><Button className="mt-3" size="sm" variant="secondary" label="Try again" onClick={load} /></div>
        ) : (
          <Table columns={columns} data={result.rows} loading={result.status === "loading"} onRowClick={(row) => navigate(`/customers/${row.id}`)} ariaLabel="Customers" emptyMessage={searchValue ? "No customers match your search." : "No customers have been added yet."} dense />
        )}
        {result.pages > 1 && <nav aria-label="Customer pages" className="flex items-center justify-center gap-3 border-t border-slate-200 p-3 dark:border-slate-800">
          <Button size="sm" variant="secondary" label="Previous" disabled={page <= 1 || result.status === "loading"} onClick={() => setPage((current) => Math.max(1, current - 1))} />
          <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">Page {page} of {result.pages}</span>
          <Button size="sm" variant="secondary" label="Next" disabled={page >= result.pages || result.status === "loading"} onClick={() => setPage((current) => Math.min(result.pages, current + 1))} />
        </nav>}
      </section>

      <CustomerFormDialog open={formOpen} customer={editing} onClose={() => setFormOpen(false)} onSaved={load} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} action="deactivate" entityLabel="customer" entityName={deleting?.name ?? ""}
        descriptionOverride="This customer will be removed from the active list. Their existing sales records will be kept."
        onConfirm={async () => { await deleteCustomer(deleting.id); }} onSuccess={() => { setDeleting(null); load(); }} />
    </div>
  );
}
