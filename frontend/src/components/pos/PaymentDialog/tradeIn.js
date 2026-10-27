/**
 * TRADE_IN helpers shared by the PaymentDialog, TradeInFields and
 * TradeInProductPicker (planning doc §8 P4 decision log).
 */

export const TRADE_IN_PRODUCT_LIMIT = 20;
export const NO_TRADE_IN_PRODUCT =
  "No used-phone product for this model. Ask an admin to add one.";
export const LUHN_HINT = "Check digit doesn't match — rescan?";
export const RESALE_BELOW_VALUE_HINT = "Below the trade-in value";

export const TRADE_IN_NEEDS_CUSTOMER = "Trade-in needs a customer";
export const TRADE_IN_NEEDS_NIC = "Trade-in needs the customer's NIC";
export const NIC_LENGTH_MESSAGE = "NIC must be 5–20 characters.";
export const NIC_CONFLICT_MESSAGE =
  "This NIC is on file for another customer. Check it, or change the customer.";

/** P4-2 / P4-13: why the sale can't take a trade-in yet, or null when it can. */
export const tradeInBlocker = (customer) => {
  if (!customer) return "customer";
  if (!customer.nic) return "nic";
  return null;
};

export const isUsedProduct = (product) => product?.phone_condition === "USED";

/**
 * P4-3: the server can't filter on is_serialized, so keep serialized,
 * active products only, USED SKUs first (server order kept within each
 * group).
 */
export const tradeInCandidates = (products) => {
  const eligible = products.filter(
    (p) =>
      (p.tracking_method ? p.tracking_method === "IMEI" : p.is_serialized) &&
      p.is_active !== false,
  );
  return [
    ...eligible.filter(isUsedProduct),
    ...eligible.filter((p) => !isUsedProduct(p)),
  ];
};

/** P4-7: a trade-in 409 by `existing_unit.status`, or null for any other error. */
export const tradeInImeiConflict = (error) => {
  if (error?.status !== 409) return null;
  switch (error.existing_unit?.status) {
    case "IN_STOCK":
      return "Already in stock: the shop holds a phone with this IMEI.";
    case "WRITTEN_OFF":
      return "This IMEI is on a written-off phone. Ask a manager to check it.";
    // A returned phone waiting for its check (P7-6). The add-time 409
    // carries no IMEI (FOLLOWUPS); the IMEI is in the field it shows under.
    case "INSPECTION":
      return "This phone was returned and is waiting to be checked. It can't be taken in again.";
    default:
      return "This IMEI is already in inventory.";
  }
};
