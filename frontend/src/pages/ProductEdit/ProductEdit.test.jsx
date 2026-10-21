import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import ProductEdit from ".";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { adminUser, mainShop } from "../../test/fixtures";
import * as productsService from "../../services/productsService";

vi.mock("../../services/productsService");

const brand = { id: "11111111-1111-4111-8111-111111111111", name: "Anker", is_active: true };
const category = { id: "22222222-2222-4222-8222-222222222222", name: "Cables", is_active: true };
// A real (UUID) branch id: the edit schema validates branch_id, and its error
// wouldn't show (the field is read-only), silently blocking the save.
const branch = { ...mainShop, id: "33333333-3333-4333-8333-333333333333" };

const product = {
  id: "p1",
  name: "USB-C Cable 1m",
  product_type: "ACCESSORY",
  sku: "SKU-000001",
  barcode: "SLP-000001",
  barcode_type: "CODE_128",
  brand,
  category,
  branch,
  buying_price: "500.00",
  selling_price: "1500.00",
  default_warranty: "MONTH_12",
  is_serialized: false,
  is_active: true,
};

const renderEdit = () =>
  renderWithProviders(
    <Routes>
      <Route path="/products/:id/edit" element={<ProductEdit />} />
      <Route path="/products/:id" element={<p>Detail page</p>} />
    </Routes>,
    {
      route: "/products/p1/edit",
      preloadedState: {
        auth: authState(adminUser),
        branches: branchesState([branch]),
        brands: { brands: [brand], loading: false, error: null, initialized: true },
        categories: { categories: [category], loading: false, error: null, initialized: true },
      },
    },
  );

beforeEach(() => {
  vi.resetAllMocks();
  productsService.getProduct.mockResolvedValue(product);
  productsService.updateProduct.mockResolvedValue({ ...product, default_warranty: "WEEK_2" });
});

describe("ProductEdit — default warranty (P5-18)", () => {
  it("shows the product's default warranty, and no old warranty number fields", async () => {
    renderEdit();

    expect(await screen.findByRole("button", { name: "12 months" })).toBeInTheDocument();
    expect(screen.getByText("Default warranty")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Warranty \(months\)/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Checking warranty \(days\)/)).not.toBeInTheDocument();
  });

  it("saves a changed default warranty as the code, and nothing else", async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.click(await screen.findByRole("button", { name: "12 months" }));
    await user.click(await screen.findByRole("option", { name: "2 weeks" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(productsService.updateProduct).toHaveBeenCalledWith("p1", { default_warranty: "WEEK_2" }),
    );
  });

  it("offers every period from the shop's list", async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.click(await screen.findByRole("button", { name: "12 months" }));
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");

    expect(options.map((o) => o.textContent.trim())).toEqual([
      "Checking",
      "1 week",
      "2 weeks",
      "1 month",
      "2 months",
      "3 months",
      "6 months",
      "12 months",
      "18 months",
      "24 months",
    ]);
  });
});
