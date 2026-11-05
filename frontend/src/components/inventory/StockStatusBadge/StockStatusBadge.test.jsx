import { render, screen } from "@testing-library/react";
import StockStatusBadge from "./index";

describe("StockStatusBadge", () => {
  it.each([
    ["IN_STOCK", "In stock", "bg-emerald-50"],
    ["LOW_STOCK", "Low stock", "bg-amber-100"],
    ["OUT_OF_STOCK", "Out of stock", "bg-red-100"],
    ["NOT_TRACKED", "Not tracked", "bg-slate-200"],
  ])("shows %s as %s", (status, label, colour) => {
    render(<StockStatusBadge status={status} />);

    expect(screen.getByText(label)).toHaveClass(colour, "whitespace-nowrap");
  });

  it("shows a status it doesn't know as sent, in the neutral colour", () => {
    render(<StockStatusBadge status="LOST" />);

    expect(screen.getByText("LOST")).toHaveClass("bg-slate-200");
  });
});
