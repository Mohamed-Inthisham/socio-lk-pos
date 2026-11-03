import { vi } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import ProductDetail from ".";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { adminUser, cashierUser, mainShop, cityShop } from "../../test/fixtures";
import * as productsService from "../../services/productsService";
import * as stockService from "../../services/stockService";
import * as productUnitsService from "../../services/productUnitsService";
import * as stockPurchasesService from "../../services/stockPurchasesService";

vi.mock("../../services/productsService");
vi.mock("../../services/stockService");
vi.mock("../../services/productUnitsService");
vi.mock("../../services/stockPurchasesService");

const managerUser = { ...cashierUser, id: "user-manager", role: "manager" };

const product = {
  id: "p1",
  name: "UGREEN Cable",
  product_type: "ACCESSORY",
  sku: "SKU-000002",
  barcode: "SLP-000002",
  barcode_type: "CODE_128",
  brand: { id: "b1", name: "UGREEN" },
  category: { id: "c1", name: "Cables" },
  branch: null,
  buying_price: "300.00",
  selling_price: "500.00",
  default_warranty: "NO_WARRANTY",
  is_serialized: false,
  tracking_method: "QUANTITY",
  is_active: true,
};

const stockRow = (branch, quantity) => ({
  id: `stock-${branch.id}`,
  product_id: product.id,
  branch_id: branch.id,
  branch,
  quantity,
  min_quantity: 2,
  manage_stock: true,
  low_stock_alert: false,
});

const renderAs = (user) =>
  renderWithProviders(
    <Routes>
      <Route path="/products/:id" element={<ProductDetail />} />
    </Routes>,
    {
      route: "/products/p1",
      preloadedState: { auth: authState(user), branches: branchesState([mainShop, cityShop]) },
    },
  );

/**
 * The stock section's heading (Phase 2 P2-4): admins see every branch's
 * row, so "Stock across branches"; managers and cashiers get only their
 * own branch's row from the backend, so "Stock at Your Branch".
 */
describe("ProductDetail: stock section heading", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    productsService.getProduct.mockResolvedValue(product);
    productUnitsService.listAllProductUnits.mockResolvedValue([]);
    stockPurchasesService.getProductPurchaseIdentifiers.mockResolvedValue([]);
  });

  it("an admin sees Stock across branches, with every branch's row", async () => {
    stockService.getStockByProduct.mockResolvedValue([stockRow(mainShop, 3), stockRow(cityShop, 9)]);
    renderAs(adminUser);

    expect(await screen.findByRole("heading", { name: "Stock across branches" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Stock at Your Branch" })).not.toBeInTheDocument();
    expect(screen.getByText("City Shop")).toBeInTheDocument();
  });

  it.each([
    ["manager", managerUser],
    ["cashier", cashierUser],
  ])("a %s sees Stock at Your Branch", async (_, user) => {
    stockService.getStockByProduct.mockResolvedValue([stockRow(mainShop, 3)]);
    renderAs(user);

    expect(await screen.findByRole("heading", { name: "Stock at Your Branch" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Stock across branches" })).not.toBeInTheDocument();
    expect(stockService.getStockByProduct).toHaveBeenCalledWith("p1");
  });
});
