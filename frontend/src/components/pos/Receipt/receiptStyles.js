import { RECEIPT_LAYOUT } from "../../../constants/receipt";

/**
 * The thermal paper's styles, shared by the sale receipt and the return
 * slip (planning doc P5-11, P7-17). Black on white only (a thermal head
 * prints dots, no grey), inline styles in mm/px so the geometry doesn't
 * depend on the app's theme. The layout is the printer spike's: a 72mm
 * page, 64mm of content from a 1.2mm left margin (RECEIPT_LAYOUT).
 * `display: flow-root` keeps the last child's margin inside, so the
 * measured height is the printed height.
 */

export const BASE_FONT = "11px";
export const SMALL_FONT = "9px";

export const receiptStyles = {
  page: {
    width: `${RECEIPT_LAYOUT.pageWidthMm}mm`,
    paddingLeft: `${RECEIPT_LAYOUT.leftMarginMm}mm`,
    background: "#fff",
    color: "#000",
    boxSizing: "border-box",
  },
  content: {
    display: "flow-root",
    width: `${RECEIPT_LAYOUT.contentWidthMm}mm`,
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: BASE_FONT,
    lineHeight: 1.3,
    color: "#000",
  },
  center: { textAlign: "center" },
  logo: {
    display: "block",
    width: `${RECEIPT_LAYOUT.logoWidthMm}mm`,
    height: "auto",
    margin: "1mm auto 0",
  },
  tagline: {
    textAlign: "center",
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: "0.8mm",
    margin: "1mm 0 1.5mm",
  },
  row: { display: "flex", justifyContent: "space-between", gap: "2mm" },
  value: { whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  indent: { paddingLeft: "2.5mm" },
  rule: { border: 0, borderTop: "0.3mm dashed #000", margin: "1.5mm 0" },
  strongRule: { border: 0, borderTop: "0.5mm solid #000", margin: "1.5mm 0" },
  bold: { fontWeight: 700 },
  total: { fontSize: "14px", fontWeight: 700 },
  small: { fontSize: SMALL_FONT, lineHeight: 1.3 },
  line: { marginBottom: "1.2mm" },
  // Black only: a thermal head has no grey or red.
  voided: {
    border: "0.5mm solid #000",
    padding: "1.2mm 1.5mm",
    margin: "1mm 0 1.5mm",
    textAlign: "center",
  },
  voidedTitle: { fontSize: "14px", fontWeight: 700, letterSpacing: "0.3mm" },
};
