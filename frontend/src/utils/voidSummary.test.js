import { voidSummary } from "./voidSummary";
import { paymentEntity, saleEntity, saleLineEntity } from "../test/saleEntities";

describe("voidSummary (P6-10, P6-12)", () => {
  it("the step C sale: 5 items back, one phone back, the trade-in leaves, cash and a card to give back", () => {
    expect(voidSummary(saleEntity())).toEqual({
      restockCount: 5, // 1 phone + 2 cases + 1 charger + 1 cable
      otherShopCount: 0,
      phonesBack: ["356789012345671"],
      tradeInsOut: [{ name: "Used iPhone 12 128GB", imei: "354789102345678" }],
      cashBack: "20290.00", // the amount kept, not the 20,300 received
      referenced: [{ method: "CARD", amount: "10000.00", reference: "AUTH-482913" }],
    });
  });

  it("lines from another shop aren't restocked: counted apart, phones included", () => {
    const sale = saleEntity({
      lines: [
        saleLineEntity({ id: "own", quantity: 2 }),
        saleLineEntity({ id: "theirs", quantity: 3, external_supplier_id: "sup-1" }),
        saleLineEntity({ id: "their-phone", quantity: 1, external_supplier_id: "sup-1", imei_snapshot: "359000000000001", product_unit_id: null }),
      ],
    });

    const s = voidSummary(sale);
    expect(s.restockCount).toBe(2);
    expect(s.otherShopCount).toBe(4);
    expect(s.phonesBack).toEqual([]);
  });

  it("adds up several cash tenders, and lists each referenced tender", () => {
    const sale = saleEntity({
      payments: [
        paymentEntity({ id: "c1", payment_method: "CASH", amount: "1000.00", cash_received: "1000.00" }),
        paymentEntity({ id: "c2", payment_method: "CASH", amount: "500.50", cash_received: "1000.00" }),
        paymentEntity({ id: "b", payment_method: "BANK_TRANSFER", amount: "2000.00", reference_number: "BT-9" }),
        paymentEntity({ id: "k", payment_method: "KOKO", amount: "3000.00", reference_number: "KOKO-1" }),
        paymentEntity({ id: "m", payment_method: "MINTPAY", amount: "4000.00", reference_number: "MP-2" }),
      ],
    });

    const s = voidSummary(sale);
    expect(s.cashBack).toBe("1500.50");
    expect(s.referenced).toEqual([
      { method: "BANK_TRANSFER", amount: "2000.00", reference: "BT-9" },
      { method: "KOKO", amount: "3000.00", reference: "KOKO-1" },
      { method: "MINTPAY", amount: "4000.00", reference: "MP-2" },
    ]);
    expect(s.tradeInsOut).toEqual([]);
  });

  it("no cash means no cash line", () => {
    const sale = saleEntity({
      payments: [paymentEntity({ id: "card", payment_method: "CARD", amount: "70290.00", reference_number: "A1" })],
    });
    expect(voidSummary(sale).cashBack).toBeNull();
  });
});
