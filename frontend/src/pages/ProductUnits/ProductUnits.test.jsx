import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import ProductUnits from ".";
import App from "../../App";
import api from "../../services/api";
import * as productUnitsService from "../../services/productUnitsService";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { adminUser, cashierUser, cityShop, mainShop } from "../../test/fixtures";

vi.mock("../../services/productUnitsService", async (importOriginal) => ({
  ...(await importOriginal()),
  listProductUnits: vi.fn(),
}));
vi.mock("../../services/authService", () => ({ getCurrentUser: vi.fn() }));

const managerUser = { ...cashierUser, id: "user-manager", role: "manager" };

const IMEI = "356789012345671";
const SERIAL = "SN-87E56576754";

const unit = (overrides = {}) => ({
  id: "unit-1",
  product_id: "p-phone",
  product: {
    id: "p-phone",
    name: "Galaxy A15",
    sku: "SKU-000007",
    tracking_method: "IMEI",
    buying_price: "52000.00",
    selling_price: "64990.00",
  },
  branch_id: mainShop.id,
  branch: mainShop,
  imei: IMEI,
  imei_number: IMEI,
  serial_number: null,
  status: "IN_STOCK",
  buying_price: "52123.00",
  selling_price: "64990.00",
  phone_purchase: { customer: { name: "Kamal Perera", phone: "0771234567", nic: "199300000001" } },
  created_at: "2026-09-01T04:00:00.000Z",
  ...overrides,
});

const page = (rows, meta = {}) => ({
  data: rows,
  meta: { total: rows.length, page: 1, limit: 25, totalPages: rows.length ? 1 : 0, ...meta },
});

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

const renderAs = (user) =>
  renderWithProviders(
    <Routes>
      <Route path="/inventory/units" element={<ProductUnits />} />
      <Route path="/products/:id" element={<ProductPath />} />
    </Routes>,
    {
      route: "/inventory/units",
      preloadedState: { auth: authState(user), branches: branchesState([mainShop, cityShop]) },
    },
  );

const ProductPath = () => <p>Opened {useLocation().pathname}</p>;

const lastParams = () => productUnitsService.listProductUnits.mock.lastCall[0];
const table = () => screen.getByRole("table", { name: "Product units" });
const row = (text) => within(table()).getByText(text).closest("tr");
const pickStatus = async (user, name) => {
  await user.click(screen.getByRole("button", { name: /All statuses/ }));
  await user.click(await screen.findByRole("option", { name }));
};

beforeEach(() => {
  vi.resetAllMocks();
  productUnitsService.listProductUnits.mockResolvedValue(page([unit()]));
});

describe("ProductUnits: the list", () => {
  it("shows the product, identifier, status, date and the note about what it lists", async () => {
    renderAs(managerUser);

    await screen.findAllByText(IMEI);
    const cells = within(row(IMEI));
    expect(cells.getByText("Galaxy A15")).toBeInTheDocument();
    expect(cells.getByText("SKU-000007")).toBeInTheDocument();
    expect(cells.getByText("In stock")).toBeInTheDocument();
    expect(cells.getByText(new Date("2026-09-01T04:00:00.000Z").toLocaleDateString("en-LK", { timeZone: "Asia/Colombo", year: "numeric", month: "short", day: "numeric" }))).toBeInTheDocument();
    expect(screen.getByText(/This isn’t total stock/)).toBeInTheDocument();
    expect(screen.getByText(/A serial number paired with an IMEI can’t be searched yet/)).toBeInTheDocument();
    expect(lastParams()).toEqual({ page: 1, limit: 25 });
  });

  it.each([
    ["IMEI only", { imei: IMEI, imei_number: IMEI }, "IMEI", IMEI, null],
    ["serial only", { imei: SERIAL, imei_number: null, serial_number: SERIAL }, "SERIAL_NUMBER", null, SERIAL],
    ["both", { imei: IMEI, imei_number: IMEI, serial_number: SERIAL }, "IMEI", IMEI, SERIAL],
    ["a legacy IMEI", { imei: IMEI, imei_number: null }, "IMEI", IMEI, null],
    ["a legacy serial", { imei: SERIAL, imei_number: null }, "SERIAL_NUMBER", null, SERIAL],
  ])("shows a unit with %s", async (_, identifiers, tracking, imei, serial) => {
    productUnitsService.listProductUnits.mockResolvedValue(
      page([unit({ ...identifiers, product: { ...unit().product, tracking_method: tracking } })]),
    );
    renderAs(managerUser);

    await screen.findAllByText("Galaxy A15");
    const cells = within(row("Galaxy A15")).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent(imei ?? "—");
    expect(cells[2]).toHaveTextContent(serial ?? "—");
  });

  it.each([
    ["IN_STOCK", "In stock"],
    ["SOLD", "Sold"],
    ["INSPECTION", "Inspection"],
    ["RETURNED", "Back with customer"],
    ["WRITTEN_OFF", "Written off"],
  ])("labels %s as %s", async (status, label) => {
    productUnitsService.listProductUnits.mockResolvedValue(page([unit({ status })]));
    renderAs(managerUser);

    await screen.findAllByText(IMEI);
    expect(within(row(IMEI)).getByText(label)).toBeInTheDocument();
  });

  it("opens the unit's product on a row click", async () => {
    const user = userEvent.setup();
    renderAs(managerUser);

    await screen.findAllByText(IMEI);
    await user.click(row(IMEI));

    expect(await screen.findByText("Opened /products/p-phone")).toBeInTheDocument();
  });

  it("shows no buying price and no customer details", async () => {
    const { container } = renderAs(adminUser);

    await screen.findAllByText(IMEI);
    for (const hidden of ["52123", "52,123", "52000", "52,000", "Kamal", "0771234567", "199300000001"]) {
      expect(container).not.toHaveTextContent(hidden);
    }
  });
});

describe("ProductUnits: search and filters", () => {
  it("searches on Enter, trimmed, from page 1, and not on each keystroke", async () => {
    const user = userEvent.setup();
    productUnitsService.listProductUnits.mockResolvedValue(page([unit()], { total: 60, totalPages: 3 }));
    renderAs(managerUser);
    await screen.findAllByText(IMEI);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastParams().page).toBe(2));
    const calls = productUnitsService.listProductUnits.mock.calls.length;

    await user.type(screen.getByLabelText("Search by identifier"), `  ${IMEI}  `);
    expect(productUnitsService.listProductUnits).toHaveBeenCalledTimes(calls);

    await user.keyboard("{Enter}");
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 25, imei: IMEI }));
    expect(productUnitsService.listProductUnits).toHaveBeenCalledTimes(calls + 1);
  });

  it("searches with the button, and Clear removes the search", async () => {
    const user = userEvent.setup();
    renderAs(managerUser);
    await screen.findAllByText(IMEI);
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Search by identifier"), IMEI);
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(lastParams().imei).toBe(IMEI));

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 25 }));
    expect(screen.getByLabelText("Search by identifier")).toHaveValue("");
  });

  it("the status filter sends status and goes back to page 1", async () => {
    const user = userEvent.setup();
    productUnitsService.listProductUnits.mockResolvedValue(page([unit()], { total: 60, totalPages: 3 }));
    renderAs(managerUser);
    await screen.findAllByText(IMEI);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastParams().page).toBe(2));

    await pickStatus(user, "Back with customer");

    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 25, status: "RETURNED" }));
  });

  it("an admin has the branch filter and column, and a branch goes to the API", async () => {
    const user = userEvent.setup();
    renderAs(adminUser);
    await screen.findAllByText(IMEI);

    expect(within(table()).getByRole("columnheader", { name: "Branch" })).toBeInTheDocument();
    expect(within(row(IMEI)).getByText("Main Shop")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /All branches/ }));
    await user.click(await screen.findByRole("option", { name: "City Shop" }));

    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 25, branchId: cityShop.id }));
  });

  it("a manager has neither, and never sends a branch", async () => {
    const user = userEvent.setup();
    renderAs(managerUser);
    await screen.findAllByText(IMEI);

    expect(within(table()).queryByRole("columnheader", { name: "Branch" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /All branches/ })).not.toBeInTheDocument();
    await pickStatus(user, "Sold");

    await waitFor(() => expect(lastParams().status).toBe("SOLD"));
    for (const [params] of productUnitsService.listProductUnits.mock.calls) {
      expect(params).not.toHaveProperty("branchId");
    }
  });
});

describe("ProductUnits: paging", () => {
  it("Previous and Next move through the pages, and stop at the ends", async () => {
    const user = userEvent.setup();
    productUnitsService.listProductUnits.mockImplementation(async ({ page: number }) =>
      page([unit()], { total: 30, page: number, totalPages: 2 }),
    );
    renderAs(managerUser);

    await screen.findByText("Page 1 of 2");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 2");
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeDisabled());
    expect(lastParams().page).toBe(2);

    await user.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("Page 1 of 2");
    expect(lastParams().page).toBe(1);
  });

  it("has no pager on a single page", async () => {
    renderAs(managerUser);

    await screen.findAllByText(IMEI);
    expect(screen.queryByRole("navigation", { name: "Product unit pages" })).not.toBeInTheDocument();
  });
});

describe("ProductUnits: states", () => {
  it("shows the skeleton while loading", () => {
    productUnitsService.listProductUnits.mockReturnValue(new Promise(() => {}));
    const { container } = renderAs(managerUser);

    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("says so when no units exist", async () => {
    productUnitsService.listProductUnits.mockResolvedValue(page([]));
    renderAs(managerUser);

    expect((await screen.findAllByText("No product units have been recorded yet.")).length).toBeGreaterThan(0);
  });

  it("says something else when filters match nothing", async () => {
    const user = userEvent.setup();
    renderAs(managerUser);
    await screen.findAllByText(IMEI);
    productUnitsService.listProductUnits.mockResolvedValue(page([]));

    await pickStatus(user, "Written off");

    expect((await screen.findAllByText("No units match these filters.")).length).toBeGreaterThan(0);
    expect(screen.queryByText("No product units have been recorded yet.")).not.toBeInTheDocument();
  });

  it("shows an error, and Try again reloads", async () => {
    const user = userEvent.setup();
    productUnitsService.listProductUnits.mockRejectedValueOnce(new Error("offline"));
    renderAs(managerUser);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load product units");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await screen.findAllByText(IMEI);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a slow older answer can't overwrite a newer one", async () => {
    const user = userEvent.setup();
    const older = deferred();
    const newer = deferred();
    productUnitsService.listProductUnits.mockReturnValueOnce(Promise.resolve(page([unit()])));
    productUnitsService.listProductUnits.mockReturnValueOnce(older.promise);
    productUnitsService.listProductUnits.mockReturnValueOnce(newer.promise);
    renderAs(managerUser);
    await screen.findAllByText(IMEI);

    await pickStatus(user, "Sold");
    await user.click(screen.getByRole("button", { name: /Sold/ }));
    await user.click(await screen.findByRole("option", { name: "Inspection" }));
    await waitFor(() => expect(lastParams().status).toBe("INSPECTION"));

    newer.resolve(page([unit({ id: "unit-new", product: { ...unit().product, name: "Newer answer" } })]));
    await screen.findAllByText("Newer answer");
    older.resolve(page([unit({ id: "unit-old", product: { ...unit().product, name: "Older answer" } })]));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getAllByText("Newer answer").length).toBeGreaterThan(0);
    expect(screen.queryByText("Older answer")).not.toBeInTheDocument();
  });
});

describe("ProductUnits: the real request", () => {
  it("sends the filters as query parameters", async () => {
    const { listProductUnits } = await vi.importActual("../../services/productUnitsService");
    productUnitsService.listProductUnits.mockImplementation(listProductUnits);
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: page([unit()]) });
    const user = userEvent.setup();
    renderAs(adminUser);
    await screen.findAllByText(IMEI);

    await pickStatus(user, "In stock");

    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith("/product-units", {
        params: { page: 1, limit: 25, status: "IN_STOCK" },
      }),
    );
    get.mockRestore();
  });
});

describe("ProductUnits: route access", () => {
  const renderApp = async (user) => {
    const { getCurrentUser } = await import("../../services/authService");
    getCurrentUser.mockResolvedValue({ user });
    return renderWithProviders(<App />, {
      route: "/inventory/units",
      preloadedState: { auth: authState(user), branches: branchesState([mainShop, cityShop]) },
    });
  };

  it.each([
    ["an admin", adminUser],
    ["a manager", managerUser],
  ])("%s can open the page", async (_, user) => {
    await renderApp(user);

    expect(await screen.findByRole("heading", { name: "Product units" })).toBeInTheDocument();
    await waitFor(() => expect(productUnitsService.listProductUnits).toHaveBeenCalled());
  });

  it("a cashier is sent to the dashboard, and the API is not called", async () => {
    await renderApp(cashierUser);

    expect(await screen.findByRole("link", { name: "Customers" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Product units" })).not.toBeInTheDocument();
    expect(productUnitsService.listProductUnits).not.toHaveBeenCalled();
  });
});
