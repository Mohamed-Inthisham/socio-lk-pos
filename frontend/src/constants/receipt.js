/**
 * The printed receipt (planning doc P5-11 – P5-14).
 *
 * Shop texts come from the shop (2026-10-21). Branch name, address and
 * phone come from the sale's branch record, not from here.
 *
 * Layout comes from the printer spike on the Xprinter XP-80 (handoff
 * notes, "Final print settings"): Chrome paper 80(72)mm x 3276mm, Margins
 * Default, Scale Custom 100, driver Horizontal Offset 0. The driver
 * enlarges everything by ~1.057, which the content width and the left
 * margin already allow for: 64mm of content from 1.2mm prints centred
 * with ~6mm each side. Font sizes are chosen with that enlargement in mind.
 */

/** Alt text for the logo (printed instead of the name). */
export const SHOP_NAME = "SOCIO.LK";

/**
 * Printed as text under the logo: in the 6:1 logo image it would be under
 * 1mm tall, too small for the thermal head, so it was cropped out of
 * assets/receipt/socio-logo-receipt.png.
 */
export const SHOP_TAGLINE = "CARE THAT STAYS";

export const RECEIPT_TERMS_TITLE = "TERMS & CONDITIONS (T&C)";

export const RECEIPT_TERMS = [
  "Exchanges & Warranty: The original bill is required for all exchanges and warranty claims.",
  "Repair Collection: Repaired devices must be collected within 14 days of notification. The shop is not responsible for items left uncollected after this period.",
  "Warranty Exclusions: Warranty does not cover physical damage, liquid damage, misuse, or unauthorized repairs.",
];

export const RECEIPT_FOOTER = "Thank you for choosing Care That Stays";

export const CHECKING_ONLY_TEXT = "Checking only";

/** Under the footer on a return slip (P7-17), instead of the receipt's terms. */
export const RETURN_SLIP_NOTE = "Keep this slip with your original bill.";

/** Page and content geometry, in mm (CSS mm; the driver prints ~×1.057). */
export const RECEIPT_LAYOUT = {
  pageWidthMm: 72,
  contentWidthMm: 64,
  leftMarginMm: 1.2,
  // Shorter pages print sideways (round 2 of the spike)
  minPageHeightMm: 90,
  // Rounding (CSS px → mm → PDF points) must never spill onto a 2nd page
  slackMm: 1,
  logoWidthMm: 60,
};
