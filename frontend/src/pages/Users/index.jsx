import { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { KeyRound, Pencil, Plus, Search, ShieldCheck, ToggleLeft, ToggleRight, UserCog } from "lucide-react";
import Button from "../../components/common/Button";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import InputField from "../../components/common/InputField";
import Table from "../../components/common/Table";
import Tooltip from "../../components/common/Tooltip";
import { ROLE_INFO } from "../../constants/rolePermissions";
import { deactivateUser, listUsers, reactivateUser } from "../../services/usersService";
import { userErrorOf } from "../../utils/userErrors";
import UserFormDialog from "./UserFormDialog";
import ChangeRoleDialog from "./ChangeRoleDialog";
import ResetPasswordDialog from "./ResetPasswordDialog";
import UserProfileDialog from "./UserProfileDialog";
import { ROLE_BADGE, branchLabel, statusBadge } from "./userDisplay";

/**
 * Users page (Task 2.4, admin only: the route and the sidebar item are
 * limited to admins; the backend refuses everyone else).
 *
 * Server-side list (GET /users): search (name, email, NIC or contact
 * number, debounced 300 ms),
 * role, status (Active by default) and branch filters, 20 a page. Every
 * filter change goes back to page 1; every successful action reloads.
 *
 * Clicking a row (or the user's name, from the keyboard) opens their
 * profile card (UserProfileDialog), which offers the same actions.
 *
 * Row actions: edit name and email (UserFormDialog), change role and
 * branch together (ChangeRoleDialog: the only way a branch changes),
 * reset password (ResetPasswordDialog), deactivate / reactivate
 * (ConfirmDialog). On the admin's own row, role, reset and deactivate are
 * disabled with the reason in a tooltip (the backend refuses them too).
 *
 * Responses are safe users: no password or PIN hash ever arrives; only
 * whether a PIN is set is shown.
 */

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const panel = "rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";

const ROLE_OPTIONS = [
  { value: "", label: "All roles" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "cashier", label: "Cashier" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All statuses" },
];

const IS_ACTIVE = { active: true, inactive: false, all: undefined };

const DEFAULT_FILTERS = { role: "", status: "active", branchId: "" };

/**
 * An icon button with its name in a tooltip. When `disabledReason` is
 * given the button is disabled and the reason shows instead: the tooltip
 * sits on a focusable wrapper, since a disabled button gets no hover or
 * focus.
 */
function RowAction({ icon, label, tooltip, onClick, disabledReason }) {
  const button = (
    <Button
      iconOnly
      variant="ghost"
      icon={icon}
      aria-label={label}
      title={disabledReason ?? undefined}
      disabled={!!disabledReason}
      onClick={onClick}
      className="md:h-8 md:w-8"
    />
  );
  if (!disabledReason) return <Tooltip content={tooltip}>{button}</Tooltip>;
  return (
    <Tooltip content={disabledReason}>
      <span tabIndex={0} aria-label={disabledReason} className="inline-flex rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
        {button}
      </span>
    </Tooltip>
  );
}

export default function Users() {
  const currentUserId = useSelector((state) => state.auth.user?.id);
  const branches = useSelector((state) => state.branches.branches);
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  // `key` names the query the result answers: while it differs from the
  // current one, the list is loading.
  const [result, setResult] = useState({ key: null, rows: [], total: 0, pages: 1, error: "" });
  const [reloads, setReloads] = useState(0);
  const [form, setForm] = useState({ open: false, user: null });
  const [roleUser, setRoleUser] = useState(null);
  const [resetUser, setResetUser] = useState(null);
  const [statusUser, setStatusUser] = useState(null);
  const [profileUser, setProfileUser] = useState(null);

  // Search goes to the server once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(search.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => ({
    search: searchTerm || undefined,
    role: filters.role || undefined,
    branchId: filters.branchId || undefined,
    isActive: IS_ACTIVE[filters.status],
    page,
    limit: PAGE_SIZE,
  }), [searchTerm, filters, page]);
  const queryKey = `${JSON.stringify(query)}#${reloads}`;
  const loading = result.key !== queryKey;

  useEffect(() => {
    let live = true;
    listUsers(query)
      .then(({ data, meta }) => {
        if (live) setResult({ key: queryKey, rows: data, total: meta.total, pages: Math.max(1, meta.totalPages), error: "" });
      })
      .catch(() => {
        if (live) setResult((current) => ({ ...current, key: queryKey, error: "Couldn’t load users. Try again." }));
      });
    return () => { live = false; };
  }, [query, queryKey]);

  /** After every successful action, and Try again. */
  const load = useCallback(() => setReloads((n) => n + 1), []);

  const setFilter = (name) => (event) => {
    setFilters((current) => ({ ...current, [name]: event.target.value }));
    setPage(1);
  };

  const filtered = searchTerm !== "" || filters.role !== "" || filters.branchId !== "" || filters.status !== "active";
  const branchOptions = useMemo(
    () => [{ value: "", label: "All branches" }, ...branches.map((b) => ({ value: b.id, label: b.name }))],
    [branches],
  );

  const columns = useMemo(() => [
    {
      key: "name",
      header: "User",
      primary: true,
      render: (row) => (
        <span className="block min-w-0 md:max-w-[12rem] lg:max-w-[16rem] xl:max-w-xs">
          <span className="block truncate font-semibold text-slate-900 dark:text-slate-100">
            {/* The row opens the profile on click; this button is the keyboard way in. */}
            <button type="button" aria-label={`View profile for ${row.full_name}`} onClick={(event) => { event.stopPropagation(); setProfileUser(row); }}
              className="rounded text-left hover:text-cyan-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:hover:text-cyan-300">
              {row.full_name}
            </button>
            {row.id === currentUserId && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">You</span>}
          </span>
          <span className="block truncate text-xs font-normal text-slate-500 dark:text-slate-400">{row.email}</span>
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => (
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${ROLE_BADGE[row.role] ?? ""}`}>
          {ROLE_INFO[row.role]?.label ?? row.role}
        </span>
      ),
    },
    { key: "branch", header: "Branch", render: (row) => <span className={row.role === "admin" ? "text-slate-500 dark:text-slate-400" : ""}>{branchLabel(row)}</span> },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className="inline-flex flex-col items-end gap-1 md:items-start">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(row.is_active)}`}>
            {row.is_active ? "Active" : "Inactive"}
          </span>
          {/* Where the Approval PIN column is hidden (phones, tablets). */}
          {row.approval_pin_set_at && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-500 lg:hidden dark:text-slate-400">
              <ShieldCheck size={12} aria-hidden="true" className="text-emerald-600 dark:text-emerald-400" />PIN set
            </span>
          )}
        </span>
      ),
    },
    {
      key: "pin",
      header: "Approval PIN",
      mobileHidden: true,
      className: "hidden lg:table-cell",
      render: (row) => row.approval_pin_set_at
        ? <span className="inline-flex items-center gap-1 text-sm"><ShieldCheck size={14} aria-hidden="true" className="text-emerald-600 dark:text-emerald-400" />Set</span>
        : <span className="text-slate-400">—</span>,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "whitespace-nowrap",
      render: (row) => {
        const self = row.id === currentUserId;
        return (
          // The buttons act on their own; a click here doesn't open the profile.
          <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
            <RowAction icon={Pencil} label={`Edit ${row.full_name}`} tooltip="Edit name and email" onClick={() => setForm({ open: true, user: row })} />
            <RowAction icon={UserCog} label={`Change role for ${row.full_name}`} tooltip="Change role or branch" onClick={() => setRoleUser(row)}
              disabledReason={self ? "You can't change your own role" : null} />
            <RowAction icon={KeyRound} label={`Reset password for ${row.full_name}`} tooltip="Reset password" onClick={() => setResetUser(row)}
              disabledReason={self ? "Use Change password in your user menu" : null} />
            {row.is_active ? (
              <RowAction icon={ToggleLeft} label={`Deactivate ${row.full_name}`} tooltip="Deactivate" onClick={() => setStatusUser(row)}
                disabledReason={self ? "You can't deactivate your own account" : null} />
            ) : (
              <RowAction icon={ToggleRight} label={`Reactivate ${row.full_name}`} tooltip="Reactivate" onClick={() => setStatusUser(row)} />
            )}
          </div>
        );
      },
    },
  ], [currentUserId]);

  const emptyMessage = filtered ? "No users match these filters." : "No active users yet.";

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Staff accounts, their roles and branches, and who can sign in.</p>
        </div>
        <Button variant="accent" icon={Plus} label="Add user" onClick={() => setForm({ open: true, user: null })} className="shrink-0" />
      </header>

      <section className={`${panel} overflow-hidden`} aria-label="User directory">
        <div className="space-y-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <h2 className="font-semibold">Users <span className="ml-1 text-sm font-normal text-slate-500">({result.total})</span></h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
            <InputField label="Search" aria-label="Search users" name="user-search" type="search" icon={Search} placeholder="Search name, email, NIC or phone" value={search} onChange={(event) => setSearch(event.target.value)} />
            <InputField type="select" label="Role" name="user-role-filter" options={ROLE_OPTIONS} value={filters.role} onChange={setFilter("role")} />
            <InputField type="select" label="Status" name="user-status-filter" options={STATUS_OPTIONS} value={filters.status} onChange={setFilter("status")} />
            <InputField type="select" label="Branch" name="user-branch-filter" options={branchOptions} value={filters.branchId} onChange={setFilter("branchId")} />
          </div>
        </div>
        <div className="p-4 md:p-0">
          {!loading && result.error ? (
            <div className="p-5 text-center"><p role="alert" className="text-sm text-red-600 dark:text-red-400">{result.error}</p><Button className="mx-auto mt-3" size="sm" variant="secondary" label="Try again" onClick={load} /></div>
          ) : (
            <Table columns={columns} data={result.rows} loading={loading} ariaLabel="Users" emptyMessage={emptyMessage} onRowClick={setProfileUser} dense />
          )}
        </div>
        {result.pages > 1 && !(result.error && !loading) && <nav aria-label="User pages" className="flex items-center justify-center gap-3 border-t border-slate-200 p-3 dark:border-slate-800">
          <Button variant="secondary" label="Previous" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} />
          <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">Page {page} of {result.pages}</span>
          <Button variant="secondary" label="Next" disabled={page >= result.pages || loading} onClick={() => setPage((current) => Math.min(result.pages, current + 1))} />
        </nav>}
      </section>

      <UserProfileDialog
        user={profileUser}
        isSelf={profileUser?.id === currentUserId}
        onClose={() => setProfileUser(null)}
        onEdit={(user) => { setProfileUser(null); setForm({ open: true, user }); }}
        onChangeRole={(user) => { setProfileUser(null); setRoleUser(user); }}
        onResetPassword={(user) => { setProfileUser(null); setResetUser(user); }}
        onToggleStatus={(user) => { setProfileUser(null); setStatusUser(user); }}
      />
      <UserFormDialog open={form.open} user={form.user} onClose={() => setForm((current) => ({ ...current, open: false }))} onSaved={load} />
      <ChangeRoleDialog user={roleUser} onClose={() => setRoleUser(null)} onSaved={load} />
      <ResetPasswordDialog user={resetUser} onClose={() => setResetUser(null)} />
      <ConfirmDialog
        open={!!statusUser}
        onClose={() => setStatusUser(null)}
        onSuccess={() => { setStatusUser(null); load(); }}
        onConfirm={async () => {
          try {
            if (statusUser.is_active) await deactivateUser(statusUser.id);
            else await reactivateUser(statusUser.id);
          } catch (error) {
            // ConfirmDialog shows err.message; only the plain words travel.
            throw new Error(userErrorOf(error, `Couldn't ${statusUser.is_active ? "deactivate" : "reactivate"} this user. Try again.`).message, { cause: error });
          }
        }}
        action={statusUser?.is_active ? "deactivate" : "reactivate"}
        entityLabel="user"
        entityName={statusUser?.full_name ?? ""}
        descriptionOverride={statusUser?.is_active
          ? "They will no longer be able to sign in. Their saved sessions are ended and their approval PIN is cleared. A page they already have open can keep working for up to 15 minutes."
          : "They can sign in again with the same role, branch and password. Their approval PIN stays cleared until they set a new one."}
      />
    </div>
  );
}
