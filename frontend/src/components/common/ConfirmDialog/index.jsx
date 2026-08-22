import { useState } from "react";
import { AlertTriangle, Power } from "lucide-react";
import Dialog from "../Dialog";
import Button from "../Button";

/**
 * ConfirmDialog Component
 *
 * A specialised confirmation dialog for deactivate/reactivate actions on a
 * named entity (product, brand, category, etc). Built on top of common/Dialog.
 *
 * WHY THIS ABSTRACTION EXISTS:
 * Extracted from three near-identical deactivate dialogs (Product, Brand,
 * Category) that only varied in entity noun, service call, and one line of
 * description copy. Everything else — the ACTION_CONFIG map, the submitting
 * and error state, the icon layout, the error banner, the reset-on-close
 * behaviour — was duplicated across all three. Rule of three: once we saw
 * the same shape three times, the variation was clear enough to abstract
 * without guessing.
 *
 * WHY IT'S DEACTIVATE/REACTIVATE-SPECIFIC (not a fully generic ConfirmDialog):
 * A fully generic version would push every string, colour, and icon back to
 * the caller and become a very thin wrapper over Dialog — saving little. This
 * captures the *actual* repeated pattern: "confirm a soft-lifecycle action on
 * some named entity". If a future case needs a truly generic confirm (delete
 * forever, log out everywhere, etc), we widen the API then — not now.
 *
 * WHY ConfirmDialog OWNS THE SUBMITTING/ERROR STATE:
 * The whole point of the extraction is that this state and its reset logic
 * were what got duplicated. Callers pass an `onConfirm` async function; we
 * await it, catch errors, and reset when the dialog closes.
 *
 * PROPS:
 * - open: boolean, controls visibility
 * - onClose: () => void, called on cancel/backdrop/escape
 * - onSuccess: () => void, called after `onConfirm` resolves successfully.
 *   Parent should refetch the list to reflect the new is_active state.
 * - onConfirm: () => Promise<void>. Called on confirm click. Its rejection
 *   is caught and surfaced in the error banner; its resolution triggers
 *   onSuccess. The service call is the caller's concern.
 * - action: 'deactivate' | 'reactivate'
 * - entityLabel: string, singular noun for the entity ('brand', 'category',
 *   'product'). Used in the title, button, and "You're about to X <label>"
 *   sentence. Keep it lowercase.
 * - entityName: string, the display name shown in bold in the body.
 * - descriptionOverride: optional string. If provided, replaces the default
 *   description for the current action. Use for entity-specific caveats
 *   (e.g. "does NOT cascade to sub-categories").
 * - errorFallback: optional string, shown when the caught error has no
 *   response.data.message or err.message. Defaults to a generic message.
 */

const ACTION_CONFIG = {
  deactivate: {
    titlePrefix: "Deactivate",
    confirmLabel: "Yes, deactivate",
    confirmVariant: "danger",
    defaultDescription: (label) =>
      `The ${label} will be hidden. You can reactivate it later.`,
    icon: AlertTriangle,
    iconTone: "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400",
    defaultErrorFallback: (label) => `Couldn't deactivate the ${label}.`,
  },
  reactivate: {
    titlePrefix: "Reactivate",
    confirmLabel: "Yes, reactivate",
    confirmVariant: "accent",
    defaultDescription: (label) => `The ${label} will become active again.`,
    icon: Power,
    iconTone:
      "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-600 dark:text-cyan-400",
    defaultErrorFallback: (label) => `Couldn't reactivate the ${label}.`,
  },
};

const ConfirmDialog = ({
  open,
  onClose,
  onSuccess,
  onConfirm,
  action = "deactivate",
  entityLabel,
  entityName,
  descriptionOverride,
  errorFallback,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const config = ACTION_CONFIG[action] || ACTION_CONFIG.deactivate;
  const Icon = config.icon;

  const title = `${config.titlePrefix} ${entityLabel}`;
  const description =
    descriptionOverride ?? config.defaultDescription(entityLabel);
  const fallback = errorFallback ?? config.defaultErrorFallback(entityLabel);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || err.message || fallback);
      setSubmitting(false);
    }
    // On success, parent unmounts us (open=false) so no need to setSubmitting(false).
  };

  const handleClose = () => {
    // Reset error when dialog closes so it doesn't linger on next open
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={title}
      description={description}
      size="sm"
      dismissible={!submitting}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={handleClose}
            disabled={submitting}
            label="Cancel"
          />
          <Button
            variant={config.confirmVariant}
            onClick={handleConfirm}
            loading={submitting}
            label={config.confirmLabel}
          />
        </>
      }
    >
      <div className="flex items-start gap-4 py-2">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${config.iconTone}`}
        >
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            You're about to {action}{" "}
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {entityName}
            </span>
            .
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-3">
          <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}
    </Dialog>
  );
};

export default ConfirmDialog;
