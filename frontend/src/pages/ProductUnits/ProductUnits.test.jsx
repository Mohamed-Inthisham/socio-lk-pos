import { vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import ProductUnits from ".";
import App from "../../App";
import api from "../../services/api";
import * as productUnitsService from "../../services/productUnitsService";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { adminUser, cashierUser, cityShop, mainShop } from "../../test/fixtures";

vi.mock("../../services/productUnitsService", async (importOriginal) => ({
  ...(await importOriginal()),
  listProductUnits: vi.fn(),
  searchProductUnits: vi.fn(),
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

const renderAs = (user, route = "/inventory/units", branches = branchesState([mainShop, cityShop])) =>
  renderWithProviders(
    <>
      <UrlProbe />
      <Link to="/inventory/units">Sidebar link</Link>
      <Routes>
        <Route path="/inventory/units" element={<ProductUnits />} />
        <Route path="/inventory/units/:id" element={<UnitPage />} />
      </Routes>
    </>,
    {
      route,
      preloadedState: { auth: authState(user), branches },
    },
  );

const UnitPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p>Opened {location.pathname}</p>
      <p>From {location.state?.from?.search || "the plain list"}</p>
      <button type="button" onClick={() => navigate(-1)}>Browser back</button>
    </>
  );
};
const UrlProbe = () => <p data-testid="url">{useLocation().search}</p>;

const lastParams = () => productUnitsService.listProductUnits.mock.lastCall[0];
const lastSearch = () => productUnitsService.searchProductUnits.mock.lastCall[0];
const searchBox = () => screen.getByLabelText("Search product units");
const table = () => screen.getByRole("table", { name: "Product units" });
const row = (text) => within(table()).getByText(text).closest("tr");
const pickStatus = async (user, name) => {
  await user.click(screen.getByRole("button", { name: /All statuses/ }));
  await user.click(await screen.findByRole("option", { name }));
};

beforeEach(() => {
  vi.resetAllMocks();
  productUnitsService.listProductUnits.mockResolvedValue(page([unit()]));
  productUnitsService.searchProductUnits.mockResolvedValue(page([unit()]));
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
    expect(screen.getByText(/Finds part of an IMEI, serial number, SKU or product name/)).toBeInTheDocument();
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

  it("opens the unit on a row click", async () => {
    const user = userEvent.setup();
    renderAs(managerUser);

    await screen.findAllByText(IMEI);
    await user.click(row(IMEI));

    expect(await screen.findByText("Opened /inventory/units/unit-1")).toBeInTheDocument();
    expect(screen.getByText("From the plain list")).toBeInTheDocument();
  });

  it("a row click carries the list's filters", async () => {
    const user = userEvent.setup();
    renderAs(managerUser, "/inventory/units?status=SOLD&page=2");

    await screen.findAllByText(IMEI);
    await user.click(row(IMEI));

    expect(await screen.findByText("From ?status=SOLD&page=2")).toBeInTheDocument();
  });

  it("browser Back from a unit restores the filters and page", async () => {
    const user = userEvent.setup();
    productUnitsService.listProductUnits.mockResolvedValue(page([unit()], { total: 60, totalPages: 3 }));
    renderAs(managerUser, "/inventory/units?status=SOLD&page=2");

    await screen.findAllByText(IMEI);
    await user.click(row(IMEI));
    await screen.findByText("Opened /inventory/units/unit-1");
    productUnitsService.listProductUnits.mockClear();
    await user.click(screen.getByRole("button", { name: "Browser back" }));

    await screen.findByText("Page 2 of 3");
    expect(lastParams()).toEqual({ page: 2, limit: 25, status: "SOLD" });
  });

  it("browser Back from a unit restores a search, its page and the waiting status", async () => {
    const user = userEvent.setup();
    productUnitsService.searchProductUnits.mockResolvedValue(page([unit()], { total: 60, totalPages: 3 }));
    renderAs(managerUser, "/inventory/units?q=gal&status=SOLD&page=2");

    await screen.findAllByText(IMEI);
    await user.click(row(IMEI));
    await screen.findByText("From ?q=gal&status=SOLD&page=2");
    productUnitsService.searchProductUnits.mockClear();
    await user.click(screen.getByRole("button", { name: "Browser back" }));

    await screen.findByText("Page 2 of 3");
    expect(lastSearch()).toEqual({ page: 2, limit: 25, q: "gal" });
    expect(searchBox()).toHaveValue("gal");
    expect(screen.getByTestId("url")).toHaveTextContent("?q=gal&status=SOLD&page=2");
    expect(productUnitsService.listProductUnits).not.toHaveBeenCalled();
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

describe("ProductUnits: the URL", () => {
  const url = () => screen.getByTestId("url").textContent;

  it("reads the status, branch and page from the URL", async () => {
    renderAs(adminUser, `/inventory/units?status=SOLD&branchId=${cityShop.id}&page=2`);

    await screen.findAllByText(IMEI);
    expect(lastParams()).toEqual({
      page: 2,
      limit: 25,
      status: "SOLD",
      branchId: cityShop.id,
    });
    expect(screen.getByRole("button", { name: /Sold/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /City Shop/ })).toBeInTheDocument();
  });

  it("reads a search from the URL, with its branch and page", async () => {
    renderAs(adminUser, `/inventory/units?q=gal&status=SOLD&branchId=${cityShop.id}&page=2`);

    await screen.findAllByText(IMEI);
    expect(lastSearch()).toEqual({ page: 2, limit: 25, q: "gal", branchId: cityShop.id });
    expect(searchBox()).toHaveValue("gal");
    expect(screen.getByRole("button", { name: /City Shop/ })).toBeInTheDocument();
    expect(productUnitsService.listProductUnits).not.toHaveBeenCalled();
  });

  it("writes a filter to the URL and drops the page", async () => {
    const user = userEvent.setup();
    renderAs(managerUser, "/inventory/units?page=3");
    await screen.findAllByText(IMEI);

    await pickStatus(user, "Sold");

    await waitFor(() => expect(url()).toBe("?status=SOLD"));
  });

  it("writes the search to the URL as q, and Clear removes it", async () => {
    const user = userEvent.setup();
    renderAs(managerUser);
    await screen.findAllByText(IMEI);

    await user.type(searchBox(), `${IMEI}{Enter}`);
    await waitFor(() => expect(url()).toBe(`?q=${IMEI}`));

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(url()).toBe(""));
  });

  it("writes the page to the URL, and leaves page 1 out", async () => {
    const user = userEvent.setup();
    productUnitsService.listProductUnits.mockResolvedValue(page([unit()], { total: 60, totalPages: 3 }));
    renderAs(managerUser);
    await screen.findAllByText(IMEI);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(url()).toBe("?page=2"));
    await screen.findByText("Page 2 of 3");

    await user.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(url()).toBe(""));
  });

  it.each([
    ["an unknown status", "status=LOST"],
    ["a name every object has", "status=constructor"],
    ["a page that isn't a number", "page=abc"],
    ["a page of 0", "page=0"],
    ["a negative page", "page=-2"],
    ["a fractional page", "page=1.5"],
  ])("falls back to the defaults for %s", async (_, query) => {
    renderAs(managerUser, `/inventory/units?${query}`);

    await screen.findAllByText(IMEI);
    expect(lastParams()).toEqual({ page: 1, limit: 25 });
  });

  it("ignores a branch that isn't in the filter's list", async () => {
    renderAs(adminUser, "/inventory/units?branchId=not-a-branch");

    await screen.findAllByText(IMEI);
    expect(lastParams()).toEqual({ page: 1, limit: 25 });
  });

  it("keeps the URL's branch while the branch list is still loading", async () => {
    renderAs(
      adminUser,
      `/inventory/units?branchId=${cityShop.id}`,
      branchesState([], { loading: true, initialized: false }),
    );

    await screen.findAllByText(IMEI);
    expect(lastParams()).toEqual({ page: 1, limit: 25, branchId: cityShop.id });
  });

  it("keeps the URL's branch when the branch list failed to load, so the view doesn't widen", async () => {
    renderAs(
      adminUser,
      `/inventory/units?branchId=${cityShop.id}`,
      branchesState([], { error: "Failed to load branches", initialized: true }),
    );

    await screen.findAllByText(IMEI);
    for (const [params] of productUnitsService.listProductUnits.mock.calls) {
      expect(params.branchId).toBe(cityShop.id);
    }
  });

  it("never sends a branch from the URL for a manager", async () => {
    renderAs(managerUser, `/inventory/units?branchId=${cityShop.id}`);

    await screen.findAllByText(IMEI);
    for (const [params] of productUnitsService.listProductUnits.mock.calls) {
      expect(params).not.toHaveProperty("branchId");
    }
  });

  it("the search box follows the URL when the sidebar link clears it", async () => {
    const user = userEvent.setup();
    renderAs(managerUser, `/inventory/units?q=${IMEI}`);
    await screen.findAllByText(IMEI);
    expect(searchBox()).toHaveValue(IMEI);

    await user.click(screen.getByRole("link", { name: "Sidebar link" }));

    await waitFor(() => expect(searchBox()).toHaveValue(""));
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 25 }));
  });
});

describe("ProductUnits: live search", () => {
  const url = () => screen.getByTestId("url").textContent;
  const type = (value) => fireEvent.change(searchBox(), { target: { value } });
  const wait = (ms) => act(async () => { vi.advanceTimersByTime(ms); });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The first load done, then timers we control. */
  const renderWithFakeTimers = async (route) => {
    renderAs(managerUser, route);
    await screen.findAllByText(IMEI);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  };

  it("searches 300 ms after the typing stops, and not before", async () => {
    await renderWithFakeTimers();

    type("gal");
    await wait(299);
    expect(productUnitsService.searchProductUnits).not.toHaveBeenCalled();

    await wait(1);
    expect(productUnitsService.searchProductUnits).toHaveBeenCalledTimes(1);
    expect(lastSearch()).toEqual({ page: 1, limit: 25, q: "gal" });
  });

  it("each keystroke restarts the wait, so only the last text is searched", async () => {
    await renderWithFakeTimers();

    type("ga");
    await wait(200);
    type("gal");
    await wait(200);
    type("gala");
    await wait(300);

    expect(productUnitsService.searchProductUnits).toHaveBeenCalledTimes(1);
    expect(lastSearch().q).toBe("gala");
  });

  it("doesn't search one character, and says why", async () => {
    await renderWithFakeTimers();
    const lists = productUnitsService.listProductUnits.mock.calls.length;

    type("g");
    await wait(1000);

    expect(productUnitsService.searchProductUnits).not.toHaveBeenCalled();
    expect(productUnitsService.listProductUnits).toHaveBeenCalledTimes(lists);
    expect(screen.getByText("Type at least 2 characters to search.")).toBeInTheDocument();
  });

  it("searches two characters", async () => {
    await renderWithFakeTimers();

    type("a5");
    await wait(300);

    expect(lastSearch().q).toBe("a5");
  });

  it("Enter searches at once, trimmed, and the wait doesn't search again", async () => {
    await renderWithFakeTimers();

    type("  gal  ");
    fireEvent.submit(searchBox().closest("form"));
    await wait(0);
    expect(lastSearch()).toEqual({ page: 1, limit: 25, q: "gal" });

    await wait(1000);
    expect(productUnitsService.searchProductUnits).toHaveBeenCalledTimes(1);
  });

  it("the Search button searches too", async () => {
    const user = userEvent.setup();
    renderAs(managerUser);
    await screen.findAllByText(IMEI);

    await user.type(searchBox(), "gal");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(lastSearch().q).toBe("gal"));
  });

  it("uses the search endpoint with q, never the list's imei filter", async () => {
    await renderWithFakeTimers();
    productUnitsService.listProductUnits.mockClear();

    type(IMEI);
    await wait(300);

    expect(lastSearch()).toEqual({ page: 1, limit: 25, q: IMEI });
    expect(lastSearch()).not.toHaveProperty("imei");
    expect(productUnitsService.listProductUnits).not.toHaveBeenCalled();
  });

  it("writes the search to the URL as q, and goes back to page 1", async () => {
    await renderWithFakeTimers("/inventory/units?status=SOLD&page=3");

    type("gal");
    await wait(300);

    expect(url()).toBe("?status=SOLD&q=gal");
    expect(lastSearch().page).toBe(1);
  });

  it("a changed search goes back to page 1", async () => {
    await renderWithFakeTimers("/inventory/units?q=gal&page=2");

    type("gala");
    await wait(300);

    expect(url()).toBe("?q=gala");
    expect(lastSearch()).toEqual({ page: 1, limit: 25, q: "gala" });
  });

  it("repeats nothing, and keeps the page, when the text only gains a space", async () => {
    await renderWithFakeTimers("/inventory/units?q=gal&page=2");
    productUnitsService.searchProductUnits.mockClear();

    type("gal ");
    await wait(300);

    expect(url()).toBe("?q=gal&page=2");
    expect(productUnitsService.searchProductUnits).not.toHaveBeenCalled();
  });

  it("pages through search results", async () => {
    const user = userEvent.setup();
    productUnitsService.searchProductUnits.mockResolvedValue(page([unit()], { total: 60, totalPages: 3 }));
    renderAs(managerUser, "/inventory/units?q=gal");
    await screen.findByText("Page 1 of 3");

    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(lastSearch()).toEqual({ page: 2, limit: 25, q: "gal" }));
    expect(url()).toBe("?q=gal&page=2");
  });

  it("keeps what's being typed when the search ends at one character", async () => {
    await renderWithFakeTimers("/inventory/units?q=gal");

    type("g");
    await wait(300);

    expect(url()).toBe("");
    expect(searchBox()).toHaveValue("g");
    expect(lastParams()).toEqual({ page: 1, limit: 25 });
  });

  it("keeps a trailing space while typing", async () => {
    await renderWithFakeTimers();

    type("galaxy ");
    await wait(300);

    expect(url()).toBe("?q=galaxy");
    expect(searchBox()).toHaveValue("galaxy ");
  });

  it("a single character in the URL is the normal list", async () => {
    renderAs(managerUser, "/inventory/units?q=g&status=SOLD");

    await screen.findAllByText(IMEI);
    expect(lastParams()).toEqual({ page: 1, limit: 25, status: "SOLD" });
    expect(productUnitsService.searchProductUnits).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Sold/ })).toBeEnabled();
  });

  describe("the status filter", () => {
    it("is off during a search, says so, and isn't sent", async () => {
      renderAs(managerUser, "/inventory/units?q=gal&status=SOLD");

      await screen.findAllByText(IMEI);
      expect(screen.getByRole("button", { name: /Sold/ })).toBeDisabled();
      expect(screen.getByText("Not used while searching.")).toBeInTheDocument();
      expect(lastSearch()).toEqual({ page: 1, limit: 25, q: "gal" });
      expect(lastSearch()).not.toHaveProperty("status");
    });

    it("stays in the URL during a search", async () => {
      await renderWithFakeTimers("/inventory/units?status=SOLD");

      type("gal");
      await wait(300);

      expect(url()).toBe("?status=SOLD&q=gal");
      expect(screen.getByRole("button", { name: /Sold/ })).toBeDisabled();
    });

    it("is on again, with its value, after Clear", async () => {
      const user = userEvent.setup();
      renderAs(managerUser, "/inventory/units?q=gal&status=SOLD&page=2");
      await screen.findAllByText(IMEI);

      await user.click(screen.getByRole("button", { name: "Clear" }));

      await waitFor(() => expect(url()).toBe("?status=SOLD"));
      await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 25, status: "SOLD" }));
      expect(searchBox()).toHaveValue("");
      expect(screen.getByRole("button", { name: /Sold/ })).toBeEnabled();
      expect(screen.queryByText("Not used while searching.")).not.toBeInTheDocument();
    });

    it("is on when not searching", async () => {
      renderAs(managerUser, "/inventory/units?status=SOLD");

      await screen.findAllByText(IMEI);
      expect(screen.getByRole("button", { name: /Sold/ })).toBeEnabled();
    });
  });

  describe("the branch", () => {
    it("an admin's branch goes with the search, and stays in the URL", async () => {
      const user = userEvent.setup();
      renderAs(adminUser, `/inventory/units?branchId=${cityShop.id}`);
      await screen.findAllByText(IMEI);

      await user.type(searchBox(), "gal{Enter}");

      await waitFor(() =>
        expect(lastSearch()).toEqual({ page: 1, limit: 25, q: "gal", branchId: cityShop.id }),
      );
      expect(url()).toBe(`?branchId=${cityShop.id}&q=gal`);
    });

    it("a manager's search never sends a branch, even one in the URL", async () => {
      renderAs(managerUser, `/inventory/units?q=gal&branchId=${cityShop.id}`);

      await screen.findAllByText(IMEI);
      expect(lastSearch()).not.toHaveProperty("branchId");
    });
  });

  describe("states", () => {
    it("shows the skeleton while searching", async () => {
      productUnitsService.searchProductUnits.mockReturnValue(new Promise(() => {}));
      const { container } = renderAs(managerUser, "/inventory/units?q=gal");

      expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    });

    it("names the search when nothing matches", async () => {
      productUnitsService.searchProductUnits.mockResolvedValue(page([]));
      renderAs(managerUser, "/inventory/units?q=nothing");

      expect((await screen.findAllByText("No units match “nothing”.")).length).toBeGreaterThan(0);
      expect(screen.queryByText("No product units have been recorded yet.")).not.toBeInTheDocument();
    });

    it("heads the results Matching units, with their count", async () => {
      productUnitsService.searchProductUnits.mockResolvedValue(page([unit()], { total: 7, totalPages: 1 }));
      renderAs(managerUser, "/inventory/units?q=gal");

      expect(await screen.findByRole("heading", { name: "Matching units (7)" })).toBeInTheDocument();
    });

    it("shows an error, and Try again searches again", async () => {
      const user = userEvent.setup();
      productUnitsService.searchProductUnits.mockRejectedValueOnce(new Error("offline"));
      renderAs(managerUser, "/inventory/units?q=gal");

      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load product units");
      await user.click(screen.getByRole("button", { name: "Try again" }));

      await screen.findAllByText(IMEI);
      expect(productUnitsService.searchProductUnits).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("a slow older search can't overwrite a newer one", async () => {
      const named = (name) => page([unit({ product: { ...unit().product, name } })]);
      const older = deferred();
      const newer = deferred();
      productUnitsService.searchProductUnits.mockReturnValueOnce(older.promise);
      productUnitsService.searchProductUnits.mockReturnValueOnce(newer.promise);
      await renderWithFakeTimers();

      type("ga");
      await wait(300);
      type("gal");
      await wait(300);
      vi.useRealTimers();

      newer.resolve(named("Newer answer"));
      await screen.findAllByText("Newer answer");
      older.resolve(named("Older answer"));
      await new Promise((r) => setTimeout(r, 0));

      expect(screen.getAllByText("Newer answer").length).toBeGreaterThan(0);
      expect(screen.queryByText("Older answer")).not.toBeInTheDocument();
    });

    it("a slow search can't overwrite the list after Clear", async () => {
      const user = userEvent.setup();
      const slow = deferred();
      productUnitsService.searchProductUnits.mockReturnValueOnce(slow.promise);
      renderAs(managerUser, "/inventory/units?q=gal");

      await user.click(screen.getByRole("button", { name: "Clear" }));
      await screen.findAllByText(IMEI);
      slow.resolve(page([unit({ product: { ...unit().product, name: "Older answer" } })]));
      await new Promise((r) => setTimeout(r, 0));

      expect(screen.queryByText("Older answer")).not.toBeInTheDocument();
    });
  });

  describe("a branch picked while a search is waiting", () => {
    const pickBranch = async (name, current = /All branches/) => {
      fireEvent.click(screen.getByRole("button", { name: current }));
      await wait(0);
      fireEvent.click(screen.getByRole("option", { name }));
      await wait(0);
    };
    const renderAdmin = async (route) => {
      renderAs(adminUser, route);
      await screen.findAllByText(IMEI);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    };

    it("keeps the branch: the waiting search doesn't overwrite it", async () => {
      await renderAdmin();

      type("gal");
      await wait(100);
      await pickBranch("City Shop");
      await wait(300);

      expect(url()).toBe(`?branchId=${cityShop.id}&q=gal`);
      expect(lastSearch()).toEqual({ page: 1, limit: 25, q: "gal", branchId: cityShop.id });
    });

    it("doesn't bring back a branch that was just removed", async () => {
      await renderAdmin(`/inventory/units?branchId=${cityShop.id}`);

      type("gal");
      await wait(100);
      await pickBranch("All branches", /City Shop/);
      await wait(300);

      expect(url()).toBe("?q=gal");
      expect(lastSearch()).toEqual({ page: 1, limit: 25, q: "gal" });
    });

    it("still keeps the status and goes back to page 1", async () => {
      await renderAdmin("/inventory/units?status=SOLD&page=3");

      type("gal");
      await wait(100);
      await pickBranch("City Shop");
      await wait(300);

      expect(url()).toBe(`?status=SOLD&branchId=${cityShop.id}&q=gal`);
      expect(lastSearch()).toEqual({ page: 1, limit: 25, q: "gal", branchId: cityShop.id });
    });

    it("a page turned while a search waits gives way to the search", async () => {
      productUnitsService.listProductUnits.mockResolvedValue(page([unit()], { total: 60, totalPages: 3 }));
      await renderWithFakeTimers();

      type("gal");
      await wait(100);
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await wait(300);

      expect(url()).toBe("?q=gal");
      expect(lastSearch()).toEqual({ page: 1, limit: 25, q: "gal" });
    });
  });

  it("a pending search doesn't run after the box is cleared", async () => {
    await renderWithFakeTimers();

    type("gal");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await wait(1000);

    expect(productUnitsService.searchProductUnits).not.toHaveBeenCalled();
    expect(url()).toBe("");
  });

  it("the search's rows fill the same table, and a row opens its unit", async () => {
    const user = userEvent.setup();
    productUnitsService.searchProductUnits.mockResolvedValue(
      page([
        {
          id: "unit-9",
          product_id: "p-phone",
          imei: IMEI,
          imei_number: IMEI,
          serial_number: SERIAL,
          status: "RETURNED",
          created_at: "2026-09-01T04:00:00.000Z",
          product: { name: "Galaxy A15", sku: "SKU-000007", tracking_method: "IMEI" },
          branch: { name: "Main Shop" },
        },
      ]),
    );
    renderAs(adminUser, "/inventory/units?q=gal");

    await screen.findAllByText(IMEI);
    const cells = within(row(IMEI));
    expect(cells.getByText("Galaxy A15")).toBeInTheDocument();
    expect(cells.getByText(SERIAL)).toBeInTheDocument();
    expect(cells.getByText("Back with customer")).toBeInTheDocument();
    expect(cells.getByText("Main Shop")).toBeInTheDocument();

    await user.click(row(IMEI));
    expect(await screen.findByText("Opened /inventory/units/unit-9")).toBeInTheDocument();
    expect(screen.getByText("From ?q=gal")).toBeInTheDocument();
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

  it("sends a search to the search endpoint, with q and no status", async () => {
    const { searchProductUnits } = await vi.importActual("../../services/productUnitsService");
    productUnitsService.searchProductUnits.mockImplementation(searchProductUnits);
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: page([unit()]) });
    renderAs(adminUser, `/inventory/units?q=gal&status=SOLD&branchId=${cityShop.id}`);

    await screen.findAllByText(IMEI);

    expect(get).toHaveBeenLastCalledWith("/product-units/search", {
      params: { page: 1, limit: 25, branchId: cityShop.id, q: "gal" },
    });
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
