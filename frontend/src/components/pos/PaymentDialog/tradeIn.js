/**
 * TRADE_IN helpers shared by the PaymentDialog, TradeInFields and
 * TradeInProductPicker (planning doc §8 P4 decision log).
 */

export const TRADE_IN_PRODUCT_LIMIT = 20;
export const NO_TRADE_IN_PRODUCT =
  "No used-phone product for this model. Ask an admin to add one.";
export const LUHN_HINT = "Check digit doesn't match — rescan?";
export const RESALE_BELOW_VALUE_HINT = "Below the trade-in value";

export const isUsedProduct = (product) => product?.phone_condition === "USED";

/**
 * P4-3: the server can't filter on is_serialized, so keep serialized,
 * active products only, USED SKUs first (server order kept within each
 * group).
 */
export const tradeInCandidates = (products) => {
  const eligible = products.filter((p) => p.is_serialized && p.is_active !== false);
  return [...eligible.filter(isUsedProduct), ...eligible.filter((p) => !isUsedProduct(p))];
};

/** P4-7: a trade-in 409 by `existing_unit.status`, or null for any other error. */
export const tradeInImeiConflict = (error) => {
  if (error?.status !== 409) return null;
  switch (error.existing_unit?.status) {
    case "IN_STOCK":
      return "Already in stock: the shop holds a phone with this IMEI.";
    case "WRITTEN_OFF":
      return "This IMEI is on a written-off phone. Ask a manager to check it.";
    default:
      return "This IMEI is already in inventory.";
  }
};
