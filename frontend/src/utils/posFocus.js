/**
 * Focus hand-off from outside the terminal (planning doc §6, P6-18).
 *
 * Dialogs that live in the layout, not in PosTerminal (ApprovalPinDialog,
 * opened from the user menu), can't reach the scan bar's ref. When they
 * close they fire this event; PosTerminal, while mounted, answers by
 * handing focus to the scan bar (its returnFocus: skipped on touch-only
 * devices). On any other page nothing listens, and Headless UI's own
 * focus return (to the opener) stands.
 */
export const POS_RETURN_FOCUS_EVENT = "pos:return-focus";

export const requestPosFocus = () => window.dispatchEvent(new CustomEvent(POS_RETURN_FOCUS_EVENT));

/**
 * Focus what the terminal's <main> shows once the day gate has moved on
 * (P9): "amount" is the opening dialog's amount; "heading" is the page's
 * main heading (the Day closed screen, the earlier-day panel, the sales
 * list…), made focusable with tabindex -1 if it isn't. Used after the
 * close dialog and after a refused complete, void or return.
 *
 * @param {"amount"|"heading"} target
 */
export const focusTerminalMain = (target) => {
  const main = document.querySelector("main");
  if (!main) return;
  if (target === "amount") {
    main.querySelector('input[name="opening_balance"]')?.focus();
    return;
  }
  const heading = main.querySelector("h1");
  if (!heading) return;
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  heading.focus();
};

/**
 * Focus after a refused complete, void or return, once the gate's re-read
 * (cashDaySlice recheckCashDay) has settled and rendered: the opening
 * amount when the gate shows the opening dialog, else the main heading
 * when the gate replaced the page. Returns false when the page is still
 * there (today open, or closed off /pos), so the caller focuses its own
 * target.
 */
const focusAfterDayRecheck = () => {
  const main = document.querySelector("main");
  if (!main) return false;
  if (main.querySelector('input[name="opening_balance"]')) {
    focusTerminalMain("amount");
    return true;
  }
  if (main.querySelector('[data-day-gate-screen]')) {
    focusTerminalMain("heading");
    return true;
  }
  return false;
};

/**
 * The refused dialog's re-read, with the gate's focus hand-off: once it has
 * settled and rendered, focus goes to the gate's screen if it replaced the
 * page. That can happen before the dialog's leave transition ends (the
 * page, and the dialog's afterLeave, are then gone), so it can't wait for
 * afterLeave. Resolves true when the gate took the focus; false when the
 * page is still there and its afterLeave picks the target.
 *
 * @param {Promise<unknown>} recheck - dispatch(recheckCashDay())
 * @returns {Promise<boolean>}
 */
export const whenDayRechecked = (recheck) =>
  Promise.resolve(recheck).then(
    () => new Promise((resolve) => setTimeout(() => resolve(focusAfterDayRecheck()), 0)),
  );
