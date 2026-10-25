import { COMPLETE_ERROR } from "../../../utils/completeErrors";
import { DAY_ACTION, DAY_REFUSAL, dayRefusalText } from "../../../utils/dayRefusal";

/**
 * What the CompleteSaleDialog tells the cashier about a failed complete
 * (planning doc P5-8), from the classified error (utils/completeErrors.js).
 *
 * Returns { title, body, fix, reload, nic } (and dayRefused: true for a day refusal):
 * - fix: "cart" | "payments" | null — the sale has to change before it can
 *   complete: Complete is blocked and the dialog offers "Fix the cart" /
 *   "Fix the payments", which closes it (the row stays highlighted).
 *   null = trying again may work, so Complete stays available.
 * - reload: the terminal's copy of the sale is out of date — re-read it.
 * - nic: show the NIC form instead of a message (E8).
 * - dayRefused: today isn't open (P9-9, utils/dayRefusal.js). Nothing was
 *   saved and the cart is kept; only Close is offered, and the gate
 *   re-reads once the dialog closes.
 */

const SAFE_RETRY = "Nothing was saved. Try again.";

export const describeCompleteError = (err) => {
  const describe = (title, body, extra = {}) => ({
    title,
    body,
    fix: null,
    reload: false,
    nic: false,
    ...extra,
  });

  switch (err.kind) {
    case COMPLETE_ERROR.DAY_NOT_OPEN:
    case COMPLETE_ERROR.DAY_CLOSED: {
      const { title, message } = dayRefusalText(
        {
          code: err.kind === COMPLETE_ERROR.DAY_CLOSED ? DAY_REFUSAL.CLOSED : DAY_REFUSAL.NOT_OPEN,
          business_date: err.business_date ?? null,
        },
        DAY_ACTION.COMPLETE,
      );
      return describe(title, message, { dayRefused: true });
    }
    case COMPLETE_ERROR.OUT_OF_STOCK: {
      const figures =
        err.requested != null && err.available != null
          ? `${err.requested} needed, ${err.available} in stock`
          : "not enough in stock";
      return describe(
        "Not enough stock",
        `${err.product_name ?? "An item"}: ${figures}. Remove or reduce it, or ask a manager to adjust stock.`,
        { fix: "cart" },
      );
    }
    case COMPLETE_ERROR.UNIT_SOLD:
      return describe(
        "Phone already sold",
        `The phone with IMEI ${err.imei} was sold on another sale. Remove that line from the cart.`,
        { fix: "cart" },
      );
    case COMPLETE_ERROR.TRADE_IN_IMEI_IN_STOCK:
      if (err.existing_unit?.status === "INSPECTION") {
        // A returned phone waiting for its check (P7-6)
        return describe(
          "Trade-in phone waiting to be checked",
          `The trade-in phone${err.imei ? ` (IMEI ${err.imei})` : ""} was returned and is waiting to be checked. It can't be taken in again: remove the trade-in.`,
          { fix: "payments" },
        );
      }
      return describe(
        "Trade-in phone already in stock",
        `The trade-in phone${err.imei ? ` (IMEI ${err.imei})` : ""} is already in the shop's stock. Remove the trade-in and check the phone.`,
        { fix: "payments" },
      );
    case COMPLETE_ERROR.TRADE_IN_PRODUCT_INACTIVE:
      return describe(
        "Trade-in product inactive",
        `${err.product_name ? `"${err.product_name}"` : "The trade-in's product"} was deactivated. Remove the trade-in and add it again with an active product.`,
        { fix: "payments" },
      );
    case COMPLETE_ERROR.TRADE_IN_NO_CUSTOMER:
      return describe(
        "Trade-in needs a customer",
        "Attach the customer again, or remove the trade-in.",
        { fix: "payments", reload: true },
      );
    case COMPLETE_ERROR.NIC_REQUIRED:
      return describe("Trade-in needs the customer's NIC", null, { nic: true });
    case COMPLETE_ERROR.NO_LINES:
    case COMPLETE_ERROR.UNPAID:
      return describe(
        "The sale has changed",
        "It no longer matches what was paid. Check the cart and payments, then complete again.",
        { fix: "cart", reload: true },
      );
    case COMPLETE_ERROR.NETWORK:
    case COMPLETE_ERROR.TIMEOUT:
    case COMPLETE_ERROR.SERVER:
      if (err.unconfirmed) {
        return describe(
          "Couldn't confirm the sale",
          "The connection dropped and the sale's status couldn't be checked. Try again: a sale is never completed twice.",
        );
      }
      return describe(
        "Couldn't complete the sale",
        err.kind === COMPLETE_ERROR.SERVER
          ? `The server had a problem. ${SAFE_RETRY}`
          : `The connection dropped or timed out. ${SAFE_RETRY}`,
      );
    default:
      return describe("Couldn't complete the sale", err.message);
  }
};
