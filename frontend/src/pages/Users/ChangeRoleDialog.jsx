import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSelector } from "react-redux";
import { AlertCircle, Info } from "lucide-react";
import Dialog from "../../components/common/Dialog";
import Button from "../../components/common/Button";
import InputField from "../../components/common/InputField";
import { buildChangeRolePayload, changeRoleSchema, isRoleChange, needsBranch } from "../../schemas/userSchema";
import { changeUserRole } from "../../services/usersService";
import { userErrorOf } from "../../utils/userErrors";

/**
 * ChangeRoleDialog (Task 2.4)
 *
 * Role and branch in one PATCH /users/:id/role: the only way a user's
 * branch changes, so the move gets its ROLE_CHANGED audit row and the
 * user's sessions are revoked in the same transaction. An admin has no
 * branch (none is sent); a manager or cashier needs an active one.
 * Keeping the role and picking another branch moves a staff user.
 *
 * Nothing is sent when nothing changed. Refusals: LAST_ACTIVE_ADMIN and
 * CANNOT_CHANGE_OWN_ROLE in the alert, branch messages under Branch.
 *
 * PROPS: user (null when closed), onClose, onSaved
 */

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "cashier", label: "Cashier" },
];

const valuesOf = (user) => ({ role: user?.role ?? "cashier", branch_id: user?.branch_id ?? "" });

export default function ChangeRoleDialog({ user, onClose, onSaved }) {
  const branches = useSelector((state) => state.branches.branches);
  const [apiError, setApiError] = useState(null);
  // `shown` is kept while the dialog animates out, after `user` is cleared.
  const [shown, setShown] = useState(user);
  const [prevUser, setPrevUser] = useState(user);
  const open = !!user;
  if (user !== prevUser) {
    setPrevUser(user);
    if (user) {
      setShown(user);
      setApiError(null);
    }
  }

  const {
    register,
    handleSubmit,
    reset,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(changeRoleSchema),
    defaultValues: valuesOf(user),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  useEffect(() => {
    if (user) reset(valuesOf(user));
  }, [user, reset]);

  // InputField's select is controlled (value ?? ""), so it gets the
  // form's values: register alone would leave it blank.
  const [role, branchId] = useWatch({ control, name: ["role", "branch_id"] });

  const close = () => {
    if (isSubmitting) return;
    onClose();
  };

  const onSubmit = async (values) => {
    setApiError(null);
    if (!isRoleChange(values, shown)) {
      onClose();
      return;
    }
    try {
      await changeUserRole(shown.id, buildChangeRolePayload(values));
      onSaved?.();
      onClose();
    } catch (error) {
      const { message, field } = userErrorOf(error, "Couldn't change the role. Try again.");
      if (field === "branch_id" && needsBranch(values.role)) {
        setError("branch_id", { type: "server", message }, { shouldFocus: true });
      } else {
        setApiError(message);
      }
    }
  };

  // The user's current branch may be inactive (not in the list): still
  // show it, so the select isn't blank; the server refuses keeping it.
  const branchOptions = branches.map((b) => ({ value: b.id, label: b.name }));
  if (shown?.branch_id && !branchOptions.some((o) => o.value === shown.branch_id)) {
    branchOptions.push({ value: shown.branch_id, label: `${shown.branch?.name ?? "Current branch"} (inactive)` });
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Change role"
      description={shown ? `${shown.full_name} · ${shown.email}` : undefined}
      size="md"
      dismissible={!isSubmitting}
      footer={
        <>
          <Button type="button" variant="secondary" label="Cancel" onClick={close} disabled={isSubmitting} />
          <Button type="submit" variant="accent" form="user-role-form" label="Save role" loading={isSubmitting} />
        </>
      }
    >
      {apiError && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-xs text-red-700 dark:text-red-300">{apiError}</p>
        </div>
      )}
      <form id="user-role-form" onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField label="Role" type="select" options={ROLE_OPTIONS} required error={errors.role?.message} data-autofocus {...register("role")} value={role} />
          {needsBranch(role) ? (
            <InputField label="Branch" type="select" placeholder="Choose a branch" required options={branchOptions}
              error={errors.branch_id?.message} {...register("branch_id")} value={branchId} />
          ) : (
            <p className="self-end pb-3 text-xs text-slate-500 dark:text-slate-400">Admins work across all branches.</p>
          )}
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
          <div className="space-y-1">
            <p>The new role applies straight away. Saving a change also ends their saved sessions: a page they already have open keeps working for up to 15 minutes, then they sign in again.</p>
            {role === "cashier" && shown?.role !== "cashier" && <p>Cashiers don't have an approval PIN: theirs will be cleared.</p>}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
