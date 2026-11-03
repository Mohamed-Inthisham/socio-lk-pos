import { vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductsList from "./index";
import * as productsService from "../../services/productsService";
import * as stockService from "../../services/stockService";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { adminUser, cashierUser, mainShop, cityShop } from "../../test/fixtures";

vi.mock("../../services/productsService");
vi.mock("../../services/stockService");

const managerUser = { ...cashierUser, id: "user-manager", role: "manager" };

const product = (id, name) => ({
  id,
  name,
  sku: `SKU-${id}`,
  barcode: `BC-${id}`,
  brand: { id: "b1", name: "UGREEN" },
  category: { id: "c1", name: "Cables" },
  branch: null,
  selling_price: "500.00",
  is_active: true,
});
const cable = product("p-cable", "UGREEN Cable");
const charger = product("p-charger", "UGREEN Charger");

const stockRow = (productId, branch, quantity, minQuantity) => ({
  id: `stock-${productId}-${branch.id}`,
  product_id: productId,
  branch_id: branch.id,
  quantity,
  min_quantity: minQuantity,
  manage_stock: true,
});

const renderAs = (user) =>
  renderWithProviders(<ProductsList />, {
    preloadedState: {
      auth: authState(user),
      branches: branchesState([mainShop, cityShop]),
      brands: { brands: [], loading: false, error: null, initialized: true },
      categories: { categories: [], loading: false, error: null, initialized: true },
    },
  });

/** A summary card's figure, by its label (the label followed by the figure). */
const card = (label) =>
  screen
    .getAllByText(label)
    .map((el) => el.nextElementSibling)
    .find((figure) => figure?.classList.contains("text-2xl"));

/**
 * Stock on the products list (Phase 2 P2-4): admins keep the branch
 * picker (All branches combines every branch's stock); managers and
 * cashiers have none, send no branchId for stock (the backend returns
 * their own branch), and keep the full product catalogue.
 */
describe("ProductsList: branch and stock", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    productsService.listProducts.mockResolvedValue({
      data: [cable, charger],
      meta: { total: 2 },
    });
  });

  it("an admin keeps the branch picker, and All branches combines every branch's stock", async () => {
    stockService.listStock.mockResolvedValue([
      stockRow(cable.id, mainShop, 3, 5),
      stockRow(cable.id, cityShop, 7, 5),
    ]);
    renderAs(adminUser);

    expect((await screen.findAllByText("UGREEN Cable")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /All branches/ })).toBeInTheDocument();
    expect(stockService.listStock).toHaveBeenCalledWith({});
    expect(card("Stock units")).toHaveTextContent("10");
    expect(
      screen.getByText(/Stock shows the selected branch quantity, or the combined quantity across branches/),
    ).toBeInTheDocument();
  });

  it("an admin choosing a branch still filters products and stock by it", async () => {
    stockService.listStock.mockResolvedValue([]);
    const user = userEvent.setup();
    renderAs(adminUser);
    await screen.findAllByText("UGREEN Cable");

    await user.click(screen.getByRole("button", { name: /All branches/ }));
    await user.click(await screen.findByRole("option", { name: "City Shop" }));

    await waitFor(() =>
      expect(stockService.listStock).toHaveBeenLastCalledWith({ branchId: cityShop.id }),
    );
    expect(productsService.listProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ branchId: cityShop.id }),
    );
  });

  it.each([
    ["manager", managerUser],
    ["cashier", cashierUser],
  ])(
    "a %s has no branch picker, sends no branchId, keeps the whole catalogue and sees their branch's totals",
    async (_, user) => {
      // The backend returns only their own branch's rows.
      stockService.listStock.mockResolvedValue([
        stockRow(cable.id, mainShop, 3, 5),
        stockRow(charger.id, mainShop, 0, 2),
      ]);
      renderAs(user);

      expect((await screen.findAllByText("UGREEN Cable")).length).toBeGreaterThan(0);
      expect(screen.getAllByText("UGREEN Charger").length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: /All branches/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "City Shop" })).not.toBeInTheDocument();

      expect(stockService.listStock).toHaveBeenCalledTimes(1);
      expect(stockService.listStock).toHaveBeenCalledWith({});
      const [productFilters] = productsService.listProducts.mock.calls[0];
      expect(productFilters.branchId ?? "").toBe("");

      expect(card("Total products")).toHaveTextContent("2");
      expect(card("Stock units")).toHaveTextContent("3");
      expect(card("Low stock products")).toHaveTextContent("1");
      expect(card("Out of stock")).toHaveTextContent("1");
      expect(screen.getByText("Stock shows your branch's quantity")).toBeInTheDocument();
      expect(screen.queryByText(/combined quantity across branches/)).not.toBeInTheDocument();
    },
  );
});
