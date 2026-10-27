import { ReceiptHeader, ReceiptPage, Row } from "../Receipt/receiptParts";
import { receiptStyles as styles } from "../Receipt/receiptStyles";
import { methodLabel } from "../PaymentDialog/methods";
import { recordedTradeInCents } from "../ReturnDialog/returnText";
import { formatSlPhone } from "../../../utils/phone";
import { fromCents, toCents } from "../../../utils/money";
import { receiptAmount, receiptDateTime } from "../../../utils/receipt";
import { RECEIPT_FOOTER, RETURN_SLIP_NOTE } from "../../../constants/receipt";

/**
 * ReturnSlip Component
 *
 * The printed slip for a recorded return (planning doc P7-17), on the
 * receipt's paper and layout (receiptParts.jsx). Print-only:
 * utils/printReceipt.js printReturnSlip renders it into #receipt-root,
 * once per copy.
 *
 * Contents, top to bottom: the shop header; RETURN / REFUND and the copy
 * (CUSTOMER COPY / SHOP COPY); the return number (and "REPRINT · <time>"
 * on a reprint), its date and time; the original invoice and when it was
 * sold; the cashier (requester) and who approved; the customer's name and
 * phone (no NIC); each returned item with its IMEI, quantity, refund share
 * and where it goes; the refund (and the amount due when lower); how it
 * went back (Cash; Card reversal with its reference; …, or No refund);
 * the trade-in's part; the reason; the outside-warranty approval; on the
 * shop copy only, when cash went back, "Received LKR X cash." and a
 * customer signature line; the footer and "Keep this slip with your
 * original bill.".
 *
 * Everything comes from the recorded return (sale.returns[]), never from
 * the form that made it.
 *
 * PROPS:
 * - sale: the hydrated sale, with returns[]
 * - ret: the return to print (an entry of sale.returns)
 * - copy: "customer" | "shop"
 * - reprintedAt: ISO time of a reprint (step E's Returns section), or undefined
 */

const DISPOSITION = {
  RESTOCKED: "Back to stock",
  DAMAGED: "Damaged",
  INSPECTION: "For inspection",
  NOT_OUR_STOCK: "Not our stock",
  UNTRACKED: "No stock change",
};

const title = { ...styles.center, fontSize: "14px", fontWeight: 700, letterSpacing: "0.3mm" };
const signatureLine = { borderBottom: "0.3mm solid #000", height: "10mm", margin: "1mm 0 0.5mm" };

const refundLabel = (refund) =>
  refund.method === "CASH"
    ? "Cash"
    : `${methodLabel(refund.method)} reversal${refund.reference_number ? ` (Ref ${refund.reference_number})` : ""}`;

/** "2 × 1,600.00" when the share splits evenly by unit, else "Qty 3". */
const quantityLabel = (line) => {
  const cents = toCents(line.refund_share);
  return cents % line.quantity === 0
    ? `${line.quantity} × ${receiptAmount(fromCents(cents / line.quantity))}`
    : `Qty ${line.quantity}`;
};

const ReturnSlip = ({ sale, ret, copy, reprintedAt }) => {
  const customer = sale.customer;
  const shopCopy = copy === "shop";
  const cashCents = ret.refunds
    .filter((r) => r.method === "CASH")
    .reduce((sum, r) => sum + toCents(r.amount), 0);
  const lowered = toCents(ret.refund_total) < toCents(ret.refund_due);
  const tradeInCents = recordedTradeInCents(ret, sale);
  const lineOf = (id) => sale.lines.find((l) => l.id === id);

  return (
    <ReceiptPage testId={`return-slip-${copy}`}>
      <ReceiptHeader branch={sale.branch ?? {}} />

      <hr style={styles.strongRule} />
      <div style={title}>RETURN / REFUND</div>
      <div style={{ ...styles.center, ...styles.bold }} data-testid="slip-copy">
        {shopCopy ? "SHOP COPY" : "CUSTOMER COPY"}
      </div>
      <hr style={styles.rule} />

      <Row label="Return" value={ret.return_number} />
      {reprintedAt && (
        <div style={styles.bold} data-testid="slip-reprint">
          REPRINT · {receiptDateTime(reprintedAt)}
        </div>
      )}
      <Row label="Date" value={receiptDateTime(ret.created_at)} />
      <Row label="Invoice" value={sale.sale_number} />
      <Row label="Sold" value={receiptDateTime(sale.completed_at)} />
      {ret.requester?.full_name && <Row label="Cashier" value={ret.requester.full_name} />}
      {ret.approver?.full_name && <Row label="Approved by" value={ret.approver.full_name} />}
      {customer && (
        <>
          <Row label="Customer" value={customer.name} />
          {customer.phone && <Row label="Phone" value={formatSlPhone(customer.phone)} />}
        </>
      )}

      <hr style={styles.rule} />
      {ret.lines.map((line) => (
        <div key={line.sale_line_id} style={styles.line} data-testid="slip-line">
          <div style={styles.bold}>{lineOf(line.sale_line_id)?.product_name_snapshot ?? "Item"}</div>
          {line.product_unit?.imei && (
            <div style={styles.indent}>
              {lineOf(line.sale_line_id)?.identifier_type_snapshot === "SERIAL_NUMBER" ? "Serial number" : "IMEI"} {line.product_unit.imei}
            </div>
          )}
          <Row style={styles.indent} label={quantityLabel(line)} value={receiptAmount(line.refund_share)} />
          <div style={{ ...styles.indent, ...styles.small }}>{DISPOSITION[line.disposition] ?? line.disposition}</div>
        </div>
      ))}

      <hr style={styles.strongRule} />
      <Row style={styles.total} label="REFUND" value={`LKR ${receiptAmount(ret.refund_total)}`} />
      {lowered && (
        <div style={{ ...styles.small, textAlign: "right" }} data-testid="slip-due">
          of LKR {receiptAmount(ret.refund_due)} due
        </div>
      )}
      <div data-testid="slip-refunds">
        {ret.refunds.length === 0 ? (
          <div>No refund</div>
        ) : (
          ret.refunds.map((refund, i) => (
            <Row key={`${refund.method}-${i}`} label={refundLabel(refund)} value={receiptAmount(refund.amount)} />
          ))
        )}
      </div>
      {tradeInCents > 0 && (
        <div style={styles.small} data-testid="slip-trade-in">
          Includes LKR {receiptAmount(fromCents(tradeInCents))} from a trade-in
        </div>
      )}

      <hr style={styles.rule} />
      <div>Reason: {ret.reason}</div>
      {ret.out_of_warranty && ret.override_reason && (
        <div style={{ ...styles.bold, marginTop: "1mm" }} data-testid="slip-override">
          Outside warranty — approved by {ret.approver?.full_name ?? "a manager"}: {ret.override_reason}
        </div>
      )}

      {shopCopy && cashCents > 0 && (
        <div data-testid="slip-signature">
          <hr style={styles.rule} />
          <div>Received LKR {receiptAmount(fromCents(cashCents))} cash.</div>
          <div style={signatureLine} />
          <div style={styles.small}>Customer signature</div>
        </div>
      )}

      <hr style={styles.rule} />
      <div style={{ ...styles.center, ...styles.bold }}>{RECEIPT_FOOTER}</div>
      <div style={{ ...styles.center, ...styles.small, marginBottom: "2mm" }}>{RETURN_SLIP_NOTE}</div>
    </ReceiptPage>
  );
};

export default ReturnSlip;
