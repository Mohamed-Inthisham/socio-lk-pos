import { Fragment } from "react";
import {
  Dialog as HeadlessDialog,
  DialogPanel,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { X } from "lucide-react";

/**
 * Drawer Component
 *
 * A slide-in panel anchored to one side of the viewport. Uses Headless UI's
 * Dialog primitive under the hood (portal, focus trap, click-outside, Escape
 * to close), but styled as a full-height panel rather than a centered modal.
 *
 * Distinct from Dialog (our centered modal primitive). Dialog is for
 * confirmations and small forms; Drawer is for larger panels that benefit
 * from full-height layout — mobile sidebars, POS cart, order details, etc.
 *
 * PROPS:
 * - open: boolean
 * - onClose: () => void
 * - side: 'left' | 'right' (default 'left')
 * - width: Tailwind width class (default 'w-72')
 * - title: optional heading text shown in the drawer header
 * - hideCloseButton: hide the X button
 * - children: main body
 */

const SIDE_CONFIG = {
  left: {
    positionClass: "inset-y-0 left-0",
    enterFrom: "-translate-x-full",
    enterTo: "translate-x-0",
    leaveFrom: "translate-x-0",
    leaveTo: "-translate-x-full",
    justify: "justify-start",
  },
  right: {
    positionClass: "inset-y-0 right-0",
    enterFrom: "translate-x-full",
    enterTo: "translate-x-0",
    leaveFrom: "translate-x-0",
    leaveTo: "translate-x-full",
    justify: "justify-end",
  },
};

const Drawer = ({
  open,
  onClose,
  side = "left",
  width = "w-72",
  title,
  hideCloseButton = false,
  children,
}) => {
  const config = SIDE_CONFIG[side] || SIDE_CONFIG.left;

  return (
    <Transition appear show={open} as={Fragment}>
      <HeadlessDialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-900/60 dark:bg-black/70" />
        </TransitionChild>

        <div className={`fixed inset-0 flex ${config.justify}`}>
          <TransitionChild
            as={Fragment}
            enter="transform transition ease-out duration-250"
            enterFrom={config.enterFrom}
            enterTo={config.enterTo}
            leave="transform transition ease-in duration-200"
            leaveFrom={config.leaveFrom}
            leaveTo={config.leaveTo}
          >
            <DialogPanel
              className={`
                ${width} h-full
                bg-white dark:bg-slate-900
                border-r border-slate-200 dark:border-slate-800
                flex flex-col
                shadow-2xl
              `}
            >
              {(title || !hideCloseButton) && (
                <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
                  {title ? (
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {title}
                    </span>
                  ) : (
                    <span />
                  )}
                  {!hideCloseButton && (
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label="Close drawer"
                      className="
                        w-9 h-9 flex items-center justify-center
                        rounded-lg
                        text-slate-500 dark:text-slate-400
                        hover:bg-slate-100 dark:hover:bg-slate-800
                        hover:text-slate-700 dark:hover:text-slate-200
                        transition-colors
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
                      "
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-hidden">{children}</div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </HeadlessDialog>
    </Transition>
  );
};

export default Drawer;
