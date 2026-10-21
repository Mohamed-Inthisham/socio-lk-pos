import { vi } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import ProductDetail from ".";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { adminUser, mainShop } from "../../test/fixtures";
import * as productsService from "../../services/productsService";
import * as stockService from "../../services/stockService";

vi.mock("../../services/productsService");
vi.mock("../../services/stockService");

const product = (overrides = {}) => ({
  id: "p1",
  name: "iPhone 15 128GB",
  product_type: "PHONE",
  phone_condition: "NEW",
  sku: "SKU-000001",
  barcode: "SLP-000001",
  barcode_type: "CODE_128",
  brand: { id: "b1", name: "Apple" },
  category: { id: "c1", name: "Phones" },
  branch: mainShop,
  buying_price: "220000.00",
  selling_price: "250000.00",
  default_warranty: "MONTH_12",
  is_serialized: true,
  is_active: true,
  ...overrides,
});

const renderDetail = () =>
  renderWithProviders(
    <Routes>
      <Route path="/products/:id" element={<ProductDetail />} />
    </Routes>,
    {
      route: "/products/p1",
      preloadedState: { auth: authState(adminUser), branches: branchesState([mainShop]) },
    },
  );

beforeEach(() => {
  vi.resetAllMocks();
  stockService.getStockByProduct.mockResolvedValue([]);
});

describe("ProductDetail — default warranty (P5-18)", () => {
  it("shows the default warranty's label, and no separate checking warranty", async () => {
    productsService.getProduct.mockResolvedValue(product());
    renderDetail();

    expect(await screen.findByText("Default warranty")).toBeInTheDocument();
    expect(screen.getByText("12 months")).toBeInTheDocument();
    expect(screen.queryByText("Checking warranty")).not.toBeInTheDocument();
  });

  it("shows Checking for a product without a warranty", async () => {
    productsService.getProduct.mockResolvedValue(product({ default_warranty: "CHECKING" }));
    renderDetail();

    expect(await screen.findByText("Default warranty")).toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeInTheDocument();
  });
});
