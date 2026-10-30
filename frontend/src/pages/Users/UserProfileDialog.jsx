import { useState } from "react";
import { KeyRound, Pencil, ShieldCheck, ToggleLeft, ToggleRight, UserCog } from "lucide-react";
import Dialog from "../../components/common/Dialog";
import Button from "../../components/common/Button";
import { ROLE_INFO } from "../../constants/rolePermissions";
import { formatColomboDateTime } from "../../utils/colomboTime";
import { ROLE_BADGE, branchLabel, initialsOf, statusBadge } from "./userDisplay";

/**
 * UserProfileDialog (Task 2.4)
 *
 * The profile card a row opens on the Users page: who the user is, their
 * role, branch and status, whether they hold an approval PIN, and when the
 * account was added and last changed. Built from the list row: no request.
 *
 * The same actions as the row. Each one closes the card and opens its own
 * dialog (the page does that through the callbacks). On the admin's own
 * card only Edit is offered, with a note on why: the backend refuses the
 * rest for yourself.
 *
 * PROPS: user (null when closed), isSelf, onClose, onEdit, onChangeRole,
 * onResetPassword, onToggleStatus (each action gets the user)
 */

const pinText = (user) => {
  if (user.approval_pin_set_at) return `Set on ${formatColomboDateTime(user.approval_pin_set_at)}`;
  return user.role === "cashier" ? "Cashiers don't hold one" : "Not set";
};

function Detail({ label, wide = false, children }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 wrap-break-word text-sm text-slate-800 dark:text-slate-200">{children}</dd>
    </div>
  );
}

export default function UserProfileDialog({ user, isSelf, onClose, onEdit, onChangeRole, onResetPassword, onToggleStatus }) {
  // `shown` is kept while the dialog animates out, after `user` is cleared.
  const [shown, setShown] = useState(user);
  if (user && user !== shown) setShown(user);
  const u = user ?? shown;

  return (
    <Dialog
      open={!!user}
      onClose={onClose}
      title="User profile"
      footer={<Button variant="secondary" label="Close" onClick={onClose} />}
    >
      {u && (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-lg font-semibold text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300">
              {initialsOf(u.full_name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                {u.full_name}
                {isSelf && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">You</span>}
              </p>
              <p className="truncate text-sm text-slate-500 dark:text-slate-400">{u.email}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGE[u.role] ?? ""}`}>{ROLE_INFO[u.role]?.label ?? u.role}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge(u.is_active)}`}>{u.is_active ? "Active" : "Inactive"}</span>
              </div>
            </div>
          </div>

          <dl className="grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2 dark:border-slate-800">
            <Detail label="Email" wide>{u.email}</Detail>
            <Detail label="Branch">{branchLabel(u)}</Detail>
            <Detail label="Approval PIN">
              <span className="inline-flex items-center gap-1">
                {u.approval_pin_set_at && <ShieldCheck size={14} aria-hidden="true" className="shrink-0 text-emerald-600 dark:text-emerald-400" />}
                {pinText(u)}
              </span>
            </Detail>
            <Detail label="Added on">{formatColomboDateTime(u.created_at) || "—"}</Detail>
            <Detail label="Last updated">{formatColomboDateTime(u.updated_at) || "—"}</Detail>
          </dl>

          <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="secondary" icon={Pencil} label="Edit details" onClick={() => onEdit(u)} />
              {!isSelf && (
                <>
                  <Button variant="secondary" icon={UserCog} label="Change role" onClick={() => onChangeRole(u)} />
                  <Button variant="secondary" icon={KeyRound} label="Reset password" onClick={() => onResetPassword(u)} />
                  {u.is_active
                    ? <Button variant="secondary" icon={ToggleLeft} label="Deactivate" onClick={() => onToggleStatus(u)} />
                    : <Button variant="secondary" icon={ToggleRight} label="Reactivate" onClick={() => onToggleStatus(u)} />}
                </>
              )}
            </div>
            {isSelf && (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                This is your account. Another admin changes your role or status; change your password from your user menu.
              </p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
