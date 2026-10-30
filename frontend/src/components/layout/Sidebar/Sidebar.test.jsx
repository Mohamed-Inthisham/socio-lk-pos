import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sidebar from "./index";
import { authState, renderWithProviders } from "../../../test/renderWithProviders";

describe("Sidebar Sales group", () => {
  it("shows the Customers destination", () => {
    renderWithProviders(<Sidebar />);

    expect(screen.getByRole("link", { name: "Customers" })).toHaveAttribute("href", "/customers");
  });

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

describe("Sidebar Users item (Task 2.4)", () => {
  const renderAs = (role) =>
    renderWithProviders(<Sidebar />, { preloadedState: { auth: authState({ id: `user-${role}`, role }) } });

  it("shows Users to an admin, after Barcode Labels", () => {
    renderAs("admin");
    const users = screen.getByRole("link", { name: "Users" });
    expect(users).toHaveAttribute("href", "/users");
    const links = screen.getAllByRole("link").map((link) => link.textContent);
    expect(links.indexOf("Users")).toBe(links.indexOf("Barcode Labels") + 1);
  });

  it.each(["manager", "cashier"])("hides Users from a %s", (role) => {
    renderAs(role);
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  });
});
