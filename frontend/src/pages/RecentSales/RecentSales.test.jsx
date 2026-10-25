import { vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import RecentSales from ".";
import SaleDetail from "../SaleDetail";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { cashierUser, mainShop } from "../../test/fixtures";
import { paymentEntity, saleEntity, saleLineEntity } from "../../test/saleEntities";
import * as salesService from "../../services/salesService";
import { formatLKR } from "../../utils/money";

vi.mock("../../services/salesService");

// 11:30 on Thu 22 Oct 2026 in Colombo
const NOW = new Date("2026-10-22T06:00:00.000Z");
const TODAY = {
  completedFrom: "2026-10-22T00:00:00+05:30",
  completedTo: "2026-10-23T00:00:00+05:30",
};

// GET /sales rows are serialized entities (ClassSerializerInterceptor, no
// renames). customer: the Customer entity (backend/src/customers/entities/
// customer.entity.ts) — `name`, not `full_name` — or null for a walk-in.
// cashier: the User entity minus its @Exclude fields (user.entity.ts).
const listCustomer = (overrides = {}) => ({
  id: "cust-1",
  name: "Kamal Perera",
  phone: "0771234567",
  nic: "199012345678",
  email: null,
  notes: null,
  created_at: "2026-10-01T04:00:00.000Z",
  updated_at: "2026-10-01T04:00:00.000Z",
  deleted_at: null,
  ...overrides,
});

const listCashier = (overrides = {}) => ({
  id: "user-cashier",
  email: "cashier@socio.lk",
  full_name: "Test Cashier",
  approval_pin_set_at: null,
  role: "cashier",
  is_active: true,
  branch_id: "branch-main",
  created_at: "2026-09-01T04:00:00.000Z",
  updated_at: "2026-09-01T04:00:00.000Z",
  deleted_at: null,
  ...overrides,
});

const listRow = (n, overrides = {}) => ({
  id: `sale-${n}`,
  sale_number: `INV-20261022-${String(n).padStart(4, "0")}`,
  sale_type: "RETAIL",
  status: "COMPLETED",
  branch_id: "branch-main",
  cashier_id: "user-cashier",
  customer_id: null,
  subtotal: "1500.00",
  discount_total: "0.00",
  tax_total: "0.00",
  total: "1500.00",
  amount_paid: "1500.00",
  change_due: "0.00",
  notes: null,
  completed_at: "2026-10-22T04:32:00.000Z", // 10:02 Colombo
  voided_at: null,
  voided_by: null,
  void_requested_by: null,
  void_reason: null,
  created_at: "2026-10-22T04:20:00.000Z",
  updated_at: "2026-10-22T04:32:00.000Z",
  branch: { id: "branch-main", name: "Main Shop" }, // the list doesn't read it; trimmed
  cashier: listCashier(),
  customer: null,
  // P7-18: every list row carries these (sales.service.ts findAll)
  return_state: "NONE",
  refunded_total: "0.00",
  ...overrides,
});

/**
 * GET /sales/:id for a list row: the row's own figures (1,500.00) on the
 * hydrated shape, with the one line and payment they add up to, and
 * returns[] (the detail page's Return items reads them).
 */
const detailOf = (id) =>
  saleEntity({
    ...listRow(Number(id.split("-")[1])),
    id,
    lines: [saleLineEntity({ sale_id: id })],
    payments: [paymentEntity({ sale_id: id })],
    returns: [],
  });

const page = (rows, total = rows.length) => ({ data: rows, meta: { total, page: 1 } });

const rowsFrom = (from, count) => Array.from({ length: count }, (_, i) => listRow(from + i));

const Where = () => {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
};

const providers = (route) => ({
  route,
  preloadedState: { auth: authState(cashierUser), branches: branchesState([mainShop]) },
});

const renderList = (route = "/pos/sales") =>
  renderWithProviders(
    <>
      <Where />
      <Routes>
        <Route path="/pos" element={<p>terminal page</p>} />
        <Route path="/pos/sales" element={<RecentSales />} />
        <Route path="/pos/sales/:id" element={<SaleDetail />} />
      </Routes>
    </>,
    providers(route),
  );

// jsdom has no CSS, so the < md cards render too: query the table.
const where = () => screen.getByTestId("where").textContent;
const table = () => screen.getByRole("table");
const bodyRows = () => within(table()).getAllByRole("row").slice(1);
const activeRow = () => bodyRows().find((r) => r.getAttribute("aria-selected") === "true");
const sale = (number) => within(table()).getByText(number);
const findSale = (number) => waitFor(() => sale(number));
const searchBox = () => screen.getByRole("searchbox", { name: "Search sales" });
const lastCall = () => salesService.listSales.mock.calls.at(-1)[0];

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RecentSales: the day list (P6-2, P6-5)", () => {
  it("supports the app-shell Sales history route", async () => {
    const user = userEvent.setup();
    salesService.listSales.mockResolvedValue(page([listRow(1)]));
    renderWithProviders(
      <>
        <Where />
        <Routes>
          <Route
            path="/sales"
            element={<RecentSales salesPath="/sales" exitPath="/dashboard" exitLabel="Dashboard" />}
          />
          <Route path="/sales/:id" element={<p>sale detail</p>} />
          <Route path="/dashboard" element={<p>dashboard</p>} />
        </Routes>
      </>,
      providers("/sales"),
    );

    await findSale("INV-20261022-0001");
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeInTheDocument();
    await user.click(sale("INV-20261022-0001"));
    expect(where()).toBe("/sales/sale-1");
  });

  it("loads today's completed sales for the terminal branch, newest completion first", async () => {
    salesService.listSales.mockResolvedValue(page([listRow(1)]));
    renderList();

    await findSale("INV-20261022-0001");
    expect(salesService.listSales).toHaveBeenCalledTimes(1);
    expect(lastCall()).toEqual({
      branchId: "branch-main",
      ...TODAY,
      sort: "completed_at",
      page: 1,
      limit: 50,
    });
    expect(screen.getByTestId("day-label")).toHaveTextContent("Today · Thu 22 Oct 2026");
    expect(screen.getByText("1 sale")).toBeInTheDocument();
  });

  it("shows time, sale number, customer or Walk-in, cashier, total and a Voided badge", async () => {
    salesService.listSales.mockResolvedValue(
      page([
        listRow(2, { customer_id: "cust-1", customer: listCustomer(), total: "60000.00" }),
        listRow(1, { status: "VOIDED", cashier: listCashier({ id: "u-2", full_name: "Nimali Silva" }) }),
      ]),
    );
    renderList();

    await findSale("INV-20261022-0002");
    const [first, second] = bodyRows();
    expect(within(first).getByText("10:02 AM")).toBeInTheDocument();
    expect(within(first).getByText("Kamal Perera")).toBeInTheDocument();
    expect(within(first).getByText(/LKR\s60,000\.00/)).toBeInTheDocument();
    expect(within(first).queryByText("Voided")).not.toBeInTheDocument();
    expect(within(second).getByText("Walk-in")).toBeInTheDocument();
    expect(within(second).getByText("Nimali Silva")).toBeInTheDocument();
    expect(within(second).getAllByText("Voided").length).toBeGreaterThan(0);
  });

  describe("the Status header and the sales count", () => {
    const count = () => screen.getByTestId("sales-count");
    // The header buttons' corner radius (rounded-lg), in the accent colour
    const isPill = (el) => el.className.includes("rounded-lg") && el.className.includes("bg-cyan-600");

    it("the table's last column is headed Status, like the others", async () => {
      salesService.listSales.mockResolvedValue(page([listRow(1)]));
      renderList();
      await findSale("INV-20261022-0001");

      const headers = within(table()).getAllByRole("columnheader").map((h) => h.textContent);
      expect(headers.at(-1)).toBe("Status");
      expect(within(table()).getByRole("columnheader", { name: "Status" }).className).toContain("uppercase");
    });

    it("the count is a highlighted pill at the right of the toolbar: plural", async () => {
      salesService.listSales.mockResolvedValue(page(rowsFrom(1, 4)));
      renderList();
      await findSale("INV-20261022-0004");

      expect(count()).toHaveTextContent(/^4 sales$/);
      expect(isPill(count())).toBe(true);
      expect(count().className).toContain("ml-auto");
      expect(count().className).toContain("whitespace-nowrap");
      // In the toolbar row, after the search box
      expect(count().parentElement).toContainElement(searchBox());
    });

    it("one sale is singular", async () => {
      salesService.listSales.mockResolvedValue(page([listRow(1)]));
      renderList();
      await findSale("INV-20261022-0001");
      expect(count()).toHaveTextContent(/^1 sale$/);
    });

    it("a search keeps its wording in the pill", async () => {
      salesService.listSales.mockResolvedValue(page([listRow(42)]));
      renderList("/pos/sales?q=0042");
      await findSale("INV-20261022-0042");
      expect(count()).toHaveTextContent("1 match for “0042”, all dates");
      expect(isPill(count())).toBe(true);
    });

    it("the search hint is plain text, not a pill", async () => {
      salesService.listSales.mockResolvedValue(page([listRow(1)]));
      const user = userEvent.setup();
      renderList();
      await findSale("INV-20261022-0001");
      await user.type(searchBox(), "0");

      expect(count()).toHaveTextContent("Type 2 or more characters to search all dates");
      expect(isPill(count())).toBe(false);
    });
  });

  describe("one status badge per row (P7-18)", () => {
    const BADGE = /^(Completed|Part returned|Returned|Voided)$/;
    const rows = () => [
      listRow(4),
      listRow(3, { return_state: "PARTIAL", refunded_total: "5490.00" }),
      listRow(2, { return_state: "FULL", refunded_total: "1500.00" }),
      listRow(1, { status: "VOIDED" }),
    ];
    const cards = () => within(screen.getByRole("list", { name: /^Sales on / })).getAllByRole("listitem");

    it("the Status column: Completed, Part returned, Returned or Voided, exactly one each", async () => {
      salesService.listSales.mockResolvedValue(page(rows()));
      renderList();
      await findSale("INV-20261022-0004");

      const statusCells = bodyRows().map((r) => within(r).getAllByRole("cell").at(-1));
      expect(statusCells.map((c) => within(c).getAllByText(BADGE).map((b) => b.textContent))).toEqual([
        ["Completed"],
        ["Part returned"],
        ["Returned"],
        ["Voided"],
      ]);
    });

    it("below md, the same one badge under the sale number on each card", async () => {
      salesService.listSales.mockResolvedValue(page(rows()));
      renderList();
      await findSale("INV-20261022-0004");

      expect(cards().map((c) => within(c).getAllByText(BADGE).map((b) => b.textContent))).toEqual([
        ["Completed"],
        ["Part returned"],
        ["Returned"],
        ["Voided"],
      ]);
      // In the table that copy sits in the sale-number cell, hidden from md up
      const mobileCopy = within(bodyRows()[1]).getAllByText("Part returned")[0];
      expect(mobileCopy.closest(".md\\:hidden")).not.toBeNull();
    });

    it("the total stays the original; what was refunded goes under it, formatted as the total", async () => {
      salesService.listSales.mockResolvedValue(page(rows()));
      renderList();
      await findSale("INV-20261022-0004");

      const [completed, partial] = bodyRows();
      expect(within(completed).queryByTestId("sale-refunded")).not.toBeInTheDocument();
      expect(within(partial).getByText(/^LKR\s1,500\.00$/)).toBeInTheDocument();
      // 4 digits: the same formatLKR as the total, a comma for thousands
      const refunded = within(partial).getByTestId("sale-refunded");
      expect(refunded.textContent).toBe(`Refunded ${formatLKR("5490.00")}`);
      expect(refunded.textContent.replace(/\s/g, " ")).toBe("Refunded LKR 5,490.00");
    });

    it("a search by RET number goes to the server as typed and shows the sale it finds", async () => {
      salesService.listSales.mockResolvedValue(page([listRow(3, { return_state: "PARTIAL", refunded_total: "5490.00" })]));
      renderList("/pos/sales?q=RET-20261023-0001");
      await findSale("INV-20261022-0003");

      expect(lastCall()).toMatchObject({ q: "RET-20261023-0001" });
      expect(within(bodyRows()[0]).getAllByText("Part returned").length).toBeGreaterThan(0);
    });
  });

  it("Customer column: the customer's name (Customer.name), or Walk-in for none — in the table and the cards", async () => {
    salesService.listSales.mockResolvedValue(
      page([
        listRow(3, { customer_id: "cust-7", customer: listCustomer({ id: "cust-7", name: "Fathima Rizwan" }) }),
        listRow(2, { customer_id: null, customer: null }),
      ]),
    );
    renderList();

    await findSale("INV-20261022-0003");
    const [named, walkIn] = bodyRows();
    const customerCell = (tr) => within(tr).getAllByRole("cell")[2];
    expect(customerCell(named)).toHaveTextContent(/^Fathima Rizwan$/);
    expect(within(customerCell(named)).getByTitle("Fathima Rizwan")).toBeInTheDocument();
    expect(customerCell(walkIn)).toHaveTextContent(/^Walk-in$/);

    // < md cards render the same column
    const cards = within(screen.getByRole("list", { name: "Sales on Thu 22 Oct 2026" })).getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent("Fathima Rizwan");
    expect(cards[1]).toHaveTextContent("Walk-in");
  });

  it("says so when the day has no sales", async () => {
    salesService.listSales.mockResolvedValue(page([]));
    renderList();

    expect(await screen.findAllByText("No sales on Thu 22 Oct 2026")).not.toHaveLength(0);
    expect(screen.getByText("0 sales")).toBeInTheDocument();
  });

  it("shows an error with Try again, which reloads", async () => {
    salesService.listSales.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue(page([listRow(1)]));
    const user = userEvent.setup();
    renderList();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the sales.");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    await findSale("INV-20261022-0001");
    expect(salesService.listSales).toHaveBeenCalledTimes(2);
  });
});

describe("RecentSales: the day stepper (P6-2)", () => {
  beforeEach(() => {
    salesService.listSales.mockResolvedValue(page([listRow(1)]));
  });

  it("← and the Previous button go back a day, with that day's +05:30 bounds", async () => {
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");

    await user.keyboard("{ArrowLeft}");
    await waitFor(() =>
      expect(lastCall()).toMatchObject({
        completedFrom: "2026-10-21T00:00:00+05:30",
        completedTo: "2026-10-22T00:00:00+05:30",
      }),
    );
    expect(where()).toBe("/pos/sales?day=2026-10-21");
    expect(screen.getByTestId("day-label")).toHaveTextContent("Wed 21 Oct 2026");

    await user.click(screen.getByRole("button", { name: "Previous day" }));
    await waitFor(() => expect(where()).toBe("/pos/sales?day=2026-10-20"));
  });

  it("can't go past today: Next is disabled and → does nothing", async () => {
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");

    expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
    await user.keyboard("{ArrowRight}");
    expect(salesService.listSales).toHaveBeenCalledTimes(1);
    expect(where()).toBe("/pos/sales");
  });

  it("→ steps forward and Today jumps back to today", async () => {
    const user = userEvent.setup();
    renderList("/pos/sales?day=2026-10-19");
    await findSale("INV-20261022-0001");
    expect(lastCall().completedFrom).toBe("2026-10-19T00:00:00+05:30");

    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(where()).toBe("/pos/sales?day=2026-10-20"));

    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(where()).toBe("/pos/sales"));
    await waitFor(() => expect(lastCall()).toMatchObject(TODAY));
  });

  it.each(["2027-01-01", "2026-02-30", "yesterday"])("reads ?day=%s as today", async (day) => {
    renderList(`/pos/sales?day=${day}`);
    await findSale("INV-20261022-0001");
    expect(lastCall()).toMatchObject(TODAY);
  });
});

describe("RecentSales: the day picker", () => {
  const label = () => screen.getByTestId("day-label");
  const picker = () => screen.getByTestId("day-picker");
  let showPicker;

  beforeEach(() => {
    salesService.listSales.mockResolvedValue(page([listRow(1)]));
    // jsdom has no showPicker: stand one in, to see that the label calls it.
    showPicker = vi.fn();
    HTMLInputElement.prototype.showPicker = showPicker;
  });

  afterEach(() => {
    delete HTMLInputElement.prototype.showPicker;
  });

  it("the label opens the browser's date picker, on a click and on Enter / Space", async () => {
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");

    expect(label().tagName).toBe("BUTTON");
    expect(label()).toHaveAttribute("title", "Pick a day");
    await user.click(label());
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(showPicker.mock.contexts[0]).toBe(picker());

    label().focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(showPicker).toHaveBeenCalledTimes(3);
    expect(salesService.listSales).toHaveBeenCalledTimes(1); // Enter didn't open a sale
  });

  it("where showPicker isn't supported, the label focuses the date input instead", async () => {
    delete HTMLInputElement.prototype.showPicker;
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");

    await user.click(label());
    expect(picker()).toHaveFocus();
  });

  it("starts on the day shown; no later than today in Colombo, no earliest day", async () => {
    renderList("/pos/sales?day=2026-10-19");
    await findSale("INV-20261022-0001");

    expect(picker()).toHaveAttribute("type", "date");
    expect(picker()).toHaveValue("2026-10-19");
    expect(picker()).toHaveAttribute("max", "2026-10-22");
    expect(picker()).not.toHaveAttribute("min");
  });

  it("max follows the Colombo date, not the till's clock zone", async () => {
    vi.setSystemTime(new Date("2026-10-22T19:00:00.000Z")); // 00:30 on the 23rd in Colombo
    renderList();
    await findSale("INV-20261022-0001");
    expect(picker()).toHaveAttribute("max", "2026-10-23");
  });

  it("choosing a date jumps to it, as stepping does: the URL, the list, the Today button", async () => {
    renderList();
    await findSale("INV-20261022-0001");

    fireEvent.change(picker(), { target: { value: "2026-10-15" } });

    await waitFor(() => expect(where()).toBe("/pos/sales?day=2026-10-15"));
    await waitFor(() =>
      expect(lastCall()).toMatchObject({
        completedFrom: "2026-10-15T00:00:00+05:30",
        completedTo: "2026-10-16T00:00:00+05:30",
      }),
    );
    expect(label()).toHaveTextContent("Thu 15 Oct 2026");
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
  });

  it("choosing today goes back to today's list", async () => {
    renderList("/pos/sales?day=2026-10-15");
    await findSale("INV-20261022-0001");

    fireEvent.change(picker(), { target: { value: "2026-10-22" } });
    await waitFor(() => expect(where()).toBe("/pos/sales"));
  });

  it("cancelling (no change) or a cleared or future value changes nothing", async () => {
    const user = userEvent.setup();
    renderList("/pos/sales?day=2026-10-19");
    await findSale("INV-20261022-0001");

    await user.click(label()); // opened, then closed with no choice: no change event
    fireEvent.change(picker(), { target: { value: "" } });
    fireEvent.change(picker(), { target: { value: "2026-10-30" } });

    expect(where()).toBe("/pos/sales?day=2026-10-19");
    expect(salesService.listSales).toHaveBeenCalledTimes(1);
  });

  it("during a search the label still opens it: choosing a day ends the search; cancelling keeps it", async () => {
    const user = userEvent.setup();
    salesService.listSales.mockResolvedValue(page([listRow(42)]));
    renderList("/pos/sales?q=0042");
    await findSale("INV-20261022-0042");
    expect(label()).toHaveTextContent("All dates");
    expect(label()).toHaveAttribute("title", "Pick a day (ends the search)");

    await user.click(label());
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(where()).toBe("/pos/sales?q=0042"); // opening alone changes nothing

    fireEvent.change(picker(), { target: { value: "2026-10-20" } });
    await waitFor(() => expect(where()).toBe("/pos/sales?day=2026-10-20"));
    expect(searchBox()).toHaveValue("");
    expect(lastCall()).not.toHaveProperty("q");
  });

  it("keys in the date input stay there: Enter opens no sale, Esc leaves the input, not the page", async () => {
    delete HTMLInputElement.prototype.showPicker;
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");
    await user.click(label()); // focuses the input (no showPicker)

    await user.keyboard("{Enter}");
    expect(where()).toBe("/pos/sales");
    await user.keyboard("{Escape}");
    expect(where()).toBe("/pos/sales");
    expect(picker()).not.toHaveFocus();
  });
});

describe("RecentSales: search (P6-3)", () => {
  it("sends 2+ characters after 250 ms as q, still for the branch, without the day bounds", async () => {
    salesService.listSales.mockResolvedValue(page([listRow(1)]));
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");
    salesService.listSales.mockClear();
    salesService.listSales.mockResolvedValue(page([listRow(42, { completed_at: "2026-07-02T09:02:00.000Z" })]));

    await user.type(searchBox(), "0042");

    await findSale("INV-20261022-0042");
    expect(salesService.listSales).toHaveBeenCalledTimes(1);
    const params = lastCall();
    expect(params).toEqual({ branchId: "branch-main", q: "0042", sort: "completed_at", page: 1, limit: 50 });
    expect(params).not.toHaveProperty("completedFrom");
    expect(params).not.toHaveProperty("completedTo");
    expect(where()).toBe("/pos/sales?q=0042");
    // Across dates: the row shows its date; the stepper says so
    expect(within(bodyRows()[0]).getByText("02 Jul 2026, 2:32 PM")).toBeInTheDocument();
    expect(screen.getByTestId("day-label")).toHaveTextContent("All dates");
    expect(screen.getByRole("button", { name: "Previous day" })).toBeDisabled();
    expect(screen.getByText("1 match for “0042”, all dates")).toBeInTheDocument();
  });

  it("waits for the debounce: nothing is sent until typing pauses", async () => {
    salesService.listSales.mockResolvedValue(page([]));
    renderList();
    await waitFor(() => expect(salesService.listSales).toHaveBeenCalledTimes(1));

    fireEvent.change(searchBox(), { target: { value: "Ka" } });
    fireEvent.change(searchBox(), { target: { value: "Kam" } });
    expect(salesService.listSales).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(salesService.listSales).toHaveBeenCalledTimes(2));
    expect(lastCall().q).toBe("Kam");
  });

  it("doesn't send one character; it says to type 2 or more", async () => {
    salesService.listSales.mockResolvedValue(page([listRow(1)]));
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");

    await user.type(searchBox(), "K");
    await act(() => new Promise((r) => setTimeout(r, 400)));

    expect(salesService.listSales).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Type 2 or more characters to search all dates")).toBeInTheDocument();
  });

  it("Esc in a non-empty search box clears it and returns to the day; the next Esc goes to /pos", async () => {
    salesService.listSales.mockResolvedValue(page([listRow(1)]));
    const user = userEvent.setup();
    renderList("/pos/sales?day=2026-10-20");
    await findSale("INV-20261022-0001");

    await user.type(searchBox(), "Kamal");
    await waitFor(() => expect(where()).toBe("/pos/sales?day=2026-10-20&q=Kamal"));

    await user.keyboard("{Escape}");
    expect(searchBox()).toHaveValue("");
    expect(searchBox()).toHaveFocus();
    await waitFor(() => expect(where()).toBe("/pos/sales?day=2026-10-20"));
    await waitFor(() => expect(lastCall().completedFrom).toBe("2026-10-20T00:00:00+05:30"));

    await user.keyboard("{Escape}");
    expect(where()).toBe("/pos");
  });

  it("says when nothing matches", async () => {
    salesService.listSales.mockResolvedValue(page([]));
    renderList("/pos/sales?q=0777123456");

    expect(await screen.findAllByText("No sales match “0777123456”")).not.toHaveLength(0);
    expect(lastCall()).toMatchObject({ branchId: "branch-main", q: "0777123456" });
  });

  it("drops a stale response when the query changed meanwhile", async () => {
    let resolveFirst;
    salesService.listSales
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce(page([listRow(7)]));
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(salesService.listSales).toHaveBeenCalledTimes(1));

    await user.keyboard("{ArrowLeft}");
    await findSale("INV-20261022-0007");
    resolveFirst(page([listRow(1)]));
    await act(() => Promise.resolve());

    expect(within(table()).queryByText("INV-20261022-0001")).not.toBeInTheDocument();
    expect(sale("INV-20261022-0007")).toBeInTheDocument();
  });
});

describe("RecentSales: Load more (P6-5)", () => {
  it("appends the next 50 and hides once everything is loaded", async () => {
    salesService.listSales
      .mockResolvedValueOnce(page(rowsFrom(1, 50), 60))
      .mockResolvedValueOnce(page(rowsFrom(51, 10), 60));
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");
    expect(bodyRows()).toHaveLength(50);

    await user.click(within(table().parentElement).getByRole("button", { name: "Load more (10 more)" }));

    await findSale("INV-20261022-0060");
    expect(lastCall()).toMatchObject({ ...TODAY, page: 2, limit: 50 });
    expect(bodyRows()).toHaveLength(60);
    expect(screen.queryByRole("button", { name: /Load more/ })).not.toBeInTheDocument();
  });

  it("isn't offered when one page holds everything", async () => {
    salesService.listSales.mockResolvedValue(page(rowsFrom(1, 3), 3));
    renderList();
    await findSale("INV-20261022-0001");

    expect(screen.queryByRole("button", { name: /Load more/ })).not.toBeInTheDocument();
  });
});

describe("RecentSales: keys (P6-1 – P6-5)", () => {
  beforeEach(() => {
    salesService.listSales.mockResolvedValue(page(rowsFrom(1, 3)));
    salesService.getSale.mockImplementation((id) => Promise.resolve(detailOf(id)));
  });

  it("opens with focus on the list, not the search box, so ←/→ work at once", async () => {
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");

    expect(screen.getByLabelText("Sales", { selector: "div" })).toHaveFocus();
    expect(searchBox()).not.toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(where()).toBe("/pos/sales?day=2026-10-21"));
  });

  it("opens with the first row active; ↓/↑ move it; Enter opens the sale", async () => {
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");
    expect(activeRow()).toHaveTextContent("INV-20261022-0001");

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(activeRow()).toHaveTextContent("INV-20261022-0003");
    await user.keyboard("{ArrowUp}");
    expect(activeRow()).toHaveTextContent("INV-20261022-0002");

    await user.keyboard("{Enter}");
    expect(where()).toBe("/pos/sales/sale-2");
  });

  it("↓ and Enter work from the search box too", async () => {
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");

    searchBox().focus();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(where()).toBe("/pos/sales/sale-2");
  });

  it("a click opens the sale", async () => {
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0003");

    await user.click(sale("INV-20261022-0003"));

    expect(where()).toBe("/pos/sales/sale-3");
  });

  it("/ focuses the search box without typing the slash", async () => {
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");

    await user.keyboard("/");

    expect(searchBox()).toHaveFocus();
    expect(searchBox()).toHaveValue("");
  });

  it("←/→ don't change the day while typing in the search box", async () => {
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");

    await user.type(searchBox(), "a{ArrowLeft}");

    expect(where()).toBe("/pos/sales");
  });

  it("Esc on the list goes back to /pos", async () => {
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");

    await user.keyboard("{Escape}");

    expect(where()).toBe("/pos");
  });

  it("Enter on a focused button keeps the button's own action", async () => {
    const user = userEvent.setup();
    renderList("/pos/sales?day=2026-10-20");
    await findSale("INV-20261022-0001");

    screen.getByRole("button", { name: "Today" }).focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(where()).toBe("/pos/sales"));
  });
});

describe("RecentSales: back from a sale (P6-13)", () => {
  beforeEach(() => {
    salesService.getSale.mockImplementation((id) => Promise.resolve(detailOf(id)));
  });

  it("Esc on the detail page restores the day, the search and the active row, and re-reads the rows", async () => {
    salesService.listSales.mockResolvedValue(page(rowsFrom(1, 3)));
    const user = userEvent.setup();
    renderList("/pos/sales?day=2026-10-20&q=Kamal");
    await findSale("INV-20261022-0001");

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await screen.findByRole("heading", { name: "INV-20261022-0003" });
    salesService.listSales.mockClear();

    await user.keyboard("{Escape}");

    await findSale("INV-20261022-0001");
    expect(where()).toBe("/pos/sales?day=2026-10-20&q=Kamal");
    expect(salesService.listSales).toHaveBeenCalledTimes(1);
    expect(lastCall()).toMatchObject({ q: "Kamal", page: 1, limit: 50 });
    expect(activeRow()).toHaveTextContent("INV-20261022-0003");
  });

  it("after Load more, refetches as many rows as were loaded in one request", async () => {
    salesService.listSales
      .mockResolvedValueOnce(page(rowsFrom(1, 50), 120))
      .mockResolvedValueOnce(page(rowsFrom(51, 50), 120))
      .mockResolvedValueOnce(page(rowsFrom(1, 100), 120));
    const user = userEvent.setup();
    renderList();
    await findSale("INV-20261022-0001");
    await user.click(screen.getAllByRole("button", { name: "Load more (70 more)" })[0]);
    await findSale("INV-20261022-0100");

    await user.click(sale("INV-20261022-0077"));
    await screen.findByRole("heading", { name: "INV-20261022-0077" });
    await user.keyboard("{Escape}");

    await findSale("INV-20261022-0100");
    expect(lastCall()).toMatchObject({ page: 1, limit: 100 });
    expect(activeRow()).toHaveTextContent("INV-20261022-0077");
    // Load more carries on after the restored rows
    salesService.listSales.mockResolvedValueOnce(page(rowsFrom(101, 20), 120));
    await user.click(screen.getAllByRole("button", { name: "Load more (20 more)" })[0]);
    await findSale("INV-20261022-0120");
    expect(lastCall()).toMatchObject({ page: 3, limit: 50 });
  });

  it("past 200 rows, refetches the 200 cap; a sale beyond them leaves the first row active, no error", async () => {
    // Five pages were loaded (250 rows) and sale 230 opened.
    salesService.listSales.mockResolvedValue(page(rowsFrom(1, 200), 250));
    renderWithProviders(
      <Routes>
        <Route path="/pos/sales" element={<RecentSales />} />
      </Routes>,
      providers({ pathname: "/pos/sales", state: { restore: { pages: 5, activeId: "sale-230" } } }),
    );

    await findSale("INV-20261022-0200");
    expect(salesService.listSales).toHaveBeenCalledTimes(1);
    expect(lastCall()).toMatchObject({ page: 1, limit: 200 });
    expect(activeRow()).toHaveTextContent("INV-20261022-0001");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Load more (50 more)" }).length).toBeGreaterThan(0);
  });
});
