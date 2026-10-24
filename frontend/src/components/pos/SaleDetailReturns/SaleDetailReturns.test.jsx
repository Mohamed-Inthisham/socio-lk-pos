import { vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SaleDetailReturns from ".";
import { refundView, returnLineView, saleReturnView, saleWithReturnsEntity } from "../../../test/returnEntities";
import { formatLKR } from "../../../utils/money";

// formatLKR puts a no-break space after LKR; toHaveTextContent folds it to a space.
const lkr = (value) => formatLKR(value).replace(/\s/g, " ");

const lowered = saleReturnView({
  id: "ret-2",
  return_number: "RET-20261024-0001",
  created_at: "2026-10-24T04:05:00.000Z",
  reason: "Changed their mind",
  override_reason: null,
  out_of_warranty: false,
  lines: [returnLineView({ sale_line_id: "line-charger", refund_share: "1600.00", out_of_warranty: false, disposition: "DAMAGED" })],
  refund_due: "1600.00",
  refund_total: "1200.00",
  refunds: [refundView({ amount: "1200.00" })],
});
const noRefund = saleReturnView({
  id: "ret-3",
  return_number: "RET-20261024-0002",
  lines: [returnLineView({ sale_line_id: "line-cable", refund_share: "1500.00", disposition: "UNTRACKED" })],
  refund_due: "1500.00",
  refund_total: "0.00",
  refunds: [],
});

const renderReturns = (props = {}) => {
  const onReprint = vi.fn();
  render(
    <SaleDetailReturns sale={saleWithReturnsEntity([saleReturnView(), lowered, noRefund])} onReprint={onReprint} {...props} />,
  );
  return { onReprint };
};
const entry = (number) => screen.getByRole("listitem", { name: number });

describe("SaleDetailReturns (P7-18)", () => {
  it("lists the returns oldest first, each with its number, time and refund", () => {
    renderReturns();
    const entries = within(screen.getByRole("list", { name: "Returns" })).getAllByTestId("detail-return");
    expect(entries.map((e) => e.getAttribute("aria-label"))).toEqual([
      "RET-20261023-0001",
      "RET-20261024-0001",
      "RET-20261024-0002",
    ]);
    expect(entry("RET-20261023-0001")).toHaveTextContent("RET-20261023-0001 · 23 Oct 2026, 10:40 AM");
    expect(entry("RET-20261023-0001")).toHaveTextContent(`Refund ${lkr("65590.00")}`);
  });

  it("each item and where it went, with the phone's IMEI", () => {
    renderReturns();
    expect(within(entry("RET-20261023-0001")).getByTestId("detail-return-items").textContent).toBe(
      "1 × Samsung Galaxy A15 128GB (IMEI 356789012345671) → for inspection1 × Silicone Case A15 → back to stock",
    );
    expect(within(entry("RET-20261024-0001")).getByTestId("detail-return-items")).toHaveTextContent("1 × 25W Charger → damaged");
    expect(within(entry("RET-20261024-0002")).getByTestId("detail-return-items")).toHaveTextContent(
      "1 × USB-C Cable 1m → no stock change",
    );
  });

  it("how the money went back, the trade-in's part, the reason and who approved", () => {
    renderReturns();
    const first = entry("RET-20261023-0001");
    expect(within(first).getByTestId("detail-return-how")).toHaveTextContent(
      `Card reversal ${lkr("10000.00")} (ref REV-482913) · Cash ${lkr("55590.00")} · includes ${lkr("35300.00")} from a trade-in`,
    );
    expect(first).toHaveTextContent("Reason: Faulty item — screen flickers");
    expect(first).toHaveTextContent("Approved by Asha Perera · requested by Nimal Silva");
  });

  it("a lowered refund shows what was due; no refund says so", () => {
    renderReturns();
    expect(entry("RET-20261024-0001")).toHaveTextContent(`Refund ${lkr("1200.00")} of ${lkr("1600.00")} due`);
    expect(within(entry("RET-20261024-0002")).getByTestId("detail-return-how")).toHaveTextContent("No refund");
  });

  it("the outside-warranty approval only where there was one", () => {
    renderReturns();
    expect(within(entry("RET-20261023-0001")).getByTestId("detail-return-override")).toHaveTextContent(
      "Outside warranty — approved by Asha Perera: Case split at the seam on day two",
    );
    expect(within(entry("RET-20261024-0001")).queryByTestId("detail-return-override")).not.toBeInTheDocument();
  });

  it("Reprint slip asks the page to reprint that return", async () => {
    const user = userEvent.setup();
    const { onReprint } = renderReturns();
    await user.click(within(entry("RET-20261024-0001")).getByRole("button", { name: "Reprint slip" }));
    expect(onReprint).toHaveBeenCalledWith("ret-2");
  });

  it("while one prints, every Reprint slip is disabled; a failed reprint says so on its return", () => {
    renderReturns({ reprinting: "ret-2", disabled: true, errors: { "ret-2": "Couldn't print the slip. Try again." } });
    for (const button of screen.getAllByRole("button", { name: /Reprint slip/ })) expect(button).toBeDisabled();
    expect(within(entry("RET-20261024-0001")).getByRole("alert")).toHaveTextContent("Couldn't print the slip. Try again.");
    expect(within(entry("RET-20261023-0001")).queryByRole("alert")).not.toBeInTheDocument();
  });
});
