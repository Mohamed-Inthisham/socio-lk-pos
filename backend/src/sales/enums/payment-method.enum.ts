/**
 * How a payment was tendered on a Sale.
 *
 * CASH: physical cash. Only method where cash_received > amount is
 *   allowed (the excess is change returned to the customer).
 *
 * CARD: swipe/tap on the shop's terminal. Requires reference_number
 *   (the terminal's auth code / RRN) for bank reconciliation.
 *
 * BANK_TRANSFER: customer transfers to shop's bank account. Requires
 *   reference_number (bank slip reference or transaction ID) so the
 *   payment can be matched against the bank statement.
 *
 * KOKO / MINTPAY: Sri Lankan buy-now-pay-later services. Both issue
 *   transaction IDs via their apps; require reference_number for
 *   reconciliation with the provider's settlement reports.
 *
 * Enforcement:
 *   - reference_number is nullable at the DB level (future methods may
 *     not need one), but REQUIRED for all methods except CASH at the
 *     service layer.
 *   - cash_received is nullable, NON-NULL and >= amount only when
 *     payment_method = CASH (enforced by CHK constraints and service).
 */
export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  KOKO = 'KOKO',
  MINTPAY = 'MINTPAY',
}
