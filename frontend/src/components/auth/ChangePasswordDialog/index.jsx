import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDispatch } from "react-redux";
import { AlertCircle, CheckCircle2, LogIn } from "lucide-react";
import Dialog from "../../common/Dialog";
import Button from "../../common/Button";
import InputField from "../../common/InputField";
import {
  buildChangePasswordPayload,
  changePasswordDefaults,
  changePasswordSchema,
} from "../../../schemas/passwordSchema";
import { changeOwnPassword } from "../../../services/authService";
import { logoutUser, setSignInNotice } from "../../../store/slices/authSlice";
import { SIGN_IN_AGAIN_MESSAGE, userErrorOf } from "../../../utils/userErrors";
import { requestPosFocus } from "../../../utils/posFocus";

/**
 * ChangePasswordDialog (Task 2.4)
 *
 * The session user changes their own password, from the user menu (every
 * role). Current password, new password, confirm. PUT /auth/me/password;
 * built like ApprovalPinDialog.
 *
 * OUTCOMES:
 * - 204: the server revoked every saved session and set new cookies for
 *   this device, so the user stays signed in. A success view with Done.
 * - 403 WRONG_PASSWORD: under Current password, which is cleared and
 *   focused; the dialog stays open.
 * - 400 SAME_PASSWORD or a validation message: under New password.
 * - 503 PASSWORD_CHANGED_SIGN_IN_AGAIN: the password WAS changed, but no
 *   new session could start. Not a failure, and never retried (the old
 *   password no longer works): the dialog says so and offers Sign in,
 *   which leaves a notice for the login page (authSlice.setSignInNotice)
 *   and runs the usual logoutUser (cookies cleared on the server, every
 *   cache emptied); ProtectedRoute then sends the user to /login. The
 *   dialog can't be dismissed in this state.
 * - anything else: "Couldn't change your password. Try again."
 *
 * SECRETS: the passwords live only in this form while it is open; cleared
 * on close and after saving; never in Redux, storage or logs. Only the
 * error's status, code and message are read (utils/userErrors.js).
 *
 * PROPS: open, onClose
 */

const FORM_ID = "change-password-form";

const ChangePasswordDialog = ({ open, onClose }) => {
  const dispatch = useDispatch();
  // "form" | "done" | "sign-in-again"
  const [stage, setStage] = useState("form");
  const [apiError, setApiError] = useState(null);
  const actionRef = useRef(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: changePasswordDefaults,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const clearAll = () => {
    reset(changePasswordDefaults);
    setApiError(null);
  };

  const close = () => {
    if (isSubmitting || stage === "sign-in-again") return;
    clearAll();
    onClose();
  };

  const afterLeave = () => {
    clearAll();
    setStage("form");
    // Deferred: Headless UI restores focus to the opener after afterLeave.
    setTimeout(requestPosFocus, 0);
  };

  const signInAgain = () => {
    dispatch(setSignInNotice(SIGN_IN_AGAIN_MESSAGE));
    dispatch(logoutUser());
  };

  const onSubmit = async (values) => {
    setApiError(null);
    try {
      await changeOwnPassword(buildChangePasswordPayload(values));
      reset(changePasswordDefaults);
      setStage("done");
    } catch (err) {
      const { message, field, code } = userErrorOf(err, "Couldn't change your password. Try again.");
      if (code === "PASSWORD_CHANGED_SIGN_IN_AGAIN") {
        reset(changePasswordDefaults);
        setStage("sign-in-again");
        return;
      }
      if (field === "current_password") {
        setValue("current_password", "");
        setError("current_password", { type: "server", message }, { shouldFocus: true });
        return;
      }
      if (field === "new_password" || field === "password") {
        setError("new_password", { type: "server", message }, { shouldFocus: true });
        return;
      }
      setApiError(message);
    }
  };

  // The focused field is gone once the form gives way to a result view.
  useEffect(() => {
    if (stage !== "form") actionRef.current?.focus();
  }, [stage]);

  const title = { form: "Change password", done: "Password changed", "sign-in-again": "Password changed" }[stage];

  return (
    <Dialog
      open={open}
      onClose={close}
      afterLeave={afterLeave}
      title={title}
      description={stage === "form" ? "Your other devices will need to sign in again." : undefined}
      size="sm"
      dismissible={!isSubmitting && stage !== "sign-in-again"}
      footer={
        stage === "done" ? (
          <Button type="button" variant="accent" label="Done" onClick={close} ref={actionRef} />
        ) : stage === "sign-in-again" ? (
          <Button type="button" variant="accent" icon={LogIn} label="Sign in" onClick={signInAgain} ref={actionRef} />
        ) : (
          <>
            <Button type="button" variant="secondary" label="Cancel" onClick={close} disabled={isSubmitting} />
            <Button type="submit" variant="accent" form={FORM_ID} label="Change password" loading={isSubmitting} />
          </>
        )
      }
    >
      {stage === "done" && (
        <div role="status" className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
          <CheckCircle2 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p>Your password was changed. You're still signed in here; on your other devices, sign in again with the new password.</p>
        </div>
      )}
      {stage === "sign-in-again" && (
        <div role="alert" className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
          <CheckCircle2 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p>{SIGN_IN_AGAIN_MESSAGE}</p>
        </div>
      )}
      {stage === "form" && (
        <>
          {apiError && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
              <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
              <p className="text-xs text-red-700 dark:text-red-300">{apiError}</p>
            </div>
          )}
          <form
            id={FORM_ID}
            onSubmit={handleSubmit(onSubmit)}
            // Save sits in the dialog footer, outside this form: Enter is
            // handled here, as in ApprovalPinDialog (no double send).
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
              e.preventDefault();
              if (!isSubmitting) handleSubmit(onSubmit)();
            }}
            noValidate
            className="flex flex-col gap-4"
          >
            <InputField label="Current password" type="password" autoComplete="current-password"
              error={errors.current_password?.message} data-autofocus {...register("current_password")} />
            <InputField label="New password" type="password" autoComplete="new-password" hint="At least 8 characters"
              error={errors.new_password?.message} {...register("new_password")} />
            <InputField label="Confirm new password" type="password" autoComplete="new-password"
              error={errors.confirm_password?.message} {...register("confirm_password")} />
          </form>
        </>
      )}
    </Dialog>
  );
};

export default ChangePasswordDialog;
