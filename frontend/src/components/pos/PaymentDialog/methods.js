import { ArrowLeftRight, Banknote, CreditCard, Landmark, Smartphone, Wallet } from "lucide-react";
import { formatLKR } from "../../../utils/money";

/**
 * The tenders the terminal takes, in picker order. `key` is the number
 * key that picks it inside the dialog (P3-8: 1–5; P4-1: 6 = TRADE_IN).
 * `referenceHint` tells the cashier which reference to type for the
 * reference-based methods (shown under Reference number).
 */
export const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash", icon: Banknote, key: "1" },
  {
    value: "CARD",
    label: "Card",
    icon: CreditCard,
    key: "2",
    referenceHint: "Auth code or RRN from the card terminal slip",
  },
  {
    value: "BANK_TRANSFER",
    label: "Bank transfer",
    icon: Landmark,
    key: "3",
    referenceHint: "Reference on the transfer slip or banking app",
  },
  {
    value: "KOKO",
    label: "Koko",
    icon: Wallet,
    key: "4",
    referenceHint: "Transaction ID from Koko",
  },
  {
    value: "MINTPAY",
    label: "Mintpay",
    icon: Smartphone,
    key: "5",
    referenceHint: "Transaction ID from Mintpay",
  },
  { value: "TRADE_IN", label: "Trade-in", icon: ArrowLeftRight, key: "6" },
];

export const methodLabel = (value) =>
  PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value;

export const referenceHint = (value) =>
  PAYMENT_METHODS.find((m) => m.value === value)?.referenceHint;

/**
 * One line under a tender in the complete confirm and the Sale complete
 * panel: the phone for a trade-in, cash received for cash, the reference
 * for the rest (null when there is none).
 */
export const tenderDetail = (payment) => {
  if (payment.payment_method === "TRADE_IN") {
    return [payment.trade_in_product?.name, payment.trade_in_imei].filter(Boolean).join(" · ");
  }
  if (payment.payment_method === "CASH") return `Received ${formatLKR(payment.cash_received)}`;
  return payment.reference_number ? `Ref ${payment.reference_number}` : null;
};
