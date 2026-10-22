import logo from "../../../assets/receipt/socio-logo-receipt.png";
import { methodLabel } from "../PaymentDialog/methods";
import { formatSlPhone } from "../../../utils/phone";
import { fromCents, toCents } from "../../../utils/money";
import {
  cashChange,
  receiptAmount,
  receiptDateTime,
  receiptDiscountLabel,
  receiptWarranty,
} from "../../../utils/receipt";
import {
  RECEIPT_FOOTER,
  RECEIPT_LAYOUT,
  RECEIPT_TERMS,
  RECEIPT_TERMS_TITLE,
  SHOP_NAME,
  SHOP_TAGLINE,
} from "../../../constants/receipt";

/**
 * Receipt Component
 *
 * The 80mm thermal receipt for a completed sale (planning doc P5-11,
 * P5-18). Print-only: utils/printReceipt.js renders it into #receipt-root
 * and prints it; it never shows in the terminal itself.
 *
 * Black on white only (a thermal head prints dots, no grey), inline
 * styles in mm/px so the geometry doesn't depend on the app's theme. The
 * layout is the printer spike's: a 72mm page, 64mm of content from a
 * 1.2mm left margin (RECEIPT_LAYOUT). `display: flow-root` keeps the last
 * child's margin inside, so the measured height is the printed height.
 *
 * Contents, top to bottom: the logo (instead of the shop name), the
 * tagline as text (cropped out of the logo image: too small there), branch
 * name / address / phone (from the sale's branch), invoice number, date
 * and time (Colombo), cashier, customer name and full phone (no NIC), the
 * lines (IMEI, qty × price, "Discount (20%)" / "Discount (160.00 each)",
 * warranty; nothing for NO_WARRANTY), totals, each tender
 * (reference; trade-in phone + IMEI; cash received and change), the
 * terms, and the footer.
 *
 * MARKINGS (P6-7):
 * - reprintedAt: a reprint from the sale detail page prints
 *   "REPRINT · <date, time printed>" under the invoice number. The Sale
 *   complete panel's Reprint and "Last receipt" pass nothing (unmarked).
 * - A VOIDED sale, whichever way it's printed, gets a "VOIDED — NOT VALID"
 *   block (voided date and time, reason) as the very first thing on the
 *   paper and again above the footer, and no Change line.
 *
 * PROPS:
 * - sale: the hydrated COMPLETED or VOIDED sale
 * - reprintedAt: ISO time of a detail-page reprint, or undefined
 */

const BASE_FONT = "11px";
const SMALL_FONT = "9px";

const styles = {
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

const VoidedBlock = ({ sale, testId }) => (
  <div style={styles.voided} data-testid={testId}>
    <div style={styles.voidedTitle}>VOIDED — NOT VALID</div>
    <div>Voided {receiptDateTime(sale.voided_at)}</div>
    {sale.void_reason && <div>Reason: {sale.void_reason}</div>}
  </div>
);

const Row = ({ label, value, style }) => (
  <div style={{ ...styles.row, ...style }}>
    <span>{label}</span>
    <span style={styles.value}>{value}</span>
  </div>
);

const tenderLabel = (payment) => {
  const label = methodLabel(payment.payment_method);
  return payment.reference_number && payment.payment_method !== "CASH"
    ? `${label} (Ref ${payment.reference_number})`
    : label;
};

const Receipt = ({ sale, reprintedAt }) => {
  const branch = sale.branch ?? {};
  const customer = sale.customer;
  const lines = sale.lines ?? [];
  const payments = sale.payments ?? [];
  const discount = Number(sale.discount_total ?? 0);
  const voided = sale.status === "VOIDED";

  return (
    <div style={styles.page} data-testid="receipt">
      <div style={styles.content}>
        {voided && <VoidedBlock sale={sale} testId="receipt-voided-top" />}
        <img src={logo} alt={SHOP_NAME} style={styles.logo} />
        <div style={styles.tagline} data-testid="receipt-tagline">
          {SHOP_TAGLINE}
        </div>
        <div style={styles.center}>
          {branch.name && <div style={styles.bold}>{branch.name}</div>}
          {branch.address && <div>{branch.address}</div>}
          {branch.phone && <div>Tel {formatSlPhone(branch.phone)}</div>}
        </div>

        <hr style={styles.rule} />
        <Row label="Invoice" value={sale.sale_number} />
        {reprintedAt && (
          <div style={styles.bold} data-testid="receipt-reprint">
            REPRINT · {receiptDateTime(reprintedAt)}
          </div>
        )}
        <Row label="Date" value={receiptDateTime(sale.completed_at)} />
        {sale.cashier?.full_name && <Row label="Cashier" value={sale.cashier.full_name} />}
        {customer && (
          <>
            <Row label="Customer" value={customer.name} />
            {customer.phone && <Row label="Phone" value={formatSlPhone(customer.phone)} />}
          </>
        )}

        <hr style={styles.rule} />
        {lines.map((line) => (
          <div key={line.id} style={styles.line} data-testid="receipt-line">
            <div style={styles.bold}>{line.product_name_snapshot}</div>
            {line.imei_snapshot && <div style={styles.indent}>IMEI {line.imei_snapshot}</div>}
            <Row
              style={styles.indent}
              label={`${line.quantity} × ${receiptAmount(line.unit_price)}`}
              value={receiptAmount(fromCents(toCents(line.unit_price) * line.quantity))}
            />
            {Number(line.discount_amount) > 0 && (
              <Row
                style={styles.indent}
                label={receiptDiscountLabel(line)}
                value={`-${receiptAmount(line.discount_amount)}`}
              />
            )}
            {receiptWarranty(line) && (
              <div style={{ ...styles.indent, ...styles.small }}>{receiptWarranty(line)}</div>
            )}
          </div>
        ))}

        <hr style={styles.rule} />
        <Row label="Subtotal" value={receiptAmount(sale.subtotal)} />
        {discount > 0 && <Row label="Discount" value={`-${receiptAmount(sale.discount_total)}`} />}
        <hr style={styles.strongRule} />
        <Row style={styles.total} label="TOTAL" value={`LKR ${receiptAmount(sale.total)}`} />

        <hr style={styles.rule} />
        {payments.map((payment) => (
          <div key={payment.id} data-testid="receipt-payment">
            <Row label={tenderLabel(payment)} value={receiptAmount(payment.amount)} />
            {payment.payment_method === "TRADE_IN" && (
              <div style={{ ...styles.indent, ...styles.small }}>
                {[payment.trade_in_product?.name, payment.trade_in_imei && `IMEI ${payment.trade_in_imei}`]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
            {payment.payment_method === "CASH" && (
              <>
                <Row style={styles.indent} label="Cash received" value={receiptAmount(payment.cash_received)} />
                {!voided && Number(cashChange(payment)) > 0 && (
                  <Row style={{ ...styles.indent, ...styles.bold }} label="Change" value={receiptAmount(cashChange(payment))} />
                )}
              </>
            )}
          </div>
        ))}

        <hr style={styles.rule} />
        <div style={styles.small} data-testid="receipt-terms">
          <div style={styles.bold}>{RECEIPT_TERMS_TITLE}</div>
          {/* listStyleType: the app's base styles (Tailwind preflight) remove list numbers */}
          <ol style={{ margin: "0.5mm 0 0", paddingLeft: "3.5mm", listStyleType: "decimal" }}>
            {RECEIPT_TERMS.map((term) => (
              <li key={term} style={{ marginBottom: "0.5mm" }}>
                {term}
              </li>
            ))}
          </ol>
        </div>

        <hr style={styles.rule} />
        {voided && <VoidedBlock sale={sale} testId="receipt-voided-bottom" />}
        <div style={{ ...styles.center, ...styles.bold, marginBottom: "2mm" }}>{RECEIPT_FOOTER}</div>
      </div>
    </div>
  );
};

export default Receipt;
