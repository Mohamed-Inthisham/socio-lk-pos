import { render, screen, within } from "@testing-library/react";
import ReturnSlip from ".";
import { RECEIPT_FOOTER, RETURN_SLIP_NOTE, RECEIPT_TERMS_TITLE } from "../../../constants/receipt";
import { refundView, returnLineView, saleReturnView, saleWithReturnsEntity } from "../../../test/returnEntities";
import { saleEntity } from "../../../test/saleEntities";

/**
 * The fixture return (returnEntities saleReturnView): the phone to
 * inspection and one case back to stock, 23 Oct 2026 10:40; card
 * 10,000.00 (ref REV-482913) + cash 55,590.00; outside warranty (the case
 * is Checking only); 35,300.00 of it from the trade-in.
 */
const renderSlip = ({ ret = saleReturnView(), copy = "customer", reprintedAt, sale } = {}) => {
  const owner = sale ?? saleWithReturnsEntity([ret]);
  render(<ReturnSlip sale={owner} ret={ret} copy={copy} reprintedAt={reprintedAt} />);
  return screen.getByTestId(`return-slip-${copy}`);
};

describe("ReturnSlip (P7-17)", () => {
  it("the shop header, RETURN / REFUND and which copy", () => {
    const slip = renderSlip();
    expect(within(slip).getByRole("img", { name: "SOCIO.LK" })).toBeInTheDocument();
    expect(slip).toHaveTextContent("CARE THAT STAYS");
    expect(slip).toHaveTextContent("Main Shop");
    expect(slip).toHaveTextContent("RETURN / REFUND");
    expect(within(slip).getByTestId("slip-copy")).toHaveTextContent("CUSTOMER COPY");
  });

  it("the return, the original invoice, who made and approved it, the customer — never the NIC", () => {
    const text = renderSlip().textContent;
    expect(text).toContain("ReturnRET-20261023-0001");
    expect(text).toContain("Date23 Oct 2026, 10:40 AM");
    expect(text).toContain("InvoiceINV-20261021-0007");
    expect(text).toContain("Sold21 Oct 2026, 2:32 PM");
    expect(text).toContain("CashierNimal Silva");
    expect(text).toContain("Approved byAsha Perera");
    expect(text).toContain("CustomerKamal Perera");
    expect(text).toContain("Phone077 123 4567");
    expect(text).not.toContain("199012345678");
  });

  it("each item: its IMEI, quantity × amount, its share and where it goes", () => {
    const slip = renderSlip();
    const [phone, kase] = within(slip).getAllByTestId("slip-line");
    expect(phone.textContent).toBe(
      "Samsung Galaxy A15 128GBIMEI 3567890123456711 × 63,990.0063,990.00For inspection",
    );
    expect(kase.textContent).toBe("Silicone Case A151 × 1,600.001,600.00Back to stock");
  });

  it.each([
    ["DAMAGED", "Damaged"],
    ["NOT_OUR_STOCK", "Not our stock"],
    ["UNTRACKED", "No stock change"],
  ])("%s prints as %s", (disposition, words) => {
    const ret = saleReturnView({ lines: [returnLineView({ sale_line_id: "line-charger", disposition })] });
    expect(within(renderSlip({ ret })).getByTestId("slip-line")).toHaveTextContent(words);
  });

  it("a quantity whose share doesn't split evenly prints Qty", () => {
    // 3 chargers with a 2,900.00 line total: 2 units share 1,933.33
    const sale = saleEntity({
      lines: [saleEntity().lines[2]].map((l) => ({ ...l, quantity: 3, line_total: "2900.00", returned_quantity: 2 })),
    });
    const ret = saleReturnView({
      lines: [returnLineView({ sale_line_id: "line-charger", quantity: 2, refund_share: "1933.33" })],
    });
    expect(within(renderSlip({ ret, sale: { ...sale, returns: [ret] } })).getByTestId("slip-line").textContent).toBe(
      "25W ChargerQty 21,933.33Back to stock",
    );
  });

  it("the refund, how it went back, the trade-in's part, the reason and the outside-warranty approval", () => {
    const slip = renderSlip();
    expect(slip).toHaveTextContent("REFUNDLKR 65,590.00");
    expect(within(slip).queryByTestId("slip-due")).not.toBeInTheDocument();
    expect(within(slip).getByTestId("slip-refunds").textContent).toBe(
      "Card reversal (Ref REV-482913)10,000.00Cash55,590.00",
    );
    expect(within(slip).getByTestId("slip-trade-in")).toHaveTextContent("Includes LKR 35,300.00 from a trade-in");
    expect(slip).toHaveTextContent("Reason: Faulty item — screen flickers");
    expect(within(slip).getByTestId("slip-override")).toHaveTextContent(
      "Outside warranty — approved by Asha Perera: Case split at the seam on day two",
    );
  });

  it("a lowered refund shows what was due", () => {
    const lowered = saleReturnView({ refund_total: "60000.00", refunds: [refundView({ amount: "60000.00" })] });
    expect(within(renderSlip({ ret: lowered })).getByTestId("slip-due")).toHaveTextContent("of LKR 65,590.00 due");
  });

  it("no refund at all says No refund, and the shop copy has no signature", () => {
    const none = saleReturnView({ refund_total: "0.00", refunds: [] });
    const slip = renderSlip({ ret: none, copy: "shop" });
    expect(within(slip).getByTestId("slip-refunds")).toHaveTextContent("No refund");
    expect(within(slip).queryByTestId("slip-signature")).not.toBeInTheDocument();
  });

  it("the footer and the note, not the receipt's terms", () => {
    const slip = renderSlip();
    expect(slip).toHaveTextContent(RECEIPT_FOOTER);
    expect(slip).toHaveTextContent(RETURN_SLIP_NOTE);
    expect(slip).not.toHaveTextContent(RECEIPT_TERMS_TITLE);
  });

  describe("the copies", () => {
    it("the customer copy never has the signature", () => {
      expect(within(renderSlip()).queryByTestId("slip-signature")).not.toBeInTheDocument();
    });

    it("the shop copy has the cash received and a signature line when cash went back", () => {
      const slip = renderSlip({ copy: "shop" });
      expect(within(slip).getByTestId("slip-copy")).toHaveTextContent("SHOP COPY");
      expect(within(slip).getByTestId("slip-signature")).toHaveTextContent(
        "Received LKR 55,590.00 cash.Customer signature",
      );
    });

    it("a card-only refund: the shop copy has no signature", () => {
      const card = saleReturnView({
        refund_total: "10000.00",
        refunds: [refundView({ method: "CARD", amount: "10000.00", reference_number: "REV-1", original_payment_id: "pay-card" })],
      });
      expect(within(renderSlip({ ret: card, copy: "shop" })).queryByTestId("slip-signature")).not.toBeInTheDocument();
    });
  });

  it("a reprint is marked REPRINT with when it was printed; the first print isn't", () => {
    expect(within(renderSlip()).queryByTestId("slip-reprint")).not.toBeInTheDocument();
    const slip = renderSlip({ copy: "shop", reprintedAt: "2026-10-24T03:15:00.000Z" });
    expect(within(slip).getByTestId("slip-reprint")).toHaveTextContent("REPRINT · 24 Oct 2026, 8:45 AM");
  });
});
