import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import InventoryMovementHistory from ".";
import RoleProtectedRoute from "../../components/auth/RoleProtectedRoute";
import { getStockMovements } from "../../services/stockService";
import { listBranches } from "../../services/branchesService";
import { listProducts } from "../../services/productsService";
import {
  authState,
  branchesState,
  renderWithProviders,
} from "../../test/renderWithProviders";
import {
  adminUser,
  cashierUser,
  cityShop,
  mainShop,
} from "../../test/fixtures";

vi.mock("../../services/stockService", () => ({ getStockMovements: vi.fn() }));
vi.mock("../../services/branchesService", () => ({ listBranches: vi.fn() }));
vi.mock("../../services/productsService", () => ({ listProducts: vi.fn() }));

const manager = { ...cashierUser, role: "manager", branch_id: mainShop.id };
const product = { id: "product-1", name: "Galaxy A15", sku: "SKU-15" };
const reversal = {
  id: "movement-1",
  movement_type: "REVERSAL",
  product_id: product.id,
  product_name: product.name,
  branch_id: mainShop.id,
  branch_name: mainShop.name,
  product_unit_id: "unit-1",
  product_unit_code: "12345678",
  quantity_delta: 1,
  quantity_before: 0,
  quantity_after: 1,
  stock_managed: true,
  unit_status_from: "SOLD",
  unit_status_to: "IN_STOCK",
  reason_code: null,
  note: null,
  reference_type: "SALE_LINE",
  reference_id: "line-12345678",
  reverses_movement_id: "original-12345678",
  performed_by: { id: "cashier-1", full_name: "Cashier One" },
  approved_by: { id: "manager-1", full_name: "Manager One" },
  created_at: "2026-11-18T05:00:00.000Z",
};
const response = (data = [reversal], overrides = {}) => ({
  data,
  meta: {
    total: data.length,
    page: 1,
    limit: 25,
    totalPages: data.length ? 1 : 0,
    hasNext: false,
    hasPrev: false,
    ...overrides,
  },
});
const renderAs = (user = adminUser) =>
  renderWithProviders(<InventoryMovementHistory />, {
    route: "/inventory/movements",
    preloadedState: {
      auth: authState(user),
      branches: branchesState([mainShop, cityShop]),
    },
  });
const choose = async (user, current, option) => {
  await user.click(screen.getByRole("button", { name: current }));
  await user.click(await screen.findByRole("option", { name: option }));
};

describe("InventoryMovementHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStockMovements.mockResolvedValue(response());
    listBranches.mockResolvedValue([mainShop, cityShop]);
    listProducts.mockResolvedValue({ data: [product], meta: {} });
  });

  it("shows reversal, quantity snapshots, unit status, references and minimal actor details", async () => {
    renderAs();
    expect(
      await screen.findByRole("heading", { name: "Stock Movement History" }),
    ).toBeInTheDocument();
    const table = await screen.findByRole("table", {
      name: "Stock movement history",
    });
    expect(within(table).getByText("Sale void reversal")).toBeInTheDocument();
    const rowText = table.querySelector("tbody tr")?.textContent;
    expect(rowText).toContain("Reverses original");
    expect(rowText).toContain("0 → 1");
    expect(rowText).toContain("SOLD → IN_STOCK");
    expect(rowText).toContain("12345678");
    expect(rowText).toContain("SALE_LINE");
    expect(rowText).toContain("Approved by Manager One");
  });

  it("supports product, branch, type and date filters and resets to page one", async () => {
    const user = userEvent.setup();
    renderAs();
    await screen.findAllByText("Sale void reversal");
    await user.type(
      screen.getByRole("searchbox", { name: "Product" }),
      "Galaxy",
    );
    const productOption = await screen.findByRole("option", {
      name: /Galaxy A15/,
    });
    await user.click(productOption);
    await choose(user, "All branches", cityShop.name);
    await choose(user, "All movement types", "Purchase received");
    await user.type(screen.getByLabelText("From date"), "2026-11-01");
    await user.type(screen.getByLabelText("To date"), "2026-11-18");

    await waitFor(() =>
      expect(getStockMovements).toHaveBeenLastCalledWith({
        page: 1,
        limit: 25,
        productId: product.id,
        branchId: cityShop.id,
        movementType: "PURCHASE",
        startDate: "2026-11-01",
        endDate: "2026-11-18",
      }),
    );
    expect(listProducts).toHaveBeenCalledWith({
      search: "Galaxy",
      limit: 50,
      includeInactive: true,
    });
  });

  it("keeps manager history branch-scoped and has no branch picker", async () => {
    renderAs(manager);
    await screen.findAllByText("Sale void reversal");
    expect(screen.queryByLabelText("Branch")).not.toBeInTheDocument();
    expect(getStockMovements).toHaveBeenCalledWith({ page: 1, limit: 25 });
    expect(listBranches).not.toHaveBeenCalled();
  });

  it("shows empty, error and loading states", async () => {
    getStockMovements.mockImplementationOnce(() => new Promise(() => {}));
    const pending = renderAs();
    expect(
      await screen.findByRole("table", { name: "Stock movement history" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No stock movements match these filters."),
    ).not.toBeInTheDocument();
    pending.unmount();

    getStockMovements.mockResolvedValueOnce(response([]));
    const { unmount } = renderAs();
    expect(
      await screen.findAllByText("No stock movements match these filters."),
    ).toHaveLength(2);
    unmount();

    getStockMovements.mockRejectedValueOnce(new Error("offline"));
    renderAs();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t load movement history.",
    );
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("supports pagination", async () => {
    const user = userEvent.setup();
    getStockMovements.mockResolvedValue(
      response([reversal], { total: 26, totalPages: 2, hasNext: true }),
    );
    renderAs();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(getStockMovements).toHaveBeenLastCalledWith({
        page: 2,
        limit: 25,
      }),
    );
  });

  it("redirects cashiers away before the history page loads", async () => {
    renderWithProviders(
      <Routes>
        <Route
          path="/inventory/movements"
          element={
            <RoleProtectedRoute allowedRoles={["admin", "manager"]}>
              <InventoryMovementHistory />
            </RoleProtectedRoute>
          }
        />
        <Route path="/dashboard" element={<p>Dashboard</p>} />
      </Routes>,
      {
        route: "/inventory/movements",
        preloadedState: {
          auth: authState(cashierUser),
          branches: branchesState([]),
        },
      },
    );
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(getStockMovements).not.toHaveBeenCalled();
  });
});
