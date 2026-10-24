/**
 * Times shown to people, in Colombo time whatever the till's clock zone:
 * 12-hour with AM/PM, "2:35 PM" and "23 Oct 2026, 2:35 PM".
 *
 * Built from 24-hour parts, not Intl's own 12-hour output: ICU versions
 * disagree on the case of the day period and on the space before it (a
 * narrow no-break space, U+202F, in newer ones). Here it is always a plain
 * space and an uppercase AM / PM, so printing and tests are predictable.
 */

const partsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const colomboParts = (iso) =>
  Object.fromEntries(partsFormat.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));

/** 0 → "12:05 AM", 12 → "12:05 PM", 14 → "2:05 PM". */
const clock = ({ hour, minute }) => {
  const h = Number(hour) % 24;
  return `${h % 12 || 12}:${minute} ${h < 12 ? "AM" : "PM"}`;
};

/** An ISO timestamp → "2:35 PM". "" for none. */
export const formatColomboTime = (iso) => (iso ? clock(colomboParts(iso)) : "");

/** An ISO timestamp → "23 Oct 2026, 2:35 PM". "" for none. */
export const formatColomboDateTime = (iso) => {
  if (!iso) return "";
  const parts = colomboParts(iso);
  return `${parts.day} ${parts.month} ${parts.year}, ${clock(parts)}`;
};

/** An ISO timestamp → "23 Oct, 2:35 PM" (no year: the Sale complete panel). "" for none. */
export const formatColomboDayTime = (iso) => {
  if (!iso) return "";
  const parts = colomboParts(iso);
  return `${Number(parts.day)} ${parts.month}, ${clock(parts)}`;
};
