import { vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import * as branchesService from "../../services/branchesService";
import * as productsService from "../../services/productsService";
import * as productUnitsService from "../../services/productUnitsService";
import * as stockPurchasesService from "../../services/stockPurchasesService";
import * as stockService from "../../services/stockService";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { adminUser, cashierUser, mainShop } from "../../test/fixtures";

// The whole app, routes and sidebar included, with its services mocked.
vi.mock("../../services/authService", () => ({ getCurrentUser: vi.fn() }));
vi.mock("../../services/branchesService", async (importOriginal) => ({
  ...(await importOriginal()),
  listBranches: vi.fn(),
}));
vi.mock("../../services/stockService", async (importOriginal) => ({
  ...(await importOriginal()),
  getStockOverview: vi.fn(),
  getStockByProduct: vi.fn(),
}));
vi.mock("../../services/productsService", async (importOriginal) => ({
  ...(await importOriginal()),
  getProduct: vi.fn(),
}));
vi.mock("../../services/productUnitsService", async (importOriginal) => ({
  ...(await importOriginal()),
  listProductUnits: vi.fn(),
  listAllProductUnits: vi.fn(),
  getProductUnitDetails: vi.fn(),
}));
vi.mock("../../services/stockPurchasesService", async (importOriginal) => ({
  ...(await importOriginal()),
  getProductPurchaseIdentifiers: vi.fn(),
}));

const managerUser = { ...cashierUser, id: "user-manager", role: "manager" };

const product = {
  id: "p-phone",
  name: "Galaxy A15",
  sku: "SKU-000007",
  tracking_method: "IMEI",
  is_active: true,
  selling_price: "64990.00",
  brand: { id: "b1", name: "Samsung" },
  category: { id: "c1", name: "Phones" },
  stock_status: "IN_STOCK",
  quantity: 3,
  min_quantity: 1,
  units: { in_stock: 3, inspection: 0 },
  branches: [],
};

const renderApp = async (user, route) => {
  const { getCurrentUser } = await import("../../services/authService");
  getCurrentUser.mockResolvedValue({ user });
  return renderWithProviders(<App />, {
    route,
    preloadedState: { auth: authState(user), branches: branchesState([mainShop]) },
  });
};

const overviewHeading = () => screen.queryByRole("heading", { level: 1, name: "Inventory Overview" });

beforeEach(() => {
  vi.resetAllMocks();
  branchesService.listBranches.mockResolvedValue([mainShop]);
  stockService.getStockOverview.mockResolvedValue({
    data: [product],
    summary: {},
    meta: { total: 1, page: 1, limit: 25, totalPages: 1, hasNext: false, hasPrev: false },
  });
  stockService.getStockByProduct.mockResolvedValue([]);
  productsService.getProduct.mockReturnValue(new Promise(() => {}));
  productUnitsService.listAllProductUnits.mockResolvedValue([]);
  productUnitsService.listProductUnits.mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, limit: 25, totalPages: 0 },
  });
  productUnitsService.getProductUnitDetails.mockReturnValue(new Promise(() => {}));
  stockPurchasesService.getProductPurchaseIdentifiers.mockResolvedValue([]);
});

describe("InventoryOverview: routes", () => {
  it.each([
    ["an admin", adminUser],
    ["a manager", managerUser],
  ])("%s can open /inventory, and the sidebar marks it", async (_, user) => {
    await renderApp(user, "/inventory");

    expect(await screen.findByRole("heading", { level: 1, name: "Inventory Overview" })).toBeInTheDocument();
    await waitFor(() => expect(stockService.getStockOverview).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "Inventory overview" })).toHaveAttribute("aria-current", "page");
  });

  it("sends a manager's request with no branch: the backend scopes it", async () => {
    await renderApp(managerUser, "/inventory");

    await waitFor(() => expect(stockService.getStockOverview).toHaveBeenCalled());
    expect(stockService.getStockOverview.mock.lastCall[0].branchId).toBe("");
  });

  it("sends a cashier to the dashboard, without calling the API", async () => {
    await renderApp(cashierUser, "/inventory");

    expect(await screen.findByRole("link", { name: "Customers" })).toBeInTheDocument();
    expect(overviewHeading()).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inventory" })).not.toBeInTheDocument();
    expect(stockService.getStockOverview).not.toHaveBeenCalled();
  });

  it("still opens Product units at /inventory/units", async () => {
    await renderApp(adminUser, "/inventory/units");

    expect(await screen.findByRole("heading", { level: 1, name: "Product units" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Product units" })).toHaveAttribute("aria-current", "page");
    expect(overviewHeading()).not.toBeInTheDocument();
    expect(stockService.getStockOverview).not.toHaveBeenCalled();
  });

  it("still opens a unit at /inventory/units/:id", async () => {
    await renderApp(managerUser, "/inventory/units/unit-1");

    await waitFor(() => expect(productUnitsService.getProductUnitDetails).toHaveBeenCalledWith("unit-1"));
    expect(screen.getByRole("status", { name: "Loading unit" })).toBeInTheDocument();
    expect(overviewHeading()).not.toBeInTheDocument();
  });

  it("leaves an unknown path under /inventory to the app's fallback", async () => {
    await renderApp(adminUser, "/inventory/not-a-page");

    expect(await screen.findByRole("link", { name: "Customers" })).toBeInTheDocument();
    expect(overviewHeading()).not.toBeInTheDocument();
    expect(stockService.getStockOverview).not.toHaveBeenCalled();
  });

  it.each([
    ["an admin", adminUser],
    ["a manager", managerUser],
  ])("takes %s from a product's name to its details page", async (_, user) => {
    const clicks = userEvent.setup();
    await renderApp(user, "/inventory");

    const [link] = await screen.findAllByRole("link", { name: "Galaxy A15" });
    expect(link).toHaveAttribute("href", "/products/p-phone");
    await clicks.click(link);

    await waitFor(() => expect(productsService.getProduct).toHaveBeenCalledWith("p-phone"));
    expect(overviewHeading()).not.toBeInTheDocument();
  });
});
