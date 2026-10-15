import { screen } from "@testing-library/react";
import TotalsPanel from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import { draftSale, saleLine } from "../../../test/posFixtures";

const renderTotals = (sale, overrides = {}) =>
  renderWithProviders(<TotalsPanel />, {
    preloadedState: { posTerminal: posTerminalState({ draftSale: sale, ...overrides }) },
  });

describe("TotalsPanel", () => {
  it("shows the server's subtotal, discount and total without recomputing", () => {
    // Deliberately inconsistent with the line: the panel must echo the
    // server's sale-level fields, not sum the lines itself.
    renderTotals(
      draftSale({
        lines: [saleLine({ line_total: "1500.00" })],
        subtotal: "64490.00",
        discount_total: "0.00",
        tax_total: "0.00",
        total: "64490.00",
      }),
    );

    expect(screen.getByTestId("totals-subtotal")).toHaveTextContent("64,490.00");
    expect(screen.getByTestId("totals-discount")).toHaveTextContent(/−.*0\.00/);
    expect(screen.getByTestId("totals-total")).toHaveTextContent("64,490.00");
    expect(screen.queryByTestId("totals-tax")).not.toBeInTheDocument();
  });

  it("marks the totals as updating while a line change is in flight", () => {
    renderTotals(draftSale({ total: "1500.00", subtotal: "1500.00" }), {
      pendingLines: [{ id: "pending-1", product_id: "p", product_name_snapshot: "X", quantity: 1, unit_price: "10.00", imei_snapshot: null, line_total: null }],
    });

    expect(screen.getByRole("region", { name: "Sale totals" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Updating…")).toBeInTheDocument();
  });
});
