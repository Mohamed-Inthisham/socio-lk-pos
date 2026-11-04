import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import ProductUnitDetail from ".";
import App from "../../App";
import * as productUnitsService from "../../services/productUnitsService";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { adminUser, cashierUser, mainShop } from "../../test/fixtures";

vi.mock("../../services/productUnitsService", async (importOriginal) => ({
  ...(await importOriginal()),
  getProductUnitDetails: vi.fn(),
  listProductUnits: vi.fn(),
}));
vi.mock("../../services/authService", () => ({ getCurrentUser: vi.fn() }));

const managerUser = { ...cashierUser, id: "user-manager", role: "manager" };

const IMEI = "356789012345671";
const SERIAL = "SN-87E56576754";
const UNKNOWN_ACQUISITION = {
  type: "UNKNOWN",
  date: null,
  stock_purchase: null,
  supplier_name: null,
  customer_name: null,
  sale: null,
};

const details = (overrides = {}) => ({
  unit: {
    id: "unit-1",
    imei: IMEI,
    imei_number: IMEI,
    serial_number: null,
    status: "IN_STOCK",
    created_at: "2026-09-01T04:00:00.000Z",
  },
  product: { id: "p-phone", name: "Galaxy A15", sku: "SKU-000007", tracking_method: "IMEI" },
  branch: { id: "b-1", name: "Main Shop" },
  acquisition: UNKNOWN_ACQUISITION,
  sales: [],
  returns: [],
  ...overrides,
});

const notFound = () => Object.assign(new Error("404"), { response: { status: 404 } });
const httpError = (status) => Object.assign(new Error(String(status)), { response: { status } });

/** Where a link went, and the state it took. */
const Probe = () => {
  const location = useLocation();
  return <p data-testid="opened">{`${location.pathname} ${JSON.stringify(location.state)}`}</p>;
};

const renderPage = (state, user = managerUser, id = "unit-1") =>
  renderWithProviders(
    <Routes>
      <Route path="/inventory/units/:id" element={<ProductUnitDetail />} />
      <Route path="*" element={<Probe />} />
    </Routes>,
    {
      route: { pathname: `/inventory/units/${id}`, state },
      preloadedState: { auth: authState(user), branches: branchesState([mainShop]) },
    },
  );

const show = async (overrides, state) => {
  productUnitsService.getProductUnitDetails.mockResolvedValue(details(overrides));
  const view = renderPage(state);
  await screen.findByRole("heading", { level: 1 });
  return view;
};
const section = (title) => screen.getByRole("heading", { level: 2, name: title }).parentElement;
const opened = () => screen.getByTestId("opened").textContent;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ProductUnitDetail: the unit", () => {
  it("asks for this unit's details", async () => {
    await show();

    expect(productUnitsService.getProductUnitDetails).toHaveBeenCalledWith("unit-1");
  });

  it("shows the header, unit and product", async () => {
    await show({ unit: { ...details().unit, status: "SOLD" } });

    expect(screen.getByRole("heading", { level: 1, name: "Galaxy A15" })).toBeInTheDocument();
    expect(screen.getAllByText("Sold").length).toBeGreaterThan(0);
    const unit = within(section("Unit"));
    expect(unit.getByText(IMEI)).toBeInTheDocument();
    expect(unit.getByText("Main Shop")).toBeInTheDocument();
    expect(unit.getByText("01 Sept 2026, 9:30 AM")).toBeInTheDocument();
    const product = within(section("Product"));
    expect(product.getByRole("link", { name: "Galaxy A15" })).toHaveAttribute("href", "/products/p-phone");
    expect(product.getByText("SKU-000007")).toBeInTheDocument();
    expect(product.getByText("IMEI")).toBeInTheDocument();
  });

  it("labels a reversed trade-in Back with customer", async () => {
    await show({ unit: { ...details().unit, status: "RETURNED" } });

    expect(within(section("Unit")).getByText("Back with customer")).toBeInTheDocument();
  });

  it.each([
    ["IMEI only", { imei_number: IMEI, serial_number: null }, "IMEI", IMEI, "—", IMEI],
    ["serial only", { imei: SERIAL, imei_number: null, serial_number: SERIAL }, "SERIAL_NUMBER", "—", SERIAL, SERIAL],
    ["both", { imei_number: IMEI, serial_number: SERIAL }, "IMEI", IMEI, SERIAL, IMEI],
  ])("shows a unit with %s", async (_, identifiers, tracking, imei, serial, main) => {
    await show({
      unit: { ...details().unit, ...identifiers },
      product: { ...details().product, tracking_method: tracking },
    });

    const row = (label) => within(section("Unit")).getByText(label).nextElementSibling;
    expect(row("IMEI")).toHaveTextContent(imei);
    expect(row("Serial number")).toHaveTextContent(serial);
    expect(screen.getByRole("heading", { level: 1 }).parentElement.nextElementSibling).toHaveTextContent(main);
  });

  it("labels serial tracking", async () => {
    await show({ product: { ...details().product, tracking_method: "SERIAL_NUMBER" } });

    expect(within(section("Product")).getByText("Serial number")).toBeInTheDocument();
  });
});

describe("ProductUnitDetail: acquisition", () => {
  it("a stock purchase shows its link, date and supplier", async () => {
    await show({
      acquisition: {
        ...UNKNOWN_ACQUISITION,
        type: "STOCK_PURCHASE",
        date: "2026-10-27",
        stock_purchase: { id: "sp-1", purchase_number: "SP-1A2B3C4D" },
        supplier_name: "Ranjith Mobiles",
      },
    });

    const box = within(section("Acquisition"));
    expect(box.getByText("Stock purchase")).toBeInTheDocument();
    expect(box.getByRole("link", { name: "SP-1A2B3C4D" })).toHaveAttribute("href", "/stock-purchases/sp-1");
    expect(box.getByText("27 Oct 2026")).toBeInTheDocument();
    expect(box.getByText("Ranjith Mobiles")).toBeInTheDocument();
    expect(box.queryByRole("link", { name: "Ranjith Mobiles" })).not.toBeInTheDocument();
  });

  it("a phone purchase shows its date and seller, as plain text", async () => {
    await show({
      acquisition: {
        ...UNKNOWN_ACQUISITION,
        type: "PHONE_PURCHASE",
        date: "2026-10-01T04:00:00.000Z",
        customer_name: "Kamal Perera",
      },
    });

    const box = within(section("Acquisition"));
    expect(box.getByText("Bought from customer")).toBeInTheDocument();
    expect(box.getByText("01 Oct 2026, 9:30 AM")).toBeInTheDocument();
    expect(box.getByText("Kamal Perera")).toBeInTheDocument();
    expect(box.queryByRole("link")).not.toBeInTheDocument();
  });

  it("a trade-in shows its date, customer and sale", async () => {
    const user = userEvent.setup();
    await show({
      acquisition: {
        ...UNKNOWN_ACQUISITION,
        type: "TRADE_IN",
        date: "2026-10-01T04:00:00.000Z",
        customer_name: "Kamal Perera",
        sale: { id: "sale-7", sale_number: "INV-7" },
      },
    });

    const box = within(section("Acquisition"));
    expect(box.getByText("Trade-in")).toBeInTheDocument();
    expect(box.getByText("Kamal Perera")).toBeInTheDocument();
    expect(box.queryByRole("link", { name: "Kamal Perera" })).not.toBeInTheDocument();
    await user.click(box.getByRole("link", { name: "INV-7" }));

    expect(opened()).toContain("/sales/history/sale-7");
  });

  it("UNKNOWN says so, and shows nothing else", async () => {
    await show({ acquisition: UNKNOWN_ACQUISITION });

    const box = section("Acquisition");
    expect(box).toHaveTextContent("No acquisition record is available for this unit.");
    expect(within(box).queryByText("Type")).not.toBeInTheDocument();
    expect(within(box).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("ProductUnitDetail: sales", () => {
  const sale = (overrides = {}) => ({
    id: "sale-7",
    sale_number: "INV-7",
    status: "COMPLETED",
    completed_at: "2026-10-20T04:00:00.000Z",
    voided_at: null,
    customer_name: "Nimal Silva",
    ...overrides,
  });
  const table = () => within(screen.getByRole("table", { name: "Sales history" }));

  it("shows a completed sale, with its completion date and customer", async () => {
    await show({ sales: [sale()] });

    expect(table().getByRole("link", { name: "INV-7" })).toHaveAttribute("href", "/sales/history/sale-7");
    expect(table().getByText("Completed")).toBeInTheDocument();
    expect(table().getByText("20 Oct 2026, 9:30 AM")).toBeInTheDocument();
    expect(table().getByText("Nimal Silva")).toBeInTheDocument();
    expect(table().queryByRole("link", { name: "Nimal Silva" })).not.toBeInTheDocument();
  });

  it("shows a walk-in for a sale with no customer", async () => {
    await show({ sales: [sale({ customer_name: null })] });

    expect(table().getByText("Walk-in")).toBeInTheDocument();
  });

  it("marks a voided sale, and shows its void date", async () => {
    await show({
      sales: [sale({ status: "VOIDED", voided_at: "2026-10-21T04:00:00.000Z" })],
    });

    expect(table().getByRole("link", { name: "INV-7 (voided)" })).toBeInTheDocument();
    expect(table().getByText("Voided")).toBeInTheDocument();
    expect(table().getByText("21 Oct 2026, 9:30 AM")).toBeInTheDocument();
    expect(table().queryByText("20 Oct 2026, 9:30 AM")).not.toBeInTheDocument();
  });

  it("says so when the unit was never sold", async () => {
    await show({ sales: [] });

    expect(within(section("Sales history")).getAllByText("This unit hasn't been sold.").length).toBeGreaterThan(0);
  });

  it("a sale link passes this page and how it was reached", async () => {
    const user = userEvent.setup();
    const reachedWith = { from: { search: "?status=SOLD&page=2" } };
    await show({ sales: [sale()] }, reachedWith);

    await user.click(table().getByRole("link", { name: "INV-7" }));

    expect(opened()).toBe(
      `/sales/history/sale-7 ${JSON.stringify({
        from: { path: "/inventory/units/unit-1", label: "Product unit", state: reachedWith },
      })}`,
    );
  });
});

describe("ProductUnitDetail: returns", () => {
  const ret = {
    id: "ret-1",
    return_number: "RET-20261022-0001",
    sale_id: "sale-7",
    sale_number: "INV-7",
    disposition: "INSPECTION",
    returned_at: "2026-10-22T04:00:00.000Z",
  };
  const table = () => within(screen.getByRole("table", { name: "Return history" }));

  it("shows a return, its sale, outcome and date", async () => {
    await show({ returns: [ret] });

    expect(table().getByText("RET-20261022-0001")).toBeInTheDocument();
    expect(table().getByRole("link", { name: "INV-7" })).toBeInTheDocument();
    expect(table().getByText("For inspection")).toBeInTheDocument();
    expect(table().getByText("22 Oct 2026, 9:30 AM")).toBeInTheDocument();
  });

  it("shows an outcome it doesn't know as sent", async () => {
    await show({ returns: [{ ...ret, disposition: "RESTOCKED" }] });

    expect(table().getByText("RESTOCKED")).toBeInTheDocument();
  });

  it("says so when there are none", async () => {
    await show({ returns: [] });

    expect(within(section("Return history")).getAllByText("No returns recorded.").length).toBeGreaterThan(0);
  });

  it("its sale link opens the Returns tab", async () => {
    const user = userEvent.setup();
    await show({ returns: [ret] });

    await user.click(table().getByRole("link", { name: "INV-7" }));

    expect(opened()).toContain("/sales/history/sale-7");
    expect(opened()).toContain('"tab":"returns"');
    expect(opened()).toContain('"path":"/inventory/units/unit-1"');
  });
});

describe("ProductUnitDetail: Back", () => {
  const back = () => screen.getByRole("link", { name: "Back to product units" });

  it("returns to the list with its filters", async () => {
    await show({}, { from: { search: "?status=SOLD&page=2" } });

    expect(back()).toHaveAttribute("href", "/inventory/units?status=SOLD&page=2");
  });

  it("goes to the plain list for a unit opened directly", async () => {
    await show();

    expect(back()).toHaveAttribute("href", "/inventory/units");
  });

  it("is there when the unit isn't found", async () => {
    productUnitsService.getProductUnitDetails.mockRejectedValue(notFound());
    renderPage();

    await screen.findByText("Unit not found");
    expect(back()).toBeInTheDocument();
  });
});

describe("ProductUnitDetail: states", () => {
  it("shows a skeleton while loading", () => {
    productUnitsService.getProductUnitDetails.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByRole("status", { name: "Loading unit" })).toBeInTheDocument();
  });

  it("a 404 is Unit not found, with no way to retry", async () => {
    productUnitsService.getProductUnitDetails.mockRejectedValue(notFound());
    renderPage();

    expect(await screen.findByText("Unit not found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("a malformed id (400) reads the same as a missing unit", async () => {
    productUnitsService.getProductUnitDetails.mockRejectedValue(httpError(400));
    renderPage(undefined, managerUser, "not-a-uuid");

    expect(await screen.findByText("Unit not found")).toBeInTheDocument();
  });

  it("a manager's other-branch unit reads exactly like a missing one", async () => {
    productUnitsService.getProductUnitDetails.mockRejectedValue(notFound());
    const other = renderPage(undefined, managerUser, "other-branch-unit");
    await screen.findByText("Unit not found");
    const otherText = other.container.textContent;
    other.unmount();

    productUnitsService.getProductUnitDetails.mockRejectedValue(notFound());
    const missing = renderPage(undefined, managerUser, "missing-unit");
    await screen.findByText("Unit not found");

    expect(missing.container.textContent).toBe(otherText);
  });

  it("a 403 says the unit isn't accessible, with no way to retry", async () => {
    productUnitsService.getProductUnitDetails.mockRejectedValue(httpError(403));
    renderPage();

    expect(await screen.findByText("Not accessible")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("any other failure offers Try again, which reloads", async () => {
    const user = userEvent.setup();
    productUnitsService.getProductUnitDetails.mockRejectedValueOnce(httpError(500));
    productUnitsService.getProductUnitDetails.mockResolvedValue(details());
    renderPage();

    await screen.findByText("Couldn't load this unit");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Galaxy A15" })).toBeInTheDocument();
    expect(productUnitsService.getProductUnitDetails).toHaveBeenCalledTimes(2);
  });

  it("a network failure with no response is an error, not a missing unit", async () => {
    productUnitsService.getProductUnitDetails.mockRejectedValue(new Error("Network Error"));
    renderPage();

    expect(await screen.findByText("Couldn't load this unit")).toBeInTheDocument();
  });

  it("an answer for an earlier unit can't replace the current one", async () => {
    let finishOlder;
    productUnitsService.getProductUnitDetails.mockImplementation((id) =>
      id === "older"
        ? new Promise((resolve) => { finishOlder = resolve; })
        : Promise.resolve(details({ product: { ...details().product, name: "Current unit" } })),
    );
    const { unmount } = renderWithProviders(
      <Routes>
        <Route path="/inventory/units/:id" element={<ProductUnitDetail />} />
        <Route path="*" element={<Probe />} />
      </Routes>,
      {
        route: "/inventory/units/older",
        preloadedState: { auth: authState(managerUser), branches: branchesState([mainShop]) },
      },
    );
    unmount();
    renderPage(undefined, managerUser, "current");
    await screen.findByRole("heading", { level: 1, name: "Current unit" });

    finishOlder(details({ product: { ...details().product, name: "Older unit" } }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText("Older unit")).not.toBeInTheDocument();
  });
});

describe("ProductUnitDetail: sensitive data", () => {
  it("shows none of it, even if a response wrongly carried it", async () => {
    const extra = {
      phone: "0771234567",
      nic: "199300000001",
      email: "kamal@details.test",
      address: "1 Galle Road",
      buying_price: "81234.00",
      selling_price: "101234.00",
      cost_price_snapshot: "81235.00",
      unit_buying_price: "81236.00",
      trade_in_buying_price: "81237.00",
      total_amount: "81238.00",
      amount: "81239.00",
      notes: "Private note",
      reason: "Private reason",
      override_reason: "Private override",
    };
    const { container } = await show({
      ...extra,
      unit: { ...details().unit, ...extra },
      product: { ...details().product, ...extra },
      branch: { ...details().branch, ...extra },
      acquisition: {
        ...UNKNOWN_ACQUISITION,
        ...extra,
        type: "PHONE_PURCHASE",
        date: "2026-10-01T04:00:00.000Z",
        customer_name: "Kamal Perera",
      },
      sales: [
        {
          ...extra,
          id: "sale-7",
          sale_number: "INV-7",
          status: "COMPLETED",
          completed_at: "2026-10-20T04:00:00.000Z",
          voided_at: null,
          customer_name: "Kamal Perera",
        },
      ],
      returns: [
        {
          ...extra,
          id: "ret-1",
          return_number: "RET-1",
          sale_id: "sale-7",
          sale_number: "INV-7",
          disposition: "INSPECTION",
          returned_at: "2026-10-22T04:00:00.000Z",
        },
      ],
    });

    for (const value of Object.values(extra)) {
      expect(container).not.toHaveTextContent(value);
    }
  });
});

describe("ProductUnitDetail: route access", () => {
  const renderApp = async (user) => {
    const { getCurrentUser } = await import("../../services/authService");
    getCurrentUser.mockResolvedValue({ user });
    productUnitsService.getProductUnitDetails.mockResolvedValue(details());
    return renderWithProviders(<App />, {
      route: "/inventory/units/unit-1",
      preloadedState: { auth: authState(user), branches: branchesState([mainShop]) },
    });
  };

  it.each([
    ["an admin", adminUser],
    ["a manager", managerUser],
  ])("%s can open the page", async (_, user) => {
    await renderApp(user);

    expect(await screen.findByRole("heading", { level: 1, name: "Galaxy A15" })).toBeInTheDocument();
  });

  it("a cashier is turned away, and the API is not called", async () => {
    await renderApp(cashierUser);

    expect(await screen.findByRole("link", { name: "Customers" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("heading", { level: 1, name: "Galaxy A15" })).not.toBeInTheDocument(),
    );
    expect(productUnitsService.getProductUnitDetails).not.toHaveBeenCalled();
  });
});
