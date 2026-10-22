import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import Button from "../../common/Button";
import PinField from "../PinField";
import { listApprovers } from "../../../services/approvalsService";
import { SET_YOUR_PIN_MESSAGE } from "../../../utils/voidErrors";

/**
 * ManagerApprovalFields Component
 *
 * "Manager approval" for an action that needs a manager's or admin's PIN
 * (planning doc P6-20, P6-21): voids now, returns in P7. Approver select
 * from GET /approvers?branchId= and the shared PinField.
 *
 * - The list is fetched every time this mounts (each time the dialog
 *   opens), never cached: a manager who has just set a PIN shows up.
 * - Default approver: the session user when they're on the list (a
 *   manager or admin with a PIN); a cashier's session picks nobody.
 * - A manager or admin who isn't on the list (no PIN yet) is told to set
 *   one or pick another approver; nobody on the list at all says how to
 *   set one, and the action can't go ahead.
 *
 * The PIN is registered by the parent form; this component never reads,
 * stores or logs it.
 *
 * PROPS:
 * - branchId: the branch whose approvers count (the sale's)
 * - sessionUser: state.auth.user
 * - approverRegistration, pinRegistration: register("approver_id") / register("pin")
 * - approverError, pinError: messages under each field
 * - setApprover: (id) => void — sets the form's approver (the default)
 * - onStatus: ({ status: "loading"|"ready"|"error", count }) => void
 * - disabled: while the parent is busy
 */

const ManagerApprovalFields = ({
  branchId,
  sessionUser,
  approverRegistration,
  pinRegistration,
  approverError,
  pinError,
  setApprover,
  onStatus,
  disabled = false,
}) => {
  const [state, setState] = useState({ status: "loading", approvers: [] });
  const [attempt, setAttempt] = useState(0);

  const report = useCallback((next) => onStatus?.({ status: next.status, count: next.approvers.length }), [onStatus]);

  useEffect(() => {
    let live = true;
    listApprovers(branchId)
      .then((approvers) => {
        if (!live) return;
        const next = { status: "ready", approvers };
        setState(next);
        report(next);
      })
      .catch(() => {
        if (!live) return;
        const next = { status: "error", approvers: [] };
        setState(next);
        report(next);
      });
    return () => {
      live = false;
    };
    // Fresh on every mount and on Retry; sessionUser / setApprover are stable for the dialog's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, attempt]);

  // The default approver, once its <option> exists (a select can't take a
  // value it has no option for). Once per load.
  const defaulted = useRef(false);
  useEffect(() => {
    if (state.status !== "ready" || defaulted.current) return;
    defaulted.current = true;
    if (state.approvers.some((a) => a.id === sessionUser?.id)) setApprover(sessionUser.id);
  }, [state, sessionUser, setApprover]);

  const retry = () => {
    defaulted.current = false;
    const next = { status: "loading", approvers: [] };
    setState(next);
    report(next);
    setAttempt((n) => n + 1);
  };

  const canApprove = sessionUser?.role === "admin" || sessionUser?.role === "manager";
  const selfMissing =
    state.status === "ready" && state.approvers.length > 0 && canApprove && !state.approvers.some((a) => a.id === sessionUser.id);
  const nobody = state.status === "ready" && state.approvers.length === 0;

  return (
    <fieldset className="flex flex-col gap-3 min-w-0" disabled={disabled}>
      <legend className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
        Manager approval
      </legend>

      {state.status === "error" && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <AlertCircle size={14} aria-hidden="true" className="shrink-0" />
          <span className="flex-1">Couldn&apos;t load the approvers.</span>
          <Button size="sm" variant="secondary" label="Retry" onClick={retry} />
        </div>
      )}

      {nobody && (
        <p role="alert" className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          No manager has set an approval PIN yet. A manager sets it from the user menu → Approval PIN.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_14rem] gap-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <label
            htmlFor="void-approver"
            className="text-xs uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400"
          >
            Approver
          </label>
          <select
            id="void-approver"
            {...approverRegistration}
            disabled={disabled || state.status !== "ready" || nobody}
            aria-invalid={approverError ? "true" : undefined}
            aria-describedby={approverError ? "void-approver-error" : selfMissing ? "void-approver-note" : undefined}
            className={`
              h-11 w-full px-3 rounded-lg text-sm
              bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100
              border ${approverError ? "border-red-400 dark:border-red-500" : "border-slate-300 dark:border-slate-600"}
              focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500
              disabled:opacity-60 scheme-light dark:scheme-dark
            `}
          >
            <option value="">
              {state.status === "loading" ? "Loading approvers…" : "Pick who approves"}
            </option>
            {state.approvers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
              </option>
            ))}
          </select>
          {approverError ? (
            <p id="void-approver-error" className="text-xs text-red-500 dark:text-red-400 mt-0.5">
              {approverError}
            </p>
          ) : (
            selfMissing && (
              <p id="void-approver-note" className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                {SET_YOUR_PIN_MESSAGE}
              </p>
            )
          )}
        </div>
        <PinField id="void-approval-pin" label="Approval PIN" error={pinError} registration={pinRegistration} />
      </div>
    </fieldset>
  );
};

export default ManagerApprovalFields;
