import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SaleDetailView from ".";
import { returnLineView, saleReturnView, saleWithReturnsEntity } from "../../../test/returnEntities";
import { formatLKR } from "../../../utils/money";
import {
  paymentEntity,
  saleEntity,
  saleLineEntity,
  userEntity,
  voidedSaleEntity,
} from "../../../test/saleEntities";

const TODAY = "2026-10-22";

const renderView = (sale, today = TODAY) =>
  render(<SaleDetailView sale={sale} today={today} onBack={() => {}} actions={<button type="button">Reprint receipt</button>} />);

const line = (name) => screen.getByRole("listitem", { name });
const tender = (name) => within(screen.getByRole("list", { name: "Tenders" })).getByRole("listitem", { name });
const banner = () => screen.queryByRole("region", { name: "Voided" });
// formatLKR puts a no-break space after LKR; toHaveTextContent folds it to a space.
const lkr = (value) => formatLKR(value).replace(/\s/g, " ");

describe("SaleDetailView: header (P6-6)", () => {
  it("shows the sale number, Completed, the completion time, cashier, and the customer's name and phone", () => {
    renderView(saleEntity());

    expect(screen.getByRole("heading", { name: "INV-20261021-0007" })).toBeInTheDocument();
    expect(screen.getByText("Completed", { selector: "span" })).toBeInTheDocument();
    const meta = screen.getByTestId("detail-meta");
    expect(meta).toHaveTextContent("21 Oct 2026, 14:32");
    expect(meta).toHaveTextContent("Nimal Silva");
    expect(meta).toHaveTextContent("Kamal Perera · 077 123 4567");
  });

  it("never shows the customer's NIC", () => {
    const { container } = renderView(saleEntity());
    expect(container.textContent).not.toContain("199012345678");
  });

  it("shows Walk-in when there is no customer", () => {
    renderView(saleEntity({ customer_id: null, customer: null }));
    expect(screen.getByTestId("detail-meta")).toHaveTextContent("Walk-in");
  });

  it("shows no voided banner on a completed sale", () => {
    renderView(saleEntity());
    expect(banner()).not.toBeInTheDocument();
  });
});

describe("SaleDetailView: lines", () => {
  it("shows each line's total, qty × price, IMEI and warranty with its last day", () => {
    renderView(saleEntity());

    const phone = line("Samsung Galaxy A15 128GB");
    expect(phone).toHaveTextContent("63,990.00");
    expect(phone).toHaveTextContent("1 × 64,990.00");
    expect(phone).toHaveTextContent("IMEI 356789012345671");
    expect(phone).toHaveTextContent("12 months · until 21 Oct 2027");
    expect(within(phone).queryByText("Expired")).not.toBeInTheDocument();
    expect(screen.getByText("Items · 5")).toBeInTheDocument();
  });

  it("labels each discount as the receipt does", () => {
    renderView(saleEntity());

    expect(line("Samsung Galaxy A15 128GB")).toHaveTextContent("Discount −1,000.00");
    expect(line("Silicone Case A15")).toHaveTextContent("2 × 2,000.00 · Discount (20%) −800.00");
    expect(line("25W Charger")).toHaveTextContent("Discount (1,600.00 each) −400.00");
    expect(line("USB-C Cable 1m")).not.toHaveTextContent("Discount");
  });

  it("shows Checking only, and No warranty (which the receipt leaves out)", () => {
    renderView(saleEntity());

    expect(line("Silicone Case A15")).toHaveTextContent("Checking only");
    expect(within(line("USB-C Cable 1m")).getByText("No warranty")).toBeInTheDocument();
  });

  it("tags a warranty Expired once its last day has passed, not on the day", () => {
    const sale = saleEntity({
      lines: [saleLineEntity({ id: "l-old", product_name_snapshot: "Old charger", warranty: "MONTH_1", warranty_until: "2026-10-21" })],
    });
    const { unmount } = renderView(sale, "2026-10-21");
    expect(within(line("Old charger")).queryByText("Expired")).not.toBeInTheDocument();
    unmount();

    renderView(sale, "2026-10-22");
    expect(within(line("Old charger")).getByText("Expired")).toBeInTheDocument();
  });
});

describe("SaleDetailView: tenders and totals", () => {
  it("shows the card's reference and the cash received and change", () => {
    renderView(saleEntity());

    expect(tender("Card")).toHaveTextContent("10,000.00");
    expect(tender("Card")).toHaveTextContent("Ref AUTH-482913");
    expect(tender("Cash")).toHaveTextContent("Received 20,300.00 · Change 10.00");
  });

  it("shows the trade-in phone, IMEI, value, resale price and notes", () => {
    renderView(saleEntity());

    const tradeIn = tender("Trade-in");
    expect(tradeIn).toHaveTextContent("Used iPhone 12 128GB · IMEI 354789102345678");
    expect(tradeIn).toHaveTextContent("Trade-in value 40,000.00 · Resale 52,000.00");
    expect(tradeIn).toHaveTextContent("Notes: Screen scratch, battery 86%");
  });

  it("leaves out the resale price and notes when the trade-in had none", () => {
    renderView(
      saleEntity({
        payments: [
          paymentEntity({
            id: "ti-bare", payment_method: "TRADE_IN", amount: "40000.00",
            trade_in_product_id: "p-used-ip12", trade_in_imei: "354789102345678", trade_in_buying_price: "40000.00",
          }),
        ],
      }),
    );

    const tradeIn = tender("Trade-in");
    expect(tradeIn).toHaveTextContent("Trade-in value 40,000.00");
    expect(tradeIn).not.toHaveTextContent("Resale");
    expect(tradeIn).not.toHaveTextContent("Notes");
  });

  it("shows subtotal, discount, total, paid and change", () => {
    renderView(saleEntity());

    const totals = within(screen.getByLabelText("Totals"));
    expect(totals.getByText("Subtotal").nextSibling).toHaveTextContent(/72,490\.00/);
    expect(totals.getByText("Discount").nextSibling).toHaveTextContent(/−LKR\s2,200\.00/);
    expect(totals.getByText("Total").nextSibling).toHaveTextContent(/70,290\.00/);
    expect(totals.getByText("Paid").nextSibling).toHaveTextContent(/70,290\.00/);
    expect(totals.getByText("Change").nextSibling).toHaveTextContent(/10\.00/);
  });

  it("gives the totals and actions their own region at the bottom of the right column, not sticky", () => {
    renderView(saleEntity());

    const side = screen.getByRole("complementary", { name: "Payment" });
    const dock = screen.getByTestId("detail-actions");
    expect(side.lastElementChild).toBe(dock);
    expect(dock).toHaveClass("shrink-0", "lg:mt-auto");
    expect(dock).not.toHaveClass("lg:sticky");
    expect(side).not.toHaveClass("lg:overflow-y-auto"); // the column itself never scrolls
    expect(within(dock).getByLabelText("Totals")).toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: "Reprint receipt" })).toBeInTheDocument();
    expect(within(dock).queryByRole("list", { name: "Tenders" })).not.toBeInTheDocument();
  });

  it("scrolls the tenders inside their own card, above the totals, each list with a fade", () => {
    renderView(saleEntity());

    const tenders = screen.getByTestId("detail-tenders-scroll");
    expect(tenders).toContainElement(screen.getByRole("list", { name: "Tenders" }));
    expect(tenders).toHaveClass("lg:overflow-y-auto", "lg:min-h-0");
    expect(screen.getByTestId("detail-actions")).not.toContainElement(tenders);
    expect(screen.getByTestId("detail-tenders-scroll-fade")).toBeInTheDocument();
    expect(screen.getByTestId("detail-lines-scroll")).toContainElement(screen.getByRole("list", { name: "Items" }));
    expect(screen.getByTestId("detail-lines-scroll-fade")).toBeInTheDocument();
  });
});

describe("SaleDetailView: a voided sale (P6-6, P6-17)", () => {
  it("shows the Voided badge and a banner with when, why and who approved it", () => {
    renderView(voidedSaleEntity());

    expect(screen.getAllByText("Voided", { selector: "span" }).length).toBeGreaterThan(0);
    expect(banner()).toHaveTextContent("Voided 22 Oct 2026, 10:15 — Wrong price — rang 64,990, was 59,990");
    expect(banner()).toHaveTextContent("Approved by Asha Perera · requested on Nimal Silva's session");
  });

  it("doesn't name the session when the approver voided on their own session", () => {
    const manager = userEntity({ id: "user-manager", full_name: "Asha Perera", role: "manager" });
    renderView(voidedSaleEntity({ void_requested_by: "user-manager", void_requester: manager }));

    expect(banner()).toHaveTextContent("Approved by Asha Perera");
    expect(banner()).not.toHaveTextContent("requested on");
  });

  it("tags every reversed payment Reversed", () => {
    renderView(voidedSaleEntity());

    for (const name of ["Trade-in", "Card", "Cash"]) {
      expect(within(tender(name)).getByText("Reversed")).toBeInTheDocument();
    }
  });

  it("doesn't tag payments on a completed sale", () => {
    renderView(saleEntity());
    expect(screen.queryByText("Reversed")).not.toBeInTheDocument();
  });
});

describe("SaleDetailView: returns (P7-18)", () => {
  const BADGE = /^(Completed|Part returned|Returned|Voided)$/;
  const header = () => screen.getByRole("heading", { level: 1 }).parentElement;
  const allBack = () =>
    saleWithReturnsEntity(
      [saleReturnView()],
      { lines: saleEntity().lines.map((l) => ({ ...l, returned_quantity: l.quantity })) },
    );

  it("the header: Completed, and Part returned or Returned next to it", () => {
    renderView(saleWithReturnsEntity());
    expect(within(header()).getAllByText(BADGE).map((b) => b.textContent)).toEqual(["Completed", "Part returned"]);
  });

  it("a sale with every unit back reads Returned; one with none, Completed alone", () => {
    const { unmount } = renderView(allBack());
    expect(within(header()).getAllByText(BADGE).map((b) => b.textContent)).toEqual(["Completed", "Returned"]);
    unmount();
    renderView(saleEntity());
    expect(within(header()).getAllByText(BADGE).map((b) => b.textContent)).toEqual(["Completed"]);
  });

  it("Returned N of M sits on the line's qty × price row; all back reads Returned", () => {
    renderView(saleWithReturnsEntity());
    const kase = line("Silicone Case A15");
    const tag = within(kase).getByTestId("detail-line-returned");
    expect(tag).toHaveTextContent("Returned 1 of 2");
    // the same row as "2 × 2,000.00", not a row of its own
    expect(tag.parentElement).toHaveTextContent(/^2 × 2,000\.00/);
    expect(within(line("Samsung Galaxy A15 128GB")).getByTestId("detail-line-returned")).toHaveTextContent(/^Returned$/);
    expect(within(line("25W Charger")).queryByTestId("detail-line-returned")).not.toBeInTheDocument();
  });

  it("the totals keep the sale's own figures and add what was refunded", () => {
    renderView(saleWithReturnsEntity());
    const totals = screen.getByLabelText("Totals");
    expect(totals).toHaveTextContent(`Total${lkr("70290.00")}`);
    expect(totals).toHaveTextContent(`Refunded${lkr("65590.00")}`);
  });

  it("no returns: no tabs, the card reads Items as before", () => {
    renderView(saleEntity());
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("Items · 5")).toBeInTheDocument();
  });

  it("with returns: two tabs, Items first; arrow keys move between them", async () => {
    const user = userEvent.setup();
    renderView(saleWithReturnsEntity());
    const items = screen.getByRole("tab", { name: "Items · 5" });
    const returns = screen.getByRole("tab", { name: "Returns · 1" });
    expect(items).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("list", { name: "Items" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Returns" })).not.toBeInTheDocument();

    items.focus();
    await user.keyboard("{ArrowRight}");
    expect(returns).toHaveAttribute("aria-selected", "true");
    expect(returns).toHaveFocus();
    expect(screen.getByRole("list", { name: "Returns" })).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(items).toHaveAttribute("aria-selected", "true");
  });

  it("opens on Returns when asked (a RET-number search)", () => {
    render(
      <SaleDetailView sale={saleWithReturnsEntity()} today={TODAY} onBack={() => {}} actions={null} initialTab="returns" />,
    );
    expect(screen.getByRole("tab", { name: "Returns · 1" })).toHaveAttribute("aria-selected", "true");
  });

  it("stays on its tab when the sale changes (a return made on the page); the count updates", async () => {
    const user = userEvent.setup();
    const props = { today: TODAY, onBack: () => {}, actions: null };
    const { rerender } = render(<SaleDetailView sale={saleWithReturnsEntity()} {...props} />);
    await user.click(screen.getByRole("tab", { name: "Returns · 1" }));

    const second = saleReturnView({
      id: "ret-2",
      return_number: "RET-20261024-0001",
      lines: [returnLineView({ sale_line_id: "line-charger", refund_share: "1600.00" })],
    });
    rerender(<SaleDetailView sale={saleWithReturnsEntity([saleReturnView(), second])} {...props} />);
    expect(screen.getByRole("tab", { name: "Returns · 2" })).toHaveAttribute("aria-selected", "true");
  });
});
