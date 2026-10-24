import { formatColomboDayLabel, shiftColomboDay } from "./colomboDay";
import { formatLKR } from "./money";

/**
 * Cash day wording (planning doc P9-7, P9-8). Dates come from the server's
 * business_date, never the till's clock.
 */

/**
 * "Fri 23 Oct" in the same year as `today`, "Thu 23 Oct 2025" otherwise.
 *
 * @param {string} day - "YYYY-MM-DD"
 * @param {string} [today] - the server's business_date
 */
export const shortDayLabel = (day, today) => {
  const label = formatColomboDayLabel(day);
  return today && day.slice(0, 4) === today.slice(0, 4) ? label.slice(0, -5) : label;
};

/**
 * The opening dialog's information line (P9-8): "Yesterday closed with
 * LKR 15,400.00" when the last closed day is the day before today, else
 * "Fri 23 Oct closed with LKR 15,400.00". null when no day was ever closed.
 *
 * @param {{ business_date: string, counted_balance: string }|null} lastClosed
 * @param {string} today - the server's business_date
 * @returns {string|null}
 */
export const lastClosedLine = (lastClosed, today) => {
  if (!lastClosed) return null;
  const amount = formatLKR(lastClosed.counted_balance);
  if (today && lastClosed.business_date === shiftColomboDay(today, -1)) {
    return `Yesterday closed with ${amount}`;
  }
  return `${shortDayLabel(lastClosed.business_date, today)} closed with ${amount}`;
};
