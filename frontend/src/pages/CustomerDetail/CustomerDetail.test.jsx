import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CustomerDetail from ".";
import * as customersService from "../../services/customersService";
import * as salesService from "../../services/salesService";
import { authState, renderWithProviders } from "../../test/renderWithProviders";

vi.mock("../../services/customersService", () => ({ getCustomer: vi.fn() }));
vi.mock("../../services/salesService", () => ({ listSales: vi.fn() }));

describe("CustomerDetail", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    customersService.getCustomer.mockResolvedValue({
      id: "customer-1", name: "Kamal Perera", phone: "0771234567", nic: null,
      email: "kamal@example.com", notes: null, deleted_at: null,
    });
    salesService.listSales.mockResolvedValue({
      data: [{ id: "sale-1", sale_number: "INV-20261025-0001", status: "COMPLETED", total: "12500.00", amount_paid: "12500.00", completed_at: "2026-10-25T08:00:00.000Z", cashier: { full_name: "Test Cashier" }, return_state: "NONE", refunded_total: "0.00" }],
      meta: { total: 1, page: 1, totalPages: 1 },
    });
  });

  it("shows the customer’s sales history", async () => {
    const preloadedState = { auth: authState({ id: "cashier-1", role: "cashier" }) };
    renderWithProviders(<Routes><Route path="/customers/:id" element={<CustomerDetail />} /></Routes>, { preloadedState, route: "/customers/customer-1" });

    expect((await screen.findAllByText("INV-20261025-0001")).length).toBeGreaterThan(0);
    expect(salesService.listSales).toHaveBeenCalledWith({ customerId: "customer-1", sort: "completed_at", page: 1, limit: 10 });
  });
});
