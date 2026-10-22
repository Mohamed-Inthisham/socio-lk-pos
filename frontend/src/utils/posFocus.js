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
