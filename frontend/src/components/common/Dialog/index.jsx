import { Fragment } from "react";
import {
  Dialog as HeadlessDialog,
  DialogPanel,
  DialogTitle,
  Description,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { X } from "lucide-react";

/**
 * Dialog Component
 *
 * A generic modal dialog built on Headless UI's Dialog. Handles focus trap,
 * click-outside dismissal, Escape to close, and focus restoration on close.
 * Styled with Tailwind to match the app design system.
 *
 * SIZES:
 * - sm: 400px max — confirmations, single-question dialogs
 * - md: 512px max — small forms (stock adjustment)
 * - lg: 720px max — larger forms (product create/edit if we ever modal them)
 *
 * SLOTS:
 * - title: heading text at the top
 * - description: optional muted text under the title
 * - children: main body (form fields, message, etc)
 * - footer: right-aligned action buttons (Cancel, Confirm, etc)
 *
 * PROPS:
 * - open: boolean
 * - onClose: () => void, called when user dismisses (Escape, backdrop click, X)
 * - title: string
 * - description: optional string
 * - size: 'sm' | 'md' | 'lg' (default 'md')
 * - hideCloseButton: hide the X button in the top-right
 * - dismissible: whether clicking backdrop / pressing Escape closes (default true).
 *   Set to false for "submitting" states so users can't dismiss mid-request.
 */

const SIZE_CLASSES = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

const Dialog = ({
  open,
  onClose,
  title,
  description,
  size = "md",
  hideCloseButton = false,
  dismissible = true,
  children,
  footer,
}) => {
  // If dismissible=false, we intercept onClose so the dialog can't be dismissed
  // by backdrop click or Escape. The X button is also hidden in that case.
  const handleClose = () => {
    if (dismissible) onClose();
  };

  return (
    <Transition appear show={open} as={Fragment}>
      <HeadlessDialog as="div" className="relative z-50" onClose={handleClose}>
        {/* Backdrop */}
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm" />
        </TransitionChild>

        {/* Panel container */}
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel
                className={`
                  w-full ${SIZE_CLASSES[size]}
                  bg-white dark:bg-slate-900
                  border border-slate-200 dark:border-slate-700
                  rounded-xl shadow-2xl shadow-slate-900/20 dark:shadow-black/60
                  overflow-hidden
                `}
              >
                {/* Header */}
                {(title || !hideCloseButton) && (
                  <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
                    <div className="flex-1 min-w-0">
                      {title && (
                        <DialogTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                          {title}
                        </DialogTitle>
                      )}
                      {description && (
                        <Description className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          {description}
                        </Description>
                      )}
                    </div>
                    {!hideCloseButton && dismissible && (
                      <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close dialog"
                        className="
                          flex-shrink-0 -mt-1 -mr-1
                          w-8 h-8 flex items-center justify-center
                          rounded-lg
                          text-slate-400 dark:text-slate-500
                          hover:bg-slate-100 dark:hover:bg-slate-800
                          hover:text-slate-700 dark:hover:text-slate-200
                          transition-colors
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
                        "
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                )}

                {/* Body */}
                <div className="px-6 pb-5">{children}</div>

                {/* Footer */}
                {footer && (
                  <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950/50 border-t border-slate-200 dark:border-slate-800 flex flex-wrap justify-end gap-3">
                    {footer}
                  </div>
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </HeadlessDialog>
    </Transition>
  );
};

export default Dialog;
