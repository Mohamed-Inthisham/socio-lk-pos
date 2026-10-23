import {
  daysSinceSale,
  lineDisposition,
  lineWarrantyStatus,
  refundDueCents,
  refundShareCents,
  refundedCents,
  returnableQuantity,
  saleRefundContext,
  saleReturnState,
  saleTradeInShareCents,
  selectionOutsideWarranty,
  tradeInShareCents,
} from "./returnMath";
import { colomboToday } from "./colomboDay";
import { paymentEntity, saleEntity, saleLineEntity } from "../test/saleEntities";
import { refundView, returnLineView, saleReturnView, saleWithReturnsEntity } from "../test/returnEntities";

// ---------------------------------------------------------------------------
// The server's cases, copied verbatim from backend/src/sales/return-math.spec.ts
// (P7-3, P7-5). Keep them identical: change them only together with it.
// ---------------------------------------------------------------------------

describe('refundShareCents (P7-3)', () => {
  // 3 × 1000.00 with 100.00 off: line_total 2900.00.
  const L = 290000;

  it('shares a discounted line one unit at a time, adding up to the line total', () => {
    const first = refundShareCents(L, 3, 0, 1);
    const second = refundShareCents(L, 3, 1, 1);
    const third = refundShareCents(L, 3, 2, 1);

    expect([first, second, third]).toEqual([96667, 96666, 96667]);
    expect(first + second + third).toBe(L);
  });

  it('two units then one gives the same total', () => {
    const two = refundShareCents(L, 3, 0, 2);
    const last = refundShareCents(L, 3, 2, 1);

    expect(two).toBe(193333);
    expect(last).toBe(96667);
    expect(two + last).toBe(L);
  });

  it('the whole line at once is the line total', () => {
    expect(refundShareCents(L, 3, 0, 3)).toBe(L);
  });

  it('rounds an exact half-cent up', () => {
    // 10.01 over 2 units: 5.005 → 5.01, then 5.00.
    expect(refundShareCents(1001, 2, 0, 1)).toBe(501);
    expect(refundShareCents(1001, 2, 1, 1)).toBe(500);
  });

  it('a free line shares nothing', () => {
    expect(refundShareCents(0, 4, 1, 2)).toBe(0);
  });

  it('stays exact beyond 2^53', () => {
    // 9,999,999,999.99 (the numeric(12,2) maximum) over 7 units.
    const big = 999999999999;
    let sum = 0;
    for (let r = 0; r < 7; r++) sum += refundShareCents(big, 7, r, 1);
    expect(sum).toBe(big);
  });

  it('every way of splitting a line adds up to its total', () => {
    const totals = [1, 99, 1001, 290000, 333333, 1234567];
    for (const total of totals) {
      for (let q = 1; q <= 7; q++) {
        // Return in chunks of 1, 2, … and check the sum each time.
        for (let chunk = 1; chunk <= q; chunk++) {
          let r = 0;
          let sum = 0;
          while (r < q) {
            const k = Math.min(chunk, q - r);
            const share = refundShareCents(total, q, r, k);
            expect(share).toBeGreaterThanOrEqual(0);
            sum += share;
            r += k;
          }
          expect(sum).toBe(total);
        }
      }
    }
  });
});

describe('tradeInShareCents (P7-5)', () => {
  it('a full cash refund of a trade-in sale includes the trade-in value', () => {
    // Total 50,000: TRADE_IN 30,000 + CASH 20,000; refund 50,000 in cash.
    expect(tradeInShareCents(5000000, 2000000, 0)).toBe(3000000);
  });

  it('is 0 while the non-trade-in money covers the refund', () => {
    expect(tradeInShareCents(1500000, 2000000, 0)).toBe(0);
  });

  it('counts earlier refunds against the non-trade-in money', () => {
    // 15,000 refunded before; 20,000 more now: 15,000 of it is trade-in.
    expect(tradeInShareCents(2000000, 2000000, 1500000)).toBe(1500000);
  });

  it('earlier refunds above the non-trade-in money: never more than the refund', () => {
    // 65,590 refunded before against 30,290 non-trade-in; 1,600 more now:
    // all of it is trade-in money (1,600), not 1,600 − (30,290 − 65,590).
    expect(tradeInShareCents(160000, 3029000, 6559000)).toBe(160000);
  });
});

// ---------------------------------------------------------------------------
// The till's own: the figures worked out from a hydrated sale.
// ---------------------------------------------------------------------------

// saleEntity: phone 63,990 (12 months, until 2027-10-21), 2 cases 3,200
// (Checking), charger 1,600 (6 months, until 2027-04-21), cable 1,500 (No
// warranty). Paid: trade-in 40,000 + card 10,000 + cash 20,290.
const RETURN_DAY = "2026-10-23";

describe("returnableQuantity", () => {
  it("is what is left of the line", () => {
    expect(returnableQuantity(saleLineEntity({ quantity: 3, returned_quantity: 1 }))).toBe(2);
    expect(returnableQuantity(saleLineEntity({ quantity: 2, returned_quantity: 2 }))).toBe(0);
  });
});

describe("saleReturnState and refundedCents (P7-18)", () => {
  it("NONE, PARTIAL and FULL by returned units, as the list's return_state", () => {
    expect(saleReturnState(saleEntity())).toBe("NONE");
    expect(saleReturnState(saleWithReturnsEntity())).toBe("PARTIAL");
    const all = saleEntity({ lines: saleEntity().lines.map((l) => ({ ...l, returned_quantity: l.quantity })) });
    expect(saleReturnState(all)).toBe("FULL");
  });

  it("refundedCents sums what went back, not what was due", () => {
    expect(refundedCents(saleEntity())).toBe(0);
    const lowered = saleReturnView({ id: "ret-2", refund_due: "1600.00", refund_total: "1000.00" });
    expect(refundedCents(saleWithReturnsEntity([saleReturnView(), lowered]))).toBe(6659000);
  });
});

describe("refundDueCents (P7-3)", () => {
  it("sums the selected lines’ shares, skipping lines left at 0", () => {
    const sale = saleEntity();
    // 63,990.00 + half of 3,200.00
    expect(refundDueCents(sale, { "line-phone": 1, "line-case": 1, "line-cable": 0 })).toBe(6559000);
  });

  it("follows what each line already returned, as the server does", () => {
    const sale = saleEntity({
      lines: [saleLineEntity({ id: "line-ch", quantity: 3, returned_quantity: 1, line_total: "2900.00" })],
    });
    expect(refundDueCents(sale, { "line-ch": 1 })).toBe(96666);
    expect(refundDueCents(sale, { "line-ch": 2 })).toBe(193333);
  });

  it("nothing selected is nothing due", () => {
    expect(refundDueCents(saleEntity(), {})).toBe(0);
  });
});

describe("saleRefundContext (P7-4, P7-5)", () => {
  it("a sale without returns: each non-cash payment can take its whole amount back", () => {
    expect(saleRefundContext(saleEntity())).toEqual({
      payments: [
        {
          id: "pay-card",
          method: "CARD",
          reference_number: "AUTH-482913",
          amountCents: 1000000,
          refundedCents: 0,
          refundableCents: 1000000,
        },
      ],
      nonTradeInPaidCents: 3029000,
      earlierRefundsCents: 0,
    });
  });

  it("caps each payment by every earlier refund to it, across returns", () => {
    const first = saleReturnView({
      id: "ret-1",
      lines: [returnLineView({ sale_line_id: "line-case", refund_share: "1600.00" })],
      refund_due: "1600.00",
      refund_total: "1600.00",
      refunds: [refundView({ method: "CARD", amount: "1000.00", reference_number: "REV-1", original_payment_id: "pay-card" }), refundView({ amount: "600.00" })],
    });
    const second = saleReturnView({
      id: "ret-2",
      return_number: "RET-20261023-0002",
      lines: [returnLineView({ sale_line_id: "line-charger", refund_share: "1600.00", out_of_warranty: false })],
      out_of_warranty: false,
      override_reason: null,
      refund_due: "1600.00",
      refund_total: "1500.00",
      refunds: [refundView({ method: "CARD", amount: "1500.00", reference_number: "REV-2", original_payment_id: "pay-card" })],
    });
    const context = saleRefundContext(saleWithReturnsEntity([first, second]));

    expect(context.payments).toEqual([
      expect.objectContaining({ id: "pay-card", refundedCents: 250000, refundableCents: 750000 }),
    ]);
    // refund_total, not refund_due: a lowered refund counts as what went back
    expect(context.earlierRefundsCents).toBe(310000);
  });

  it("lists every non-cash, non-trade-in payment and never cash or a trade-in", () => {
    const sale = saleEntity({
      payments: [
        paymentEntity({ id: "p-cash", payment_method: "CASH", amount: "100.00" }),
        paymentEntity({ id: "p-ti", payment_method: "TRADE_IN", amount: "200.00" }),
        paymentEntity({ id: "p-bank", payment_method: "BANK_TRANSFER", amount: "300.00", reference_number: "BT-1" }),
        paymentEntity({ id: "p-koko", payment_method: "KOKO", amount: "400.00", reference_number: "K-1" }),
        paymentEntity({ id: "p-mint", payment_method: "MINTPAY", amount: "500.00", reference_number: "M-1" }),
      ],
    });
    const context = saleRefundContext(sale);

    expect(context.payments.map((p) => [p.id, p.method])).toEqual([
      ["p-bank", "BANK_TRANSFER"],
      ["p-koko", "KOKO"],
      ["p-mint", "MINTPAY"],
    ]);
    expect(context.nonTradeInPaidCents).toBe(130000);
  });
});

describe("saleTradeInShareCents (P7-5)", () => {
  it("the fixture return: 65,590.00 refunded of a sale with 30,290.00 non-trade-in money", () => {
    expect(saleTradeInShareCents(saleEntity(), 6559000)).toBe(3530000);
  });

  it("counts the earlier returns’ refunds, and is never more than the refund", () => {
    // 65,590.00 went back before, more than the 30,290.00 non-trade-in
    // money: all of a further 1,600.00 is trade-in money (the server's
    // tradeInShareCents caps it at the refund, as the copied case above).
    expect(saleTradeInShareCents(saleWithReturnsEntity(), 160000)).toBe(160000);
  });

  it("is 0 while the non-trade-in money covers it", () => {
    expect(saleTradeInShareCents(saleEntity(), 3029000)).toBe(0);
  });
});

describe("lineDisposition (returns.md: where items go)", () => {
  it.each([
    ["another shop’s line", { external_supplier_id: "sup-1" }, true, "NOT_OUR_STOCK"],
    ["another shop’s phone (it has no unit of ours)", { external_supplier_id: "sup-1", imei_snapshot: "356789012345671" }, true, "NOT_OUR_STOCK"],
    ["a phone from our stock", { product_unit_id: "unit-a15", imei_snapshot: "356789012345671" }, true, "INSPECTION"],
    ["a product without stock tracking", {}, false, "UNTRACKED"],
    ["a tracked item: the cashier picks the condition", {}, true, null],
  ])("%s", (_, overrides, stockTracked, expected) => {
    expect(lineDisposition(saleLineEntity(overrides), { stockTracked })).toBe(expected);
  });
});

describe("lineWarrantyStatus (P7-22)", () => {
  const phone = saleEntity().lines[0]; // until 2027-10-21

  it("within warranty up to and including its last day", () => {
    expect(lineWarrantyStatus(phone, RETURN_DAY)).toEqual({
      kind: "within",
      outside: false,
      label: "Within warranty until 21 Oct 2027",
    });
    expect(lineWarrantyStatus(phone, "2027-10-21").kind).toBe("within");
  });

  it("expired from the day after", () => {
    expect(lineWarrantyStatus(phone, "2027-10-22")).toEqual({
      kind: "expired",
      outside: true,
      label: "Warranty expired on 21 Oct 2027",
    });
  });

  it("Checking only and No warranty are outside from the day of sale", () => {
    const [, cases, , cable] = saleEntity().lines;
    expect(lineWarrantyStatus(cases, "2026-10-21")).toEqual({
      kind: "checking",
      outside: true,
      label: "Checking only — outside warranty",
    });
    expect(lineWarrantyStatus(cable, "2026-10-21")).toEqual({
      kind: "none",
      outside: true,
      label: "No warranty — outside warranty",
    });
  });

  it("defaults to today in Colombo: 23:59 is still the last day, 00:00 is the next", () => {
    const line = saleLineEntity({ warranty: "MONTH_1", warranty_until: "2026-10-23" });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-23T18:29:00.000Z")); // 23:59 Colombo
      expect(lineWarrantyStatus(line).kind).toBe("within");
      vi.setSystemTime(new Date("2026-10-23T18:30:00.000Z")); // 00:00 Colombo, 24 Oct
      expect(colomboToday()).toBe("2026-10-24");
      expect(lineWarrantyStatus(line).kind).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("selectionOutsideWarranty (P7-23)", () => {
  it("names the selected lines outside warranty, in line order", () => {
    const sale = saleEntity();
    expect(
      selectionOutsideWarranty(sale, { "line-cable": 1, "line-phone": 1, "line-case": 2, "line-charger": 0 }, RETURN_DAY),
    ).toEqual(["line-case", "line-cable"]);
  });

  it("none when every selected line is within warranty", () => {
    expect(selectionOutsideWarranty(saleEntity(), { "line-phone": 1, "line-charger": 1 }, RETURN_DAY)).toEqual([]);
  });
});

describe("daysSinceSale (P7-20)", () => {
  it("counts Colombo days from the completion", () => {
    const sale = saleEntity(); // completed 21 Oct 2026, 14:32 Colombo
    expect(daysSinceSale(sale, "2026-10-21")).toBe(0);
    expect(daysSinceSale(sale, RETURN_DAY)).toBe(2);
  });

  it("a sale completed late at night counts from its Colombo date", () => {
    // 20 Oct 2026, 23:50 Colombo is 18:20 UTC
    const sale = saleEntity({ completed_at: "2026-10-20T18:20:00.000Z" });
    expect(daysSinceSale(sale, "2026-10-21")).toBe(1);
  });
});
