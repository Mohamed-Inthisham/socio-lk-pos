import { formatColomboDayLabel } from "./colomboDay";

/**
 * Day refusals (planning doc P9-9, cash-days.md C10, C11)
 *
 * Complete, void and return answer 409 DAY_NOT_OPEN or DAY_CLOSED, each
 * with business_date, when today's cash day at the sale's branch isn't
 * open. Nothing is written, and void and return check the day before the
 * PIN, so no attempt is spent. Read by status and `code`, never by
 * matching the message; the till never shows the server's message (it
 * carries the ISO date) and builds its own from the code and the date.
 *
 * completeErrors.js, voidErrors.js and returnErrors.js classify them; the
 * dialogs show dayRefusalText, then re-read the gate when they close
 * (cashDaySlice recheckCashDay).
 */

export const DAY_REFUSAL = {
  NOT_OPEN: "DAY_NOT_OPEN", // C10
  CLOSED: "DAY_CLOSED", // C11
};

export const DAY_ACTION = {
  COMPLETE: "complete",
  VOID: "void",
  RETURN: "return",
};

const CODES = Object.values(DAY_REFUSAL);

/**
 * The refusal in a response, or null.
 *
 * @param {{ status: number, data: object }|undefined} response - axios error.response
 * @returns {{ code: string, business_date: string|null }|null}
 */
export const dayRefusalOf = (response) => {
  const code = response?.data?.code;
  if (response?.status !== 409 || !CODES.includes(code)) return null;
  return { code, business_date: response.data.business_date ?? null };
};

const dayName = (businessDate) => (businessDate ? formatColomboDayLabel(businessDate) : "Today");

const NOTHING_CHANGED = "Nothing was changed and no PIN attempt was used.";

/**
 * What the dialog says for a refusal.
 *
 * @param {{ code: string, business_date: string|null }} refusal
 * @param {string} action - one of DAY_ACTION
 * @returns {{ title: string, message: string }} title: CompleteSaleDialog's
 *   alert heading (void and return show the message only)
 */
export const dayRefusalText = ({ code, business_date }, action) => {
  const day = dayName(business_date);
  const closed = code === DAY_REFUSAL.CLOSED;
  const title = closed ? "Today is closed" : "Today isn't open yet";

  switch (action) {
    case DAY_ACTION.COMPLETE:
      return {
        title,
        message: closed
          ? `${day} was closed, so this sale can't be completed. Nothing was saved. If the customer already paid, give the payment back. The cart is kept.`
          : `${day} hasn't been opened, so this sale can't be completed. Nothing was saved. Count the box without this sale's cash, enter the opening balance, then complete it. The cart and its payments are kept.`,
      };
    case DAY_ACTION.VOID:
      return {
        title,
        message: closed
          ? `${day} is closed: no voids until tomorrow's opening. ${NOTHING_CHANGED}`
          : `${day} hasn't been opened yet. ${NOTHING_CHANGED} Enter the opening balance, then void the sale.`,
      };
    default:
      return {
        title,
        message: closed
          ? `${day} is closed: no returns until tomorrow's opening. ${NOTHING_CHANGED}`
          : `${day} hasn't been opened yet. ${NOTHING_CHANGED} Enter the opening balance, then make the return.`,
      };
  }
};
