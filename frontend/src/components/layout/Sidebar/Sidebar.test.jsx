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

  it.each(["admin", "manager"])("offers the Inventory overview to a %s, once, before Product units", async (role) => {
    const user = userEvent.setup();
    renderAs(role);

    expect(screen.getAllByRole("button", { name: "Inventory" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Inventory" }));

    const overview = screen.getByRole("link", { name: "Inventory overview" });
    expect(overview).toHaveAttribute("href", "/inventory");
    expect(overview.compareDocumentPosition(screen.getByRole("link", { name: "Product units" })))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("hides the Inventory group from a cashier", () => {
    renderAs("cashier");

    expect(screen.queryByRole("button", { name: "Inventory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Inventory overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Product units" })).not.toBeInTheDocument();
  });

  it.each([
    ["/inventory", "Inventory overview", "Product units"],
    ["/inventory/units", "Product units", "Inventory overview"],
    ["/inventory/units/unit-1", "Product units", "Inventory overview"],
  ])("on %s marks %s and keeps the group open", (route, current, other) => {
    renderAs("admin", route);

    expect(screen.getByRole("button", { name: "Inventory" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Inventory" })).toHaveClass("text-slate-900");
    expect(screen.getByRole("link", { name: current })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: other })).not.toHaveAttribute("aria-current");
  });

  it("leaves the group closed elsewhere", () => {
    renderAs("admin", "/products");

    expect(screen.getByRole("button", { name: "Inventory" })).toHaveAttribute("aria-expanded", "false");
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
