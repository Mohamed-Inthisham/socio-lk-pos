import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Customers from ".";
import * as customersService from "../../services/customersService";
import { authState, renderWithProviders } from "../../test/renderWithProviders";

vi.mock("../../services/customersService", () => ({
  listCustomers: vi.fn(), createCustomer: vi.fn(), updateCustomer: vi.fn(), deleteCustomer: vi.fn(),
}));

const customer = { id: "customer-1", name: "Kamal Perera", phone: "0771234567", nic: "199012345678", email: "kamal@example.com", notes: null };

describe("Customers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    customersService.listCustomers.mockResolvedValue({ data: [customer], meta: { total: 14, totalPages: 2 } });
  });

  it("shows the active customer count, directory and customer actions", async () => {
    const preloadedState = { auth: authState({ id: "manager-1", role: "manager" }) };
    renderWithProviders(<Customers />, { preloadedState, route: "/customers" });

    expect((await screen.findAllByText("Kamal Perera")).length).toBeGreaterThan(0);
    expect(screen.getByText("Customer count").parentElement).toHaveTextContent("14");
    expect(screen.getByRole("button", { name: "Add customer" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View Kamal Perera" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Edit Kamal Perera" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Delete Kamal Perera" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("navigation", { name: "Customer pages" })).toHaveTextContent("Page 1 of 2");

    screen.getByRole("button", { name: "Add customer" }).click();
    expect(await screen.findByRole("dialog", { name: "Add customer" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();
  });

  it("shows edit for cashiers while explaining that delete needs a manager", async () => {
    const preloadedState = { auth: authState({ id: "cashier-1", role: "cashier" }) };
    renderWithProviders(<Customers />, { preloadedState, route: "/customers" });

    await screen.findAllByText("Kamal Perera");
    expect(screen.getAllByRole("button", { name: "Edit Kamal Perera" })[0]).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Delete Kamal Perera" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Delete Kamal Perera" })[0]).toHaveAttribute("title", "Only managers and admins can delete customers");
  });
});
