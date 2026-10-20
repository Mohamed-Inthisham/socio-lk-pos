import { describeCompleteError } from "./completeErrorCopy";

// The kinds the dialog tests don't reach, and the fallbacks inside each message.
describe("describeCompleteError", () => {
  it("out of stock without the figures or the name still reads as a sentence", () => {
    expect(describeCompleteError({ kind: "out_of_stock", requested: null, available: null })).toMatchObject({
      title: "Not enough stock",
      body: "An item: not enough in stock. Remove or reduce it, or ask a manager to adjust stock.",
      fix: "cart",
    });
  });

  it("a trade-in IMEI conflict without the IMEI leaves it out", () => {
    expect(describeCompleteError({ kind: "trade_in_imei_in_stock", imei: null }).body).toBe(
      "The trade-in phone is already in the shop's stock. Remove the trade-in and check the phone.",
    );
  });

  it("an inactive trade-in product without a name", () => {
    expect(describeCompleteError({ kind: "trade_in_product_inactive", product_name: null }).body).toMatch(
      /^The trade-in's product was deactivated/,
    );
  });

  it("a trade-in without a customer asks to fix the payments and re-reads the sale", () => {
    expect(describeCompleteError({ kind: "trade_in_no_customer" })).toMatchObject({
      title: "Trade-in needs a customer",
      fix: "payments",
      reload: true,
    });
  });

  it("no lines: the sale has changed, re-read it", () => {
    expect(describeCompleteError({ kind: "no_lines" })).toMatchObject({
      title: "The sale has changed",
      fix: "cart",
      reload: true,
    });
  });

  it("a timeout says nothing was saved and allows a retry", () => {
    expect(describeCompleteError({ kind: "timeout" })).toEqual({
      title: "Couldn't complete the sale",
      body: "The connection dropped or timed out. Nothing was saved. Try again.",
      fix: null,
      reload: false,
      nic: false,
    });
  });

  it("missing NIC asks for the NIC form, not a message", () => {
    expect(describeCompleteError({ kind: "nic_required" })).toMatchObject({ nic: true, fix: null, body: null });
  });
});
