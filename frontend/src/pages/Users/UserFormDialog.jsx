import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSelector } from "react-redux";
import { AlertCircle } from "lucide-react";
import Dialog from "../../components/common/Dialog";
import Button from "../../components/common/Button";
import InputField from "../../components/common/InputField";
import {
  buildCreateUserPayload,
  buildEditUserPayload,
  createUserDefaults,
  createUserSchema,
  editUserSchema,
  needsBranch,
} from "../../schemas/userSchema";
import { createUser, updateUser } from "../../services/usersService";
import { userErrorOf } from "../../utils/userErrors";

/**
 * UserFormDialog (Task 2.4)
 *
 * Create mode (user = null): full name, email, password + confirmation,
 * role (Cashier by default) and, for a manager or cashier, an active
 * branch. POST /users; an admin is sent no branch.
 *
 * Edit mode: full name and email only. PATCH /users/:id with just what
 * changed: never a role or branch (ChangeRoleDialog does those, with
 * their audit row and session revocation), never null.
 *
 * Server refusals land under their field (409 email, a branch message)
 * or in the alert. Passwords live only in this form while it is open and
 * are cleared on close; the axios error (which carries them) is never
 * kept or logged.
 *
 * PROPS: open, user (null to create), onClose, onSaved
 */

const ROLE_OPTIONS = [
  { value: "cashier", label: "Cashier" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

function FormAlert({ message }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
      <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
      <p className="text-xs text-red-700 dark:text-red-300">{message}</p>
    </div>
  );
}

/** Handle a refused save: under its field when the form has it. */
const showServerError = (error, fallback, fields, setError, setApiError) => {
  const { message, field } = userErrorOf(error, fallback);
  if (field && fields.includes(field)) {
    setError(field, { type: "server", message }, { shouldFocus: true });
  } else {
    setApiError(message);
  }
};

const footerFor = (formId, submitLabel, isSubmitting, close) => (
  <>
    <Button type="button" variant="secondary" label="Cancel" onClick={close} disabled={isSubmitting} />
    <Button type="submit" variant="accent" form={formId} label={submitLabel} loading={isSubmitting} />
  </>
);

function CreateUserDialog({ open, onClose, onSaved }) {
  const branches = useSelector((state) => state.branches.branches);
  const [apiError, setApiError] = useState(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createUserSchema),
    defaultValues: createUserDefaults,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  // InputField's select is controlled (value ?? ""), so it gets the
  // form's values: register alone would leave it blank.
  const [role, branchId] = useWatch({ control, name: ["role", "branch_id"] });

  const clearAll = () => {
    reset(createUserDefaults);
    setApiError(null);
  };
  const close = () => {
    if (isSubmitting) return;
    clearAll();
    onClose();
  };

  const onSubmit = async (values) => {
    setApiError(null);
    try {
      await createUser(buildCreateUserPayload(values));
      clearAll();
      onSaved?.();
      onClose();
    } catch (error) {
      showServerError(error, "Couldn't create the user. Try again.",
        ["full_name", "email", "password", "branch_id", "role"], setError, setApiError);
    }
  };

  return (
    <Dialog open={open} onClose={close} afterLeave={clearAll} title="Add user"
      description="They sign in with this email and password." size="md" dismissible={!isSubmitting}
      footer={footerFor("user-create-form", "Add user", isSubmitting, close)}>
      <FormAlert message={apiError} />
      <form id="user-create-form" onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <InputField label="Full name" name="user-full-name" autoComplete="off" required error={errors.full_name?.message} data-autofocus {...register("full_name")} />
        <InputField label="Email" name="user-email" type="email" autoComplete="off" required error={errors.email?.message} {...register("email")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField label="Password" name="user-password" type="password" autoComplete="new-password" required
            hint="At least 8 characters" error={errors.password?.message} {...register("password")} />
          <InputField label="Confirm password" name="user-confirm-password" type="password" autoComplete="new-password" required
            error={errors.confirm_password?.message} {...register("confirm_password")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField label="Role" type="select" options={ROLE_OPTIONS} required error={errors.role?.message} {...register("role")} value={role} />
          {needsBranch(role) ? (
            <InputField label="Branch" type="select" placeholder="Choose a branch" required
              options={branches.map((b) => ({ value: b.id, label: b.name }))} error={errors.branch_id?.message} {...register("branch_id")} value={branchId} />
          ) : (
            <p className="self-end pb-3 text-xs text-slate-500 dark:text-slate-400">Admins work across all branches.</p>
          )}
        </div>
      </form>
    </Dialog>
  );
}

function EditUserDialog({ open, user, onClose, onSaved }) {
  const [apiError, setApiError] = useState(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setApiError(null);
  }
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(editUserSchema),
    defaultValues: { full_name: user.full_name, email: user.email },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  useEffect(() => {
    if (open) reset({ full_name: user.full_name, email: user.email });
  }, [open, user, reset]);

  const close = () => {
    if (isSubmitting) return;
    onClose();
  };

  const onSubmit = async (values) => {
    setApiError(null);
    const payload = buildEditUserPayload(values, user);
    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }
    try {
      await updateUser(user.id, payload);
      onSaved?.();
      onClose();
    } catch (error) {
      showServerError(error, "Couldn't save the changes. Try again.", ["full_name", "email"], setError, setApiError);
    }
  };

  return (
    <Dialog open={open} onClose={close} title="Edit user"
      description="Name and email. Change the role or branch with Change role." size="md" dismissible={!isSubmitting}
      footer={footerFor("user-edit-form", "Save changes", isSubmitting, close)}>
      <FormAlert message={apiError} />
      <form id="user-edit-form" onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <InputField label="Full name" name="user-full-name" autoComplete="off" required error={errors.full_name?.message} data-autofocus {...register("full_name")} />
        <InputField label="Email" name="user-email" type="email" autoComplete="off" required hint="They sign in with this email." error={errors.email?.message} {...register("email")} />
      </form>
    </Dialog>
  );
}

export default function UserFormDialog({ open, user, onClose, onSaved }) {
  if (user) return <EditUserDialog key={user.id} open={open} user={user} onClose={onClose} onSaved={onSaved} />;
  return <CreateUserDialog open={open} onClose={onClose} onSaved={onSaved} />;
}
