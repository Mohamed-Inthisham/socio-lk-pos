/**
 * Colombo days for the recent-sales list (planning doc P6-2)
 *
 * A "day" is a Colombo calendar date, "YYYY-MM-DD". The list asks
 * GET /sales for one day by completed_at, sending the day's bounds as
 * timestamps with an explicit +05:30 offset: never date-only strings
 * (the backend answers 400, and a date-only `from` / `to` would be read
 * as a UTC day).
 *
 * Sri Lanka has used a fixed UTC+05:30 with no daylight saving since
 * 2006, so this is plain UTC arithmetic: the result never depends on the
 * till's clock zone.
 */

const OFFSET = "+05:30";
const OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n, width = 2) => String(n).padStart(width, "0");

const toDay = (date) =>
  `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** "2026-10-21" → that date at 00:00 UTC; throws on anything that isn't a real date. */
const parseDay = (day) => {
  const match = DAY_SHAPE.exec(String(day ?? ""));
  if (match) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (toDay(date) === day) return date;
  }
  throw new RangeError(`Not a day (YYYY-MM-DD): ${day}`);
};

/**
 * The Colombo date at a moment.
 *
 * @param {Date} [now]
 * @returns {string} "YYYY-MM-DD"
 */
export const colomboToday = (now = new Date()) => toDay(new Date(now.getTime() + OFFSET_MS));

/**
 * The day `delta` days after `day` (negative for before).
 *
 * @param {string} day - "YYYY-MM-DD"
 * @param {number} delta
 * @returns {string} "YYYY-MM-DD"
 */
export const shiftColomboDay = (day, delta) =>
  toDay(new Date(parseDay(day).getTime() + delta * DAY_MS));

/**
 * Whole Colombo days from a moment to a day: 0 on the same Colombo date,
 * 1 the next day (Phones to check: days waiting, P7-7).
 *
 * @param {string} iso - an ISO timestamp
 * @param {string} [today] - "YYYY-MM-DD" in Colombo
 * @returns {number}
 */
export const colomboDaysSince = (iso, today = colomboToday()) =>
  Math.round((parseDay(today).getTime() - parseDay(colomboToday(new Date(iso))).getTime()) / DAY_MS);

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dayLabelFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** An ISO timestamp → "14:32", Colombo time. "" for none. */
export const formatColomboTime = (iso) => (iso ? timeFormat.format(new Date(iso)) : "");

/**
 * "2026-10-22" → "Thu 22 Oct 2026" (the day itself; no zone shift). Built
 * from the parts: ICU versions disagree on a comma after the weekday.
 */
export const formatColomboDayLabel = (day) => {
  const parts = Object.fromEntries(
    dayLabelFormat.formatToParts(parseDay(day)).map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
};

/**
 * GET /sales bounds for one Colombo day: inclusive start, exclusive end
 * (the next midnight).
 *
 * @param {string} day - "YYYY-MM-DD"
 * @returns {{ completedFrom: string, completedTo: string }}
 *   e.g. { completedFrom: "2026-10-21T00:00:00+05:30",
 *          completedTo: "2026-10-22T00:00:00+05:30" }
 */
export const colomboDayBounds = (day) => {
  parseDay(day);
  return {
    completedFrom: `${day}T00:00:00${OFFSET}`,
    completedTo: `${shiftColomboDay(day, 1)}T00:00:00${OFFSET}`,
  };
};
