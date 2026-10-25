import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sidebar from "./index";
import { renderWithProviders } from "../../../test/renderWithProviders";

describe("Sidebar Sales group", () => {
  it("offers sales history and cash days under Sales", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "Sales" }));

    expect(screen.getByRole("link", { name: "Sales overview" })).toHaveAttribute("href", "/sales");
    expect(screen.getByRole("link", { name: "Cash days" })).toHaveAttribute("href", "/cash-days");
  });

  it("opens the Sales group automatically on a Sales page", () => {
    renderWithProviders(<Sidebar />, { route: "/cash-days/day-1" });

    expect(screen.getByRole("button", { name: "Sales" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Cash days" })).toHaveAttribute("href", "/cash-days");
  });
});
