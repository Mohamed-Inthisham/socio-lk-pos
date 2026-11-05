import { vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import ProductDetail from ".";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { adminUser, cashierUser, cityShop, mainShop } from "../../test/fixtures";
import * as productsService from "../../services/productsService";
import * as stockService from "../../services/stockService";
import * as productUnitsService from "../../services/productUnitsService";
import * as stockPurchasesService from "../../services/stockPurchasesService";

vi.mock("../../services/productsService");
vi.mock("../../services/stockService");
vi.mock("../../services/productUnitsService");
vi.mock("../../services/stockPurchasesService");

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
  productUnitsService.listAllProductUnits.mockResolvedValue([]);
  stockPurchasesService.getProductPurchaseIdentifiers.mockResolvedValue([]);
});

describe("ProductDetail — default warranty (P5-18)", () => {
  it("shows the default warranty's label, and no separate checking warranty", async () => {
    productsService.getProduct.mockResolvedValue(product());
    renderDetail();

    expect(await screen.findByText("Default warranty")).toBeInTheDocument();
    expect(screen.getByText("12 months")).toBeInTheDocument();
    expect(screen.queryByText("Checking warranty")).not.toBeInTheDocument();
  });

  it.each([
    ["NO_WARRANTY", "No warranty"],
    ["CHECKING", "Checking"],
  ])("shows %s as %s", async (code, label) => {
    productsService.getProduct.mockResolvedValue(product({ default_warranty: code }));
    renderDetail();

    expect(await screen.findByText("Default warranty")).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

/**
 * The unit table (admins and managers, tracked products): each unit's
 * identifiers, branch, status and sale, the count cards, and identifiers
 * received before units were tracked.
 */
describe("ProductDetail: unit rows", () => {
  const IMEI = "356789012345671";
  const SERIAL = "SN-87E56576754";
  const managerUser = { ...cashierUser, id: "user-manager", role: "manager" };

  const unit = (overrides = {}) => ({
    id: "unit-1",
    imei: IMEI,
    imei_number: IMEI,
    serial_number: null,
    status: "IN_STOCK",
    branch: mainShop,
    sale_lines: [],
    ...overrides,
  });
  const tracked = (tracking_method = "IMEI") => product({ tracking_method });

  const SalePath = () => <p>Opened {useLocation().pathname}</p>;
  const renderAs = (user = adminUser) =>
    renderWithProviders(
      <Routes>
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/pos/sales/:id" element={<SalePath />} />
      </Routes>,
      {
        route: "/products/p1",
        preloadedState: { auth: authState(user), branches: branchesState([mainShop, cityShop]) },
      },
    );

  const showUnits = async (units, { tracking, purchases = [], user } = {}) => {
    productsService.getProduct.mockResolvedValue(tracked(tracking));
    productUnitsService.listAllProductUnits.mockResolvedValue(units);
    stockPurchasesService.getProductPurchaseIdentifiers.mockResolvedValue(purchases);
    renderAs(user);
    await screen.findByRole("heading", { name: "Unit identifiers and balances" });
  };
  /** The body rows' cells: IMEI, serial number, branch, status, sale. */
  const cellsOf = (index = 0) =>
    within(within(screen.getByRole("table")).getAllByRole("row")[index + 1]).getAllByRole("cell");

  it("shows an IMEI-only unit's IMEI, and — for its serial number", async () => {
    await showUnits([unit()]);

    expect(cellsOf()[0]).toHaveTextContent(IMEI);
    expect(cellsOf()[1]).toHaveTextContent("—");
  });

  it("shows a serial-only unit's serial number, and — for its IMEI", async () => {
    await showUnits([unit({ imei: SERIAL, imei_number: null, serial_number: SERIAL })], {
      tracking: "SERIAL_NUMBER",
    });

    expect(cellsOf()[0]).toHaveTextContent("—");
    expect(cellsOf()[1]).toHaveTextContent(SERIAL);
  });

  it("shows both identifiers of a paired unit", async () => {
    await showUnits([unit({ serial_number: SERIAL })]);

    expect(cellsOf()[0]).toHaveTextContent(IMEI);
    expect(cellsOf()[1]).toHaveTextContent(SERIAL);
  });

  it("shows a legacy unit's imei column as its IMEI on an IMEI product", async () => {
    await showUnits([unit({ imei_number: null })]);

    expect(cellsOf()[0]).toHaveTextContent(IMEI);
    expect(cellsOf()[1]).toHaveTextContent("—");
  });

  it("shows a legacy unit's imei column as its serial number on a serial product", async () => {
    await showUnits([unit({ imei: SERIAL, imei_number: null })], { tracking: "SERIAL_NUMBER" });

    expect(cellsOf()[0]).toHaveTextContent("—");
    expect(cellsOf()[1]).toHaveTextContent(SERIAL);
  });

  it("shows the unit's branch and status", async () => {
    await showUnits([unit({ branch: cityShop })]);

    expect(cellsOf()[2]).toHaveTextContent("City Shop");
    expect(cellsOf()[3]).toHaveTextContent("In stock");
  });

  it("shows a reversed trade-in as Back with customer", async () => {
    await showUnits([unit({ status: "RETURNED" })]);

    expect(cellsOf()[3]).toHaveTextContent("Back with customer");
  });

  it("opens a completed sale at /pos/sales/:id", async () => {
    const user = userEvent.setup();
    await showUnits([
      unit({
        status: "SOLD",
        sale_lines: [
          { sale: { id: "sale-7", sale_number: "INV-7", status: "COMPLETED", completed_at: "2026-10-20T04:00:00.000Z" } },
        ],
      }),
    ]);

    await user.click(within(cellsOf()[4]).getByRole("button", { name: "INV-7" }));

    expect(await screen.findByText("Opened /pos/sales/sale-7")).toBeInTheDocument();
  });

  it("marks a voided sale, and leaves a draft out", async () => {
    await showUnits([
      unit({
        sale_lines: [
          { sale: { id: "sale-8", sale_number: "INV-8", status: "VOIDED", completed_at: "2026-10-20T04:00:00.000Z" } },
          { sale: { id: "sale-9", sale_number: null, status: "DRAFT", completed_at: null } },
        ],
      }),
    ]);

    expect(within(cellsOf()[4]).getByRole("button")).toHaveTextContent("INV-8 (voided)");
  });

  it("shows — for a unit with no sale", async () => {
    await showUnits([unit()]);

    expect(cellsOf()[4]).toHaveTextContent("—");
    expect(within(cellsOf()[4]).queryByRole("button")).not.toBeInTheDocument();
  });

  it("lists a purchase identifier with no unit as received before unit tracking", async () => {
    await showUnits([unit()], {
      purchases: [
        {
          purchase_item_id: "item-1",
          imei_numbers: [IMEI, "356789012345689"],
          serial_numbers: [],
          branch_name: "City Shop",
        },
      ],
    });

    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(cellsOf(1)[0]).toHaveTextContent("356789012345689");
    expect(cellsOf(1)[2]).toHaveTextContent("City Shop");
    expect(cellsOf(1)[3]).toHaveTextContent("Unknown (received before unit tracking)");
  });

  it("counts identified units from their status, and the balance from stock rows", async () => {
    stockService.getStockByProduct.mockResolvedValue([
      { id: "s1", branch: mainShop, quantity: 4, min_quantity: 0, manage_stock: true },
      { id: "s2", branch: cityShop, quantity: 3, min_quantity: 0, manage_stock: true },
    ]);
    await showUnits([
      unit({ id: "u1" }),
      unit({ id: "u2" }),
      unit({ id: "u3", status: "SOLD" }),
      unit({ id: "u4", status: "INSPECTION" }),
    ]);

    const figure = (label) => screen.getByText(label).nextElementSibling;
    expect(figure("In stock with identifier")).toHaveTextContent("2");
    expect(figure("Currently sold")).toHaveTextContent("1");
    expect(figure("Total stock balance")).toHaveTextContent("7");
  });

  it("a manager sees the section", async () => {
    await showUnits([unit()], { user: managerUser });

    expect(cellsOf()[0]).toHaveTextContent(IMEI);
  });

  it("a cashier has no section, and the units aren't requested", async () => {
    productsService.getProduct.mockResolvedValue(tracked());
    renderAs(cashierUser);

    expect(await screen.findByText("Default warranty")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unit identifiers and balances" })).not.toBeInTheDocument();
    expect(productUnitsService.listAllProductUnits).not.toHaveBeenCalled();
  });

  it("a quantity product has no section", async () => {
    productsService.getProduct.mockResolvedValue(tracked("QUANTITY"));
    renderAs();

    expect(await screen.findByText("Default warranty")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unit identifiers and balances" })).not.toBeInTheDocument();
  });
});
