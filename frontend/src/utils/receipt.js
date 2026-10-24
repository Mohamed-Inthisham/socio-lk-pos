import { warrantyLabel } from "../constants/warranty";
import { fromCents, toCents } from "./money";
import { CHECKING_ONLY_TEXT } from "../constants/receipt";
import { discountShortLabel } from "./discount";
import { formatColomboDateTime } from "./colomboTime";

/**
 * Formatting for the printed receipt (P5-11). Pure functions, so the
 * receipt reads the same wherever it's rendered.
 */

const amountFormat = new Intl.NumberFormat("en-LK", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "1500" / "1500.00" → "1,500.00" (no currency; the TOTAL line adds it). */
export const receiptAmount = (value) => amountFormat.format(Number(value ?? 0));

/** An ISO timestamp → "21 Oct 2026, 2:32 PM", in Colombo time whatever the till's clock zone. */
export const receiptDateTime = formatColomboDateTime;

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** A date-only value ("2027-10-21") → "21 Oct 2027", without any time-zone shift. */
export const receiptDate = (isoDate) =>
  isoDate ? dateFormat.format(new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`)) : "";

/**
 * A sale line's warranty as printed (P5-18, P5-19):
 * "Warranty: 12 months (until 21 Oct 2027)", "Checking only" for
 * CHECKING, and null (nothing printed) for NO_WARRANTY.
 */
export const receiptWarranty = (line) => {
  if (!line.warranty || line.warranty === "NO_WARRANTY") return null;
  if (line.warranty === "CHECKING") return CHECKING_ONLY_TEXT;
  const until = line.warranty_until ? ` (until ${receiptDate(line.warranty_until)})` : "";
  return `Warranty: ${warrantyLabel(line.warranty)}${until}`;
};

/**
 * Has a line's warranty run out (P6-6)? `warranty_until` is the last day
 * covered, a Colombo date (backend products/warranty.ts), so it has expired
 * once today in Colombo is after it. False when there is no end date
 * (NO_WARRANTY, CHECKING).
 *
 * @param {Object} line - a sale line
 * @param {string} today - "YYYY-MM-DD" in Colombo (colomboToday())
 */
export const warrantyExpired = (line, today) =>
  !!line.warranty_until && today > String(line.warranty_until).slice(0, 10);

/**
 * The label of a line's discount row (P5-20): "Discount (20%)",
 * "Discount (160.00 each)", or just "Discount" (an AMOUNT discount).
 */
export const receiptDiscountLabel = (line) => {
  const short = discountShortLabel(line, receiptAmount);
  return short ? `Discount (${short})` : "Discount";
};

/** Cash handed back on one cash tender, in integer cents (P3-9) → "10.00"; "0.00" when none. */
export const cashChange = (payment) =>
  fromCents(Math.max(0, toCents(payment.cash_received ?? "0") - toCents(payment.amount ?? "0")));
