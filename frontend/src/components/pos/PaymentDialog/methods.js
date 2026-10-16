import { Banknote, CreditCard, Landmark, Smartphone, Wallet } from "lucide-react";

/**
 * The tenders P3 takes, in picker order. `key` is the number key that
 * picks it inside the dialog (P3-8: 1–5; TRADE_IN arrives as 6 in P4).
 */
export const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash", icon: Banknote, key: "1" },
  { value: "CARD", label: "Card", icon: CreditCard, key: "2" },
  { value: "BANK_TRANSFER", label: "Bank transfer", icon: Landmark, key: "3" },
  { value: "KOKO", label: "Koko", icon: Wallet, key: "4" },
  { value: "MINTPAY", label: "Mintpay", icon: Smartphone, key: "5" },
];

export const methodLabel = (value) =>
  PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value;
