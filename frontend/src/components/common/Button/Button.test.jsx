import { render, screen } from "@testing-library/react";
import Button from "./index";

describe("Button", () => {
  it("renders its label", () => {
    render(<Button label="Save" />);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
