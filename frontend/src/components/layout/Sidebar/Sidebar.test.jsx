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

describe("Sidebar Inventory group (INV-F1)", () => {
  const renderAs = (role, route = "/") =>
    renderWithProviders(<Sidebar />, {
      route,
      preloadedState: { auth: authState({ id: `user-${role}`, role }) },
    });

  it.each(["admin", "manager"])("offers Product units to a %s", async (role) => {
    const user = userEvent.setup();
    renderAs(role);

    await user.click(screen.getByRole("button", { name: "Inventory" }));

    expect(screen.getByRole("link", { name: "Product units" })).toHaveAttribute("href", "/inventory/units");
  });

  it("hides the Inventory group from a cashier", () => {
    renderAs("cashier");

    expect(screen.queryByRole("button", { name: "Inventory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Product units" })).not.toBeInTheDocument();
  });

  it("opens the group automatically on the page", () => {
    renderAs("manager", "/inventory/units");

    expect(screen.getByRole("button", { name: "Inventory" })).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves Stock purchases and Barcode Labels where they are", () => {
    renderAs("manager");

    expect(screen.getByRole("link", { name: "Stock purchases" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Barcode Labels" })).toBeInTheDocument();
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
