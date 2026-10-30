import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import Dialog from "../../components/common/Dialog";
import Button from "../../components/common/Button";
import InputField from "../../components/common/InputField";
import {
  buildResetPasswordPayload,
  resetPasswordDefaults,
  resetPasswordSchema,
} from "../../schemas/passwordSchema";
import { resetUserPassword } from "../../services/usersService";
import { userErrorOf } from "../../utils/userErrors";

/**
 * ResetPasswordDialog (Task 2.4)
 *
 * An admin sets another user's password: new password + confirmation
 * (8 characters to 72 UTF-8 bytes; the confirmation is never sent).
 * POST /users/:id/password (204). The server ends the user's saved
 * sessions; the approval PIN is left as it is.
 *
 * On success the form gives way to a success view (never showing the
 * password) with Done. The passwords live only in this form while it is
 * open: cleared after saving and on close; the axios error, which
 * carries them, is never kept or logged.
 *
 * PROPS: user (null when closed), onClose
 */

const FORM_ID = "user-reset-password-form";

export default function ResetPasswordDialog({ user, onClose }) {
  // `shown` is kept while the dialog animates out, after `user` is cleared.
  const [shown, setShown] = useState(user);
  const [prevUser, setPrevUser] = useState(user);
  const [done, setDone] = useState(false);
  const [apiError, setApiError] = useState(null);
  const doneRef = useRef(null);
  const open = !!user;
  if (user !== prevUser) {
    setPrevUser(user);
    if (user) {
      setShown(user);
      setDone(false);
      setApiError(null);
    }
  }

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: resetPasswordDefaults,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const clearAll = () => {
    reset(resetPasswordDefaults);
    setApiError(null);
  };

  const close = () => {
    if (isSubmitting) return;
    clearAll();
    onClose();
  };

  const afterLeave = () => {
    clearAll();
    setDone(false);
  };

  const onSubmit = async (values) => {
    setApiError(null);
    try {
      await resetUserPassword(shown.id, buildResetPasswordPayload(values));
      reset(resetPasswordDefaults);
      setDone(true);
    } catch (error) {
      const { message, field } = userErrorOf(error, "Couldn't reset the password. Try again.");
      if (field === "password") {
        setError("new_password", { type: "server", message }, { shouldFocus: true });
      } else {
        setApiError(message);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      afterLeave={afterLeave}
      title={done ? "Password reset" : "Reset password"}
      description={done || !shown ? undefined : `${shown.full_name} · ${shown.email}`}
      size="sm"
      dismissible={!isSubmitting}
      footer={
        done ? (
          <Button type="button" variant="accent" label="Done" onClick={close} ref={doneRef} />
        ) : (
          <>
            <Button type="button" variant="secondary" label="Cancel" onClick={close} disabled={isSubmitting} />
            <Button type="submit" variant="accent" form={FORM_ID} label="Reset password" loading={isSubmitting} />
          </>
        )
      }
    >
      {done ? (
        <div role="status" className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
          <CheckCircle2 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p>
            {shown?.full_name}'s password was reset. Give them the new password in person. Their saved sessions have
            ended; a page they already have open can keep working for up to 15 minutes.
          </p>
        </div>
      ) : (
        <>
          {apiError && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
              <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
              <p className="text-xs text-red-700 dark:text-red-300">{apiError}</p>
            </div>
          )}
          <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <InputField label="New password" type="password" autoComplete="new-password" required
              hint="At least 8 characters" error={errors.new_password?.message} data-autofocus {...register("new_password")} />
            <InputField label="Confirm new password" type="password" autoComplete="new-password" required
              error={errors.confirm_password?.message} {...register("confirm_password")} />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Their saved sessions end and they sign in with the new password. A page they already have open can keep
              working for up to 15 minutes. Their approval PIN doesn't change.
            </p>
          </form>
        </>
      )}
    </Dialog>
  );
}
