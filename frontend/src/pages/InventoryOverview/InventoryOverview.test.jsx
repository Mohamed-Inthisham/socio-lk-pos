import { StrictMode } from "react";
import { vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import InventoryOverview from ".";
import api from "../../services/api";
import { getStockOverview } from "../../services/stockService";
import { authState, branchesState, createTestStore, renderWithProviders } from "../../test/renderWithProviders";
import { adminUser, cashierUser, cityShop, closedShop, mainShop } from "../../test/fixtures";

// The real stockService, with only the HTTP client mocked: checks the request
// that leaves the browser, and no test can reach a backend.
vi.mock("../../services/api", () => ({ default: { get: vi.fn() } }));

const managerUser = { ...cashierUser, id: "user-manager", role: "manager" };

const BUYING = "52123.00";

const branchRow = (branch, overrides = {}) => ({
  id: branch.id,
  name: branch.name,
  is_active: true,
  quantity: 3,
  min_quantity: 1,
  manage_stock: true,
  stock_status: "IN_STOCK",
  ...overrides,
});

const product = (overrides = {}) => ({
  id: "p-phone",
  name: "Galaxy A15",
  sku: "SKU-000007",
  tracking_method: "IMEI",
  is_active: true,
  selling_price: "64990.00",
  brand: { id: "b1", name: "Samsung" },
  category: { id: "c1", name: "Phones" },
  stock_status: "LOW_STOCK",
  quantity: 3,
  min_quantity: 5,
  units: { in_stock: 3, inspection: 1 },
  branches: [branchRow(mainShop)],
  ...overrides,
});

const cable = product({
  id: "p-cable",
  name: "USB Cable",
  sku: "SKU-000008",
  tracking_method: "QUANTITY",
  stock_status: "IN_STOCK",
  quantity: 12,
  min_quantity: 2,
  units: null,
});
const reload = product({
  id: "p-reload",
  name: "Mobile Reload",
  sku: "SKU-000009",
  tracking_method: "QUANTITY",
  selling_price: null,
  stock_status: "NOT_TRACKED",
  quantity: null,
  min_quantity: 0,
  units: null,
  branches: [branchRow(mainShop, { quantity: null, manage_stock: false, stock_status: "NOT_TRACKED" })],
});

// Every GET goes through api.get: the overview's are answered by overviewGet,
// the branch list by branchList.
const overviewGet = vi.fn();
let branchList;

const SUMMARY = { total_products: 120, in_stock: 70, low_stock: 20, out_of_stock: 25, not_tracked: 5, total_quantity: 942 };

const overview = (rows, { total = rows.length, totalPages = rows.length ? 1 : 0, summary = SUMMARY } = {}) => ({
  data: rows,
  summary,
  meta: { total, page: 1, limit: 25, totalPages, hasNext: false, hasPrev: false },
});
const answer = (rows) => overviewGet.mockResolvedValue({ data: overview(rows) });

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

const UrlProbe = () => <p data-testid="url">{useLocation().search}</p>;

const renderAs = (user = adminUser, route = "/inventory") =>
  renderWithProviders(<><UrlProbe /><InventoryOverview /></>, {
    route,
    preloadedState: { auth: authState(user), branches: branchesState([mainShop, cityShop]) },
  });

const url = () => screen.getByTestId("url").textContent;
const lastParams = () => overviewGet.mock.lastCall[1].params;
const card = (label) => screen.getByText(label, { selector: "dt" }).nextElementSibling;
const heading = () => screen.getByRole("heading", { level: 2 });
const searchBox = () => screen.getByRole("searchbox", { name: "Search products" });
const inactiveBox = () => screen.getByRole("checkbox", { name: "Include inactive products" });
const pick = async (user, current, name) => {
  await user.click(screen.getByRole("button", { name: current }));
  await user.click(await screen.findByRole("option", { name }));
};

const table = () => screen.findByRole("table", { name: "Inventory overview" });
const rowOf = async (text) => within(await table()).getByText(text).closest("tr");
// The table is there while it loads; this waits for an answer's rows.
const rows = () => screen.findAllByText("Galaxy A15");
const cells = (row) => within(row).getAllByRole("cell");

describe("InventoryOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    overviewGet.mockReset();
    branchList = [mainShop, cityShop, closedShop];
    api.get.mockImplementation((url, config) =>
      url === "/branches" ? Promise.resolve({ data: branchList }) : overviewGet(url, config),
    );
  });

  it("asks /stock/overview for the first page, with no branch", async () => {
    answer([]);

    renderAs();

    await screen.findAllByText("No products to show.");
    expect(overviewGet).toHaveBeenCalledTimes(1);
    expect(overviewGet).toHaveBeenCalledWith("/stock/overview", { params: { page: 1, limit: 25, includeInactive: false } });
  });

  it("shows the title and a product's details", async () => {
    answer([product()]);

    renderAs();

    expect(screen.getByRole("heading", { level: 1, name: "Inventory Overview" })).toBeInTheDocument();
    const row = await rowOf("Galaxy A15");
    expect(row).toHaveTextContent("SKU-000007");
    expect(row).toHaveTextContent("IMEI");
    expect(row).toHaveTextContent("64,990.00");
    expect(row).toHaveTextContent("Low stock");
    expect(row).toHaveTextContent("Min 5");
    expect(row).toHaveTextContent("3 in stock");
    expect(row).toHaveTextContent("1 in inspection");
  });

  it("names each tracking method", async () => {
    answer([cable, product({ id: "p-tab", name: "Tab S9", tracking_method: "SERIAL_NUMBER" })]);

    renderAs();

    expect(await rowOf("USB Cable")).toHaveTextContent("Quantity");
    expect(await rowOf("Tab S9")).toHaveTextContent("Serial number");
  });

  it("leaves inspection out when none is waiting", async () => {
    answer([product({ units: { in_stock: 2, inspection: 0 } })]);

    renderAs();

    expect(await rowOf("Galaxy A15")).not.toHaveTextContent("inspection");
  });

  it("shows a dash, not unit counts, for a QUANTITY product", async () => {
    answer([cable]);

    renderAs();

    const [, , , quantity, units] = cells(await rowOf("USB Cable"));
    expect(quantity).toHaveTextContent("12");
    expect(units).toHaveTextContent(/^—$/);
  });

  it("shows a NOT_TRACKED product with a dash and no zero or minimum", async () => {
    answer([reload]);

    renderAs();

    const row = await rowOf("Mobile Reload");
    const [, , status, quantity] = cells(row);
    expect(status).toHaveTextContent("Not tracked");
    expect(quantity).toHaveTextContent(/^—$/);
    expect(row).not.toHaveTextContent("Min");
  });

  it("shows a real zero for a product out of stock", async () => {
    answer([product({ stock_status: "OUT_OF_STOCK", quantity: 0, min_quantity: 0, branches: [] })]);

    renderAs();

    const [, , status, quantity, , branches] = cells(await rowOf("Galaxy A15"));
    expect(status).toHaveTextContent("Out of stock");
    expect(quantity).toHaveTextContent("0");
    expect(branches).toHaveTextContent(/^—$/);
  });

  it("shows a dash for a product with no selling price", async () => {
    answer([reload]);

    renderAs();

    const [, price] = cells(await rowOf("Mobile Reload"));
    expect(price).toHaveTextContent(/^—$/);
  });

  it("never shows a buying price, even if one arrived", async () => {
    answer([product({ buying_price: BUYING, cost_price: BUYING })]);

    renderAs();

    await table();
    expect(document.body).not.toHaveTextContent("52,123");
    expect(document.body).not.toHaveTextContent(BUYING);
    expect(screen.queryByRole("columnheader", { name: /cost|buying/i })).not.toBeInTheDocument();
  });

  it("shows skeletons while loading", () => {
    overviewGet.mockReturnValue(new Promise(() => {}));

    renderAs();

    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when there are no products", async () => {
    answer([]);

    renderAs();

    expect(await screen.findAllByText("No products to show.")).not.toHaveLength(0);
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });

  it("offers Try again after a failure, and recovers", async () => {
    const user = userEvent.setup();
    overviewGet.mockRejectedValueOnce(new Error("network"));

    renderAs();

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load the inventory overview. Try again.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    answer([product()]);
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await rowOf("Galaxy A15")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(overviewGet).toHaveBeenCalledTimes(2);
  });

  it("keeps the newest answer when an older one arrives late", async () => {
    const older = deferred();
    const newer = deferred();
    overviewGet.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    // StrictMode at the root runs the effect twice: two requests in flight.
    render(
      <StrictMode>
        <Provider store={createTestStore({ auth: authState(adminUser) })}>
          <MemoryRouter><InventoryOverview /></MemoryRouter>
        </Provider>
      </StrictMode>,
    );
    await waitFor(() => expect(overviewGet).toHaveBeenCalledTimes(2));

    await act(async () => { newer.resolve({ data: overview([cable]) }); });
    await act(async () => { older.resolve({ data: overview([product()]) }); });

    expect(await rowOf("USB Cable")).toBeInTheDocument();
    expect(within(await table()).queryByText("Galaxy A15")).not.toBeInTheDocument();
  });

  describe("branches", () => {
    const charger = product({
      name: "Fast Charger",
      tracking_method: "QUANTITY",
      units: null,
      stock_status: "IN_STOCK",
      quantity: 11,
      min_quantity: 4,
      branches: [
        branchRow(cityShop, { quantity: 1, min_quantity: 2, stock_status: "LOW_STOCK" }),
        branchRow(mainShop, { quantity: 10, min_quantity: 2 }),
        branchRow({ id: "b-closed", name: "Closed Shop" }, { is_active: false, quantity: null, manage_stock: false, stock_status: "NOT_TRACKED" }),
      ],
    });

    it("opens each branch's stock for an admin, marking an inactive one and hiding an untracked quantity", async () => {
      const user = userEvent.setup();
      answer([charger]);

      renderAs();

      const row = await rowOf("Fast Charger");
      await user.click(within(row).getByRole("button", { name: "Branches for Fast Charger" }));

      const dialog = await screen.findByRole("dialog", { name: "Fast Charger" });
      const items = within(dialog).getAllByRole("listitem");
      expect(items).toHaveLength(3);
      expect(items[0]).toHaveTextContent("City Shop");
      expect(items[0]).toHaveTextContent("1 / min 2");
      expect(items[0]).toHaveTextContent("Low stock");
      expect(items[1]).toHaveTextContent("10 / min 2");
      expect(items[2]).toHaveTextContent("Inactive branch");
      expect(items[2]).toHaveTextContent("Not tracked");
      expect(items[2]).not.toHaveTextContent("min");
    });

    it("flags a shortage at a branch when the combined status looks fine", async () => {
      answer([charger]);

      renderAs();

      const row = await rowOf("Fast Charger");
      expect(row).toHaveTextContent("In stock");
      expect(row).toHaveTextContent("3 branches");
      expect(row).toHaveTextContent("1 low or out");
    });

    it("says nothing when no branch is short", async () => {
      answer([product()]);

      renderAs();

      const row = await rowOf("Galaxy A15");
      expect(row).toHaveTextContent("1 branch");
      expect(row).not.toHaveTextContent("low or out");
    });

    it("has no Branches column for a manager, who has only their own", async () => {
      answer([charger]);

      renderAs(managerUser);

      await table();
      expect(screen.queryByRole("columnheader", { name: "Branches" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Branches for/ })).not.toBeInTheDocument();
    });
  });

  it("renders the same rows as cards on a small screen", async () => {
    answer([product()]);

    renderAs();

    await table();
    const card = screen.getByRole("list", { name: "Inventory overview" });
    expect(within(card).getByText("Galaxy A15")).toBeInTheDocument();
    expect(within(card).getByText("Quantity")).toBeInTheDocument();
    expect(within(card).getByText("Identified units")).toBeInTheDocument();
  });

  describe("summary and heading", () => {
    it("shows the backend's figures, not a count of the rows on the page", async () => {
      answer([product()]);

      renderAs();

      await table();
      expect(card("Total products")).toHaveTextContent("120");
      expect(card("In stock")).toHaveTextContent("70");
      expect(card("Low stock")).toHaveTextContent("20");
      expect(card("Out of stock")).toHaveTextContent("25");
      expect(card("Not tracked")).toHaveTextContent("5");
      expect(card("Total quantity")).toHaveTextContent("942");
    });

    it("takes the heading's count from meta, while the table shows one page", async () => {
      overviewGet.mockResolvedValue({ data: overview([product()], { total: 60, totalPages: 3 }) });

      renderAs();

      await table();
      expect(heading()).toHaveTextContent("Products (60)");
      expect(within(await table()).getAllByRole("row")).toHaveLength(2);
    });

    it("shows no count and no figures before the first answer", () => {
      overviewGet.mockReturnValue(new Promise(() => {}));

      renderAs();

      expect(heading()).toHaveTextContent(/^Products$/);
      expect(card("Total products")).toHaveTextContent("—");
    });

    it("shows a real zero when the backend counts none", async () => {
      overviewGet.mockResolvedValue({ data: overview([], { summary: { ...SUMMARY, total_products: 0 } }) });

      renderAs();

      await waitFor(() => expect(heading()).toHaveTextContent("Products (0)"));
      expect(card("Total products")).toHaveTextContent("0");
    });

    it("keeps the cards when the page changes", async () => {
      const user = userEvent.setup();
      overviewGet.mockResolvedValue({ data: overview([product()], { total: 60, totalPages: 3 }) });

      renderAs();

      await user.click(await screen.findByRole("button", { name: "Next" }));

      await waitFor(() => expect(lastParams().page).toBe(2));
      await table();
      expect(card("Total products")).toHaveTextContent("120");
    });

    it("keeps the cards under a status filter, while the count follows it", async () => {
      const user = userEvent.setup();
      answer([product()]);

      renderAs();
      await table();
      overviewGet.mockResolvedValue({ data: overview([cable], { total: 20 }) });

      await pick(user, /All statuses/, "Low stock");

      await waitFor(() => expect(heading()).toHaveTextContent("Products (20)"));
      expect(card("Low stock")).toHaveTextContent("20");
      expect(card("Total products")).toHaveTextContent("120");
    });

    it("blanks the figures after a failure, so they can't describe other filters", async () => {
      const user = userEvent.setup();
      answer([product()]);

      renderAs();
      await table();
      overviewGet.mockRejectedValue(new Error("network"));

      await pick(user, /All statuses/, "Low stock");

      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(card("Total products")).toHaveTextContent("—");
      expect(heading()).toHaveTextContent(/^Products$/);
    });
  });

  describe("request parameters", () => {
    it("keeps includeInactive=false and leaves out empty values", async () => {
      overviewGet.mockResolvedValue({ data: overview([]) });

      await getStockOverview({ page: 2, limit: 25, includeInactive: false, branchId: "", search: "", stockStatus: "" });

      expect(overviewGet).toHaveBeenCalledWith("/stock/overview", {
        params: { page: 2, limit: 25, includeInactive: false },
      });
    });

    it("sends every filter that has a value", async () => {
      overviewGet.mockResolvedValue({ data: overview([]) });

      await getStockOverview({ includeInactive: true, branchId: "b1", search: "ga", stockStatus: "LOW_STOCK" });

      expect(overviewGet).toHaveBeenCalledWith("/stock/overview", {
        params: { includeInactive: true, branchId: "b1", search: "ga", stockStatus: "LOW_STOCK" },
      });
    });
  });

  describe("the URL", () => {
    it("restores every filter and the page", async () => {
      overviewGet.mockResolvedValue({ data: overview([product()], { total: 60, totalPages: 3 }) });

      renderAs(adminUser, `/inventory?search=galaxy&stockStatus=LOW_STOCK&branchId=${cityShop.id}&includeInactive=true&page=2`);

      await rows();
      expect(lastParams()).toEqual({
        page: 2,
        limit: 25,
        includeInactive: true,
        branchId: cityShop.id,
        search: "galaxy",
        stockStatus: "LOW_STOCK",
      });
      expect(searchBox()).toHaveValue("galaxy");
      expect(inactiveBox()).toBeChecked();
      expect(screen.getByRole("button", { name: /Low stock/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /City Shop/ })).toBeInTheDocument();
      expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    });

    it("reads values that aren't valid as the defaults", async () => {
      answer([product()]);

      renderAs(adminUser, "/inventory?stockStatus=SOLD&page=abc&includeInactive=yes&search=a");

      await table();
      expect(lastParams()).toEqual({ page: 1, limit: 25, includeInactive: false });
    });

    it("restores an inactive branch, and offers it marked as inactive", async () => {
      const user = userEvent.setup();
      answer([product()]);

      renderAs(adminUser, `/inventory?branchId=${closedShop.id}`);

      await rows();
      expect(lastParams().branchId).toBe(closedShop.id);
      await user.click(await screen.findByRole("button", { name: /Closed Shop \(inactive\)/ }));
      expect(await screen.findByRole("option", { name: "Closed Shop (inactive)" })).toBeInTheDocument();
    });

    describe("a branch in the URL", () => {
      // The branch list stays out until the test lets it arrive.
      const holdBranches = () => {
        const list = deferred();
        api.get.mockImplementation((path, config) =>
          path === "/branches" ? list.promise : overviewGet(path, config),
        );
        return { arrive: () => act(async () => { list.resolve({ data: branchList }); }) };
      };

      it("waits for the branch list, then asks once for a valid branch", async () => {
        const { arrive } = holdBranches();
        answer([product()]);

        renderAs(adminUser, `/inventory?branchId=${closedShop.id}`);
        await act(async () => {});

        expect(overviewGet).not.toHaveBeenCalled();
        expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

        await arrive();

        await table();
        expect(overviewGet).toHaveBeenCalledTimes(1);
        expect(lastParams().branchId).toBe(closedShop.id);
        expect(url()).toBe(`?branchId=${closedShop.id}`);
      });

      it("removes an unknown branch and asks once for All branches, never for it", async () => {
        const { arrive } = holdBranches();
        answer([product()]);

        renderAs(adminUser, "/inventory?branchId=branch-gone");
        await act(async () => {});
        expect(overviewGet).not.toHaveBeenCalled();

        await arrive();

        await table();
        expect(url()).toBe("");
        expect(overviewGet).toHaveBeenCalledTimes(1);
        expect(lastParams()).toEqual({ page: 1, limit: 25, includeInactive: false });
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /All branches/ })).toBeInTheDocument();
      });

      it("keeps the other filters when it removes one, and leaves its page", async () => {
        answer([product()]);

        renderAs(adminUser, "/inventory?branchId=branch-gone&stockStatus=LOW_STOCK&includeInactive=true&page=2");

        await rows();
        expect(url()).toBe("?stockStatus=LOW_STOCK&includeInactive=true");
        expect(overviewGet).toHaveBeenCalledTimes(1);
        expect(lastParams()).toEqual({ page: 1, limit: 25, includeInactive: true, stockStatus: "LOW_STOCK" });
      });

      it("doesn't wait when the URL names no branch", async () => {
        holdBranches();
        answer([product()]);

        renderAs();

        await table();
        expect(overviewGet).toHaveBeenCalledTimes(1);
      });

      it("doesn't ask again when the list arrives and the URL names no branch", async () => {
        const { arrive } = holdBranches();
        answer([product()]);

        renderAs();
        await table();
        await arrive();

        expect(overviewGet).toHaveBeenCalledTimes(1);
      });

      it("drops an answer in flight when the URL moves to a branch still being checked", async () => {
        const { arrive } = holdBranches();
        const older = deferred();
        overviewGet.mockReturnValueOnce(older.promise);
        const user = userEvent.setup();

        renderWithProviders(
          <>
            <UrlProbe />
            <Link to={`/inventory?branchId=${cityShop.id}`}>Open City Shop</Link>
            <InventoryOverview />
          </>,
          { route: "/inventory", preloadedState: { auth: authState(adminUser), branches: branchesState([mainShop]) } },
        );
        await waitFor(() => expect(overviewGet).toHaveBeenCalledTimes(1));

        await user.click(screen.getByRole("link", { name: "Open City Shop" }));
        await act(async () => { older.resolve({ data: overview([product()]) }); });

        expect(screen.queryByText("Galaxy A15")).not.toBeInTheDocument();
        expect(heading()).toHaveTextContent(/^Products$/);

        answer([cable]);
        await arrive();

        expect(await rowOf("USB Cable")).toBeInTheDocument();
        expect(screen.queryByText("Galaxy A15")).not.toBeInTheDocument();
        expect(overviewGet).toHaveBeenCalledTimes(2);
        expect(lastParams().branchId).toBe(cityShop.id);
      });

      it("still shows a genuine failure for a valid branch, and retries it", async () => {
        const user = userEvent.setup();
        overviewGet.mockRejectedValueOnce(new Error("network"));

        renderAs(adminUser, `/inventory?branchId=${cityShop.id}`);

        expect(await screen.findByRole("alert")).toBeInTheDocument();
        expect(url()).toBe(`?branchId=${cityShop.id}`);

        answer([product()]);
        await user.click(screen.getByRole("button", { name: "Try again" }));

        await table();
        expect(lastParams().branchId).toBe(cityShop.id);
      });

      it("shows the backend's refusal when the list failed and the branch can't be checked", async () => {
        api.get.mockImplementation((path, config) =>
          path === "/branches" ? Promise.reject(new Error("network")) : overviewGet(path, config),
        );
        overviewGet.mockRejectedValue({ response: { status: 404 } });

        renderAs(adminUser, "/inventory?branchId=branch-gone");

        expect(await screen.findByRole("alert")).toBeInTheDocument();
        expect(lastParams().branchId).toBe("branch-gone");
        expect(url()).toBe("?branchId=branch-gone");
      });

      it("never waits for a manager, who has no list", async () => {
        answer([product()]);

        renderAs(managerUser, "/inventory?branchId=branch-gone");

        await table();
        expect(overviewGet).toHaveBeenCalledTimes(1);
        expect(lastParams().branchId).toBeUndefined();
      });
    });

    it("keeps the URL's branch for the backend if the branch list fails", async () => {
      api.get.mockImplementation((path, config) =>
        path === "/branches" ? Promise.reject(new Error("network")) : overviewGet(path, config),
      );
      answer([product()]);

      renderAs(adminUser, `/inventory?branchId=${closedShop.id}`);

      await rows();
      expect(lastParams().branchId).toBe(closedShop.id);
    });

    it("ignores a branchId for a manager, who has no picker", async () => {
      answer([product()]);

      renderAs(managerUser, `/inventory?branchId=${cityShop.id}`);

      await table();
      expect(lastParams().branchId).toBeUndefined();
      expect(screen.queryByRole("button", { name: /All branches/ })).not.toBeInTheDocument();
      expect(api.get).not.toHaveBeenCalledWith("/branches", expect.anything());
    });
  });

  describe("filters", () => {
    it("sets the status in the URL and goes back to the first page", async () => {
      const user = userEvent.setup();
      overviewGet.mockResolvedValue({ data: overview([product()], { total: 60, totalPages: 3 }) });

      renderAs(adminUser, "/inventory?page=2");
      await table();

      await pick(user, /All statuses/, "Out of stock");

      await waitFor(() => expect(url()).toBe("?stockStatus=OUT_OF_STOCK"));
      expect(lastParams()).toEqual({ page: 1, limit: 25, includeInactive: false, stockStatus: "OUT_OF_STOCK" });
    });

    it("sets the branch and keeps the other filters", async () => {
      const user = userEvent.setup();
      answer([product()]);

      renderAs(adminUser, "/inventory?stockStatus=LOW_STOCK");
      await table();

      await pick(user, /All branches/, "City Shop");

      await waitFor(() => expect(url()).toBe(`?stockStatus=LOW_STOCK&branchId=${cityShop.id}`));
      expect(lastParams()).toMatchObject({ branchId: cityShop.id, stockStatus: "LOW_STOCK" });
    });

    it("puts includeInactive in the URL only when on, and always sends it", async () => {
      const user = userEvent.setup();
      answer([product()]);

      renderAs();
      await table();

      await user.click(inactiveBox());
      await waitFor(() => expect(url()).toBe("?includeInactive=true"));
      await waitFor(() => expect(lastParams().includeInactive).toBe(true));

      await user.click(inactiveBox());
      await waitFor(() => expect(url()).toBe(""));
      await waitFor(() => expect(lastParams().includeInactive).toBe(false));
    });

    it("marks an inactive product", async () => {
      answer([product({ is_active: false })]);

      renderAs();

      expect(await rowOf("Galaxy A15")).toHaveTextContent("Inactive");
    });

    it("searches after the typing stops, and goes back to the first page", async () => {
      const user = userEvent.setup();
      answer([product()]);

      renderAs(adminUser, "/inventory?page=1");
      await table();
      const before = overviewGet.mock.calls.length;

      await user.type(searchBox(), "gal");

      await waitFor(() => expect(url()).toBe("?search=gal"));
      await waitFor(() => expect(lastParams().search).toBe("gal"));
      expect(overviewGet.mock.calls.length).toBe(before + 1);
    });

    it("waits for two characters", async () => {
      const user = userEvent.setup();
      answer([product()]);

      renderAs();
      await table();
      const before = overviewGet.mock.calls.length;

      await user.type(searchBox(), "g{Enter}");

      expect(screen.getByText("Type at least 2 characters to search.")).toBeInTheDocument();
      expect(url()).toBe("");
      expect(overviewGet.mock.calls.length).toBe(before);
    });

    it("clears every filter from the URL and asks for the defaults", async () => {
      const user = userEvent.setup();
      answer([product()]);

      renderAs(adminUser, `/inventory?search=galaxy&stockStatus=LOW_STOCK&branchId=${cityShop.id}&includeInactive=true&page=2`);
      await table();

      await user.click(screen.getByRole("button", { name: "Clear filters" }));

      await waitFor(() => expect(url()).toBe(""));
      await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 25, includeInactive: false }));
      expect(searchBox()).toHaveValue("");
      expect(inactiveBox()).not.toBeChecked();
      expect(screen.getByRole("button", { name: /All statuses/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /All branches/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    });

    it("cancels a waiting search when the filters are cleared", async () => {
      const user = userEvent.setup();
      answer([product()]);

      renderAs();
      await table();

      await user.type(searchBox(), "gal");
      await user.click(screen.getByRole("button", { name: "Clear filters" }));
      await new Promise((resolve) => { setTimeout(resolve, 350); });

      expect(url()).toBe("");
      expect(searchBox()).toHaveValue("");
    });

    it("offers no Clear filters without a filter", async () => {
      answer([product()]);

      renderAs();

      await table();
      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    });

    it.each([
      ["/inventory?search=galaxy", "No products match “galaxy”."],
      ["/inventory?stockStatus=LOW_STOCK", "No products match these filters."],
    ])("says why %s is empty", async (route, message) => {
      answer([]);

      renderAs(adminUser, route);

      expect(await screen.findAllByText(message)).not.toHaveLength(0);
    });
  });

  describe("pagination", () => {
    const threePages = () =>
      overviewGet.mockResolvedValue({ data: overview([product()], { total: 60, totalPages: 3 }) });

    it("moves between pages through the URL, with the first page left out", async () => {
      const user = userEvent.setup();
      threePages();

      renderAs();

      await user.click(await screen.findByRole("button", { name: "Next" }));
      await waitFor(() => expect(url()).toBe("?page=2"));
      await waitFor(() => expect(lastParams().page).toBe(2));
      expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();

      await waitFor(() => expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: "Previous" }));
      await waitFor(() => expect(url()).toBe(""));
      await waitFor(() => expect(lastParams().page).toBe(1));
    });

    it("keeps the filters when the page changes", async () => {
      const user = userEvent.setup();
      threePages();

      renderAs(adminUser, "/inventory?stockStatus=LOW_STOCK");

      await user.click(await screen.findByRole("button", { name: "Next" }));

      await waitFor(() => expect(url()).toBe("?stockStatus=LOW_STOCK&page=2"));
      await waitFor(() => expect(lastParams()).toMatchObject({ page: 2, stockStatus: "LOW_STOCK" }));
    });

    it("stops at each end", async () => {
      threePages();

      renderAs(adminUser, "/inventory?page=3");

      await table();
      expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    });

    it("has no pager for one page", async () => {
      answer([product()]);

      renderAs();

      await table();
      expect(screen.queryByRole("navigation", { name: "Inventory pages" })).not.toBeInTheDocument();
    });

    it("moves a page past the end to the last page", async () => {
      overviewGet.mockResolvedValue({ data: overview([], { total: 60, totalPages: 3 }) });

      renderAs(adminUser, "/inventory?page=9");

      await waitFor(() => expect(url()).toBe("?page=3"));
      await waitFor(() => expect(lastParams().page).toBe(3));
    });

    it("drops the page when nothing matches at all", async () => {
      answer([]);

      renderAs(adminUser, "/inventory?stockStatus=LOW_STOCK&page=4");

      await waitFor(() => expect(url()).toBe("?stockStatus=LOW_STOCK"));
    });
  });
});
