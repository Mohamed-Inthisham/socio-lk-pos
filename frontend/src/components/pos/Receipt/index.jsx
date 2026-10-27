import { methodLabel } from "../PaymentDialog/methods";
import { formatSlPhone } from "../../../utils/phone";
import { fromCents, toCents } from "../../../utils/money";
import { ReceiptHeader, ReceiptPage, Row } from "./receiptParts";
import { receiptStyles as styles } from "./receiptStyles";
import {
  cashChange,
  receiptAmount,
  receiptDateTime,
  receiptDiscountLabel,
  receiptWarranty,
} from "../../../utils/receipt";
import { RECEIPT_FOOTER, RECEIPT_TERMS, RECEIPT_TERMS_TITLE } from "../../../constants/receipt";

/**
 * Receipt Component
 *
 * The 80mm thermal receipt for a completed sale (planning doc P5-11,
 * P5-18). Print-only: utils/printReceipt.js renders it into #receipt-root
 * and prints it; it never shows in the terminal itself.
 *
 * The page, its styles and the shop header are shared with the return
 * slip (receiptParts.jsx, receiptStyles.js): black on white, inline mm/px
 * styles, the printer spike's 72mm page with 64mm of content.
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

const VoidedBlock = ({ sale, testId }) => (
  <div style={styles.voided} data-testid={testId}>
    <div style={styles.voidedTitle}>VOIDED — NOT VALID</div>
    <div>Voided {receiptDateTime(sale.voided_at)}</div>
    {sale.void_reason && <div>Reason: {sale.void_reason}</div>}
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
    <ReceiptPage testId="receipt">
      {voided && <VoidedBlock sale={sale} testId="receipt-voided-top" />}
      <ReceiptHeader branch={branch} />

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
          {line.imei_snapshot && <div style={styles.indent}>{line.identifier_type_snapshot === "SERIAL_NUMBER" ? "Serial number" : "IMEI"} {line.imei_snapshot}</div>}
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
    </ReceiptPage>
  );
};

export default Receipt;
