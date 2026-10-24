/**
 * A time shown to people, in Colombo time: 12-hour with AM/PM, "2:35 PM".
 * The same shape as the till's frontend utils/colomboTime.js.
 *
 * Built from 24-hour parts, not Intl's own 12-hour output: ICU versions
 * disagree on the case of the day period and on the space before it (a
 * narrow no-break space, U+202F, in newer ones). Here it is always a plain
 * space and an uppercase AM / PM.
 */
const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatColomboTime(at: Date): string {
  const parts = Object.fromEntries(
    partsFormat.formatToParts(at).map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour) % 24;
  return `${hour % 12 || 12}:${parts.minute} ${hour < 12 ? 'AM' : 'PM'}`;
}
