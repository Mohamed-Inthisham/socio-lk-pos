import logo from "../../../assets/receipt/socio-logo-receipt.png";
import { formatSlPhone } from "../../../utils/phone";
import { SHOP_NAME, SHOP_TAGLINE } from "../../../constants/receipt";
import { receiptStyles as styles } from "./receiptStyles";

/**
 * Pieces shared by the sale receipt and the return slip (planning doc
 * P5-11, P7-17), so both print on the same paper the same way.
 */

/** The 72mm page and its 64mm content column. */
export const ReceiptPage = ({ testId, children }) => (
  <div style={styles.page} data-testid={testId}>
    <div style={styles.content}>{children}</div>
  </div>
);

/**
 * The shop header: the logo (instead of the shop name), the tagline as
 * text (cropped out of the logo image: too small there), and the
 * branch's name, address and phone (from the sale's branch record).
 */
export const ReceiptHeader = ({ branch = {} }) => (
  <>
    <img src={logo} alt={SHOP_NAME} style={styles.logo} />
    <div style={styles.tagline} data-testid="receipt-tagline">
      {SHOP_TAGLINE}
    </div>
    <div style={styles.center}>
      {branch.name && <div style={styles.bold}>{branch.name}</div>}
      {branch.address && <div>{branch.address}</div>}
      {branch.phone && <div>Tel {formatSlPhone(branch.phone)}</div>}
    </div>
  </>
);

/** A label on the left, a value (never wrapped) on the right. */
export const Row = ({ label, value, style }) => (
  <div style={{ ...styles.row, ...style }}>
    <span>{label}</span>
    <span style={styles.value}>{value}</span>
  </div>
);
