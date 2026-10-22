import { vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Table from ".";

const columns = [
  { key: "name", header: "Name", primary: true },
  { key: "total", header: "Total", align: "right" },
];
const data = [
  { id: "a", name: "First", total: "10" },
  { id: "b", name: "Second", total: "20" },
];

const desktop = () => screen.getByRole("table").parentElement;
const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

describe("Table", () => {
  it("renders as before without the optional props: no selection, no inner scroll, standard padding", () => {
    render(<Table columns={columns} data={data} />);

    expect(desktop()).toHaveClass("hidden", "md:block", "overflow-hidden");
    expect(desktop()).not.toHaveClass("overflow-y-auto");
    expect(rows()[0]).not.toHaveAttribute("aria-selected");
    expect(within(rows()[0]).getAllByRole("cell")[0]).toHaveClass("py-3.5");
    expect(screen.getAllByRole("columnheader")[0]).not.toHaveClass("sticky");
  });

  it("activeKey marks that row selected and scrolls it into view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { rerender } = render(<Table columns={columns} data={data} activeKey="a" />);
    expect(rows().map((r) => r.getAttribute("aria-selected"))).toEqual(["true", "false"]);

    rerender(<Table columns={columns} data={data} activeKey="b" />);

    expect(rows().map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    delete Element.prototype.scrollIntoView;
  });

  it("fill scrolls inside with a pinned header; dense tightens the rows", () => {
    render(<Table columns={columns} data={data} fill dense />);

    expect(desktop()).toHaveClass("h-full", "min-h-0", "overflow-y-auto");
    expect(screen.getAllByRole("columnheader")[0]).toHaveClass("sticky", "top-0");
    expect(within(rows()[0]).getAllByRole("cell")[0]).toHaveClass("py-2");
  });

  it("footer renders after the rows, in the table and in the card list", () => {
    render(<Table columns={columns} data={data} footer={<button type="button">More</button>} ariaLabel="Things" />);

    expect(screen.getAllByRole("button", { name: "More" })).toHaveLength(2);
    expect(screen.getByRole("table", { name: "Things" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Things" })).toBeInTheDocument();
  });
});
