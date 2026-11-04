import { render, screen } from "@testing-library/react";
import Section, { Field } from "./index";

describe("Section", () => {
  it("shows its title as a level 2 heading, and its content", () => {
    render(<Section title="Pricing">Content</Section>);

    expect(screen.getByRole("heading", { level: 2, name: "Pricing" })).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("adds a class to the card", () => {
    render(<Section title="Pricing" className="mt-9">Content</Section>);

    expect(screen.getByRole("heading").parentElement).toHaveClass("mt-9", "rounded-xl");
  });
});

describe("Field", () => {
  it("shows its label and value", () => {
    render(<Field label="Brand" value="Apple" />);

    expect(screen.getByText("Brand")).toBeInTheDocument();
    expect(screen.getByText("Apple")).toBeInTheDocument();
  });

  it.each([[null], [undefined]])("shows %s as —", (value) => {
    render(<Field label="Brand" value={value} />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("keeps a value of 0", () => {
    render(<Field label="Count" value={0} />);

    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("takes a node as its value", () => {
    render(<Field label="Sale" value={<a href="/sales/1">INV-1</a>} />);

    expect(screen.getByRole("link", { name: "INV-1" })).toHaveAttribute("href", "/sales/1");
  });

  it("is monospace only when asked", () => {
    render(
      <>
        <Field label="Barcode" value="SLP-1" mono />
        <Field label="Brand" value="Apple" />
      </>,
    );

    expect(screen.getByText("SLP-1")).toHaveClass("font-mono");
    expect(screen.getByText("Apple")).not.toHaveClass("font-mono");
  });
});
