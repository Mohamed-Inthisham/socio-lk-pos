import { render, screen, within } from "@testing-library/react";
import Receipt from ".";
import { completedSaleForReceipt, completedSaleWithDiscounts } from "../../../test/posFixtures";

const receipt = () => screen.getByTestId("receipt");
const text = () => receipt().textContent;

describe("Receipt (P5-11, P5-18)", () => {
  it("prints the logo instead of the shop name, then the branch", () => {
    render(<Receipt sale={completedSaleForReceipt()} />);

    expect(within(receipt()).getByRole("img", { name: "SOCIO.LK" })).toBeInTheDocument();
    // The tagline is real text under the logo (cropped out of the image)
    expect(screen.getByTestId("receipt-tagline")).toHaveTextContent("CARE THAT STAYS");
    expect(text()).toContain("Main Shop");
    expect(text()).toContain("86/10 Inner Circular Rd, Ratnapura");
    expect(text()).toContain("Tel 077 882 2391");
  });

  it("prints the invoice number, Colombo date and time, cashier, and the customer's full name and phone — never the NIC", () => {
    render(<Receipt sale={completedSaleForReceipt()} />);

    expect(text()).toContain("InvoiceINV-20261021-0007");
    expect(text()).toContain("Date21 Oct 2026, 14:32");
    expect(text()).toContain("CashierNimal Silva");
    expect(text()).toContain("CustomerKamal Perera");
    expect(text()).toContain("Phone077 123 4567");
    expect(text()).not.toContain("199012345678");
  });

  it("prints each line with IMEI, qty × price, discount and its warranty", () => {
    render(<Receipt sale={completedSaleForReceipt()} />);
    const [phone, cable] = screen.getAllByTestId("receipt-line");

    expect(phone.textContent).toBe(
      "Samsung Galaxy A15 128GB" +
        "IMEI 356789012345671" +
        "1 × 64,990.0064,990.00" +
        "Discount-1,000.00" +
        "Warranty: 12 months (until 21 Oct 2027)",
    );
    expect(cable.textContent).toBe(
      "USB-C Cable 1m" + "2 × 1,500.003,000.00" + "Checking only",
    );
  });

  it("words each discount by its kind, and prints no warranty text for No warranty (P5-19, P5-20)", () => {
    render(<Receipt sale={completedSaleWithDiscounts()} />);
    const [case_, charger, cable, glass] = screen.getAllByTestId("receipt-line");

    expect(case_.textContent).toBe(
      "Silicone Case A15" + "2 × 2,000.004,000.00" + "Discount (20%)-800.00" + "Checking only",
    );
    expect(charger.textContent).toBe(
      "25W Charger" + "2 × 2,000.004,000.00" + "Discount (1,600.00 each)-800.00" + "Warranty: 6 months (until 21 Apr 2027)",
    );
    // NO_WARRANTY: nothing under the price
    expect(cable.textContent).toBe("USB-C Cable 1m" + "1 × 1,500.001,500.00");
    expect(glass.textContent).toBe("Tempered Glass A15" + "1 × 1,000.001,000.00" + "Checking only");
    expect(text()).toContain("Discount-1,600.00");
  });

  it("leaves out the totals' Discount row when nothing was discounted", () => {
    render(
      <Receipt
        sale={completedSaleWithDiscounts({
          subtotal: "1500.00",
          discount_total: "0.00",
          total: "1500.00",
          lines: [completedSaleWithDiscounts().lines[2]],
        })}
      />,
    );

    expect(text()).not.toContain("Discount");
  });

  it("prints the totals", () => {
    render(<Receipt sale={completedSaleForReceipt()} />);

    expect(text()).toContain("Subtotal67,990.00");
    expect(text()).toContain("Discount-1,000.00");
    expect(text()).toContain("TOTALLKR 66,990.00");
  });

  it("prints each tender: the trade-in phone and IMEI, the card reference, cash received and change", () => {
    render(<Receipt sale={completedSaleForReceipt()} />);
    const [tradeIn, card, cash] = screen.getAllByTestId("receipt-payment");

    expect(tradeIn.textContent).toBe("Trade-in40,000.00Used iPhone 12 128GB · IMEI 354789102345678");
    expect(card.textContent).toBe("Card (Ref AUTH-482913)10,000.00");
    expect(cash.textContent).toBe("Cash16,990.00Cash received17,000.00Change10.00");
  });

  it("prints the terms and the footer on every receipt", () => {
    render(<Receipt sale={completedSaleForReceipt({ customer: null })} />);
    const terms = screen.getByTestId("receipt-terms");

    expect(terms).toHaveTextContent("TERMS & CONDITIONS (T&C)");
    // Numbered 1. 2. 3. (the app's base styles strip list numbers)
    expect(within(terms).getByRole("list")).toHaveStyle({ listStyleType: "decimal" });
    const items = within(terms).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "Exchanges & Warranty: The original bill is required for all exchanges and warranty claims.",
      "Repair Collection: Repaired devices must be collected within 14 days of notification. The shop is not responsible for items left uncollected after this period.",
      "Warranty Exclusions: Warranty does not cover physical damage, liquid damage, misuse, or unauthorized repairs.",
    ]);
    expect(text()).toMatch(/Thank you for choosing Care That Stays$/);
  });

  it("leaves out what a walk-in sale or a branch doesn't have", () => {
    render(
      <Receipt
        sale={completedSaleForReceipt({
          customer: null,
          discount_total: "0.00",
          branch: { id: "b", name: "Main Shop", address: null, phone: null },
          payments: [{ id: "p", payment_method: "CASH", amount: "66990.00", cash_received: "66990.00" }],
        })}
      />,
    );

    expect(text()).not.toContain("Customer");
    expect(text()).not.toContain("Tel ");
    expect(text()).not.toMatch(/Subtotal67,990\.00Discount/);
    expect(screen.getByTestId("receipt-payment").textContent).toBe("Cash66,990.00Cash received66,990.00");
  });
});
