import { render, screen } from "@testing-library/react";
import UnitStatusBadge from "./index";

describe("UnitStatusBadge", () => {
  it.each([
    ["IN_STOCK", "In stock", "bg-emerald-50"],
    ["SOLD", "Sold", "bg-slate-200"],
    ["INSPECTION", "Inspection", "bg-amber-100"],
    ["RETURNED", "Back with customer", "bg-cyan-100"],
    ["WRITTEN_OFF", "Written off", "bg-red-100"],
  ])("shows %s as %s", (status, label, colour) => {
    render(<UnitStatusBadge status={status} />);

    expect(screen.getByText(label)).toHaveClass(colour, "whitespace-nowrap");
  });

  it("shows a status it doesn't know as sent, in the neutral colour", () => {
    render(<UnitStatusBadge status="LOST" />);

    expect(screen.getByText("LOST")).toHaveClass("bg-slate-200");
  });
});
