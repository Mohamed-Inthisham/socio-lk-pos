import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BarcodeLabels from "./index";
import * as labelsService from "../../services/barcodeLabelsService";
import * as branchesService from "../../services/branchesService";
import { authState, renderWithProviders } from "../../test/renderWithProviders";

vi.mock("../../services/barcodeLabelsService");
vi.mock("../../services/branchesService");

/**
 * The Barcode Labels page (Stage 3): server-side searches, a mixed queue in
 * the user's order, an explicit preview through POST /barcode-labels/resolve,
 * and labels that encode a product's barcode or a unit's unit_code, never an
 * IMEI or serial number, and never a cost price.
 */

const branchA = { id: "branch-a", name: "Main Shop", is_active: true };
const branchB = { id: "branch-b", name: "Kandy Branch", is_active: true };
const admin = { id: "user-admin", role: "admin", branch_id: null, branch: null };
const manager = { id: "user-manager", role: "manager", branch_id: branchA.id, branch: branchA };

const charger = {
  kind: "PRODUCT",
  product_id: "p-charger",
  name: "USB-C Charger",
  model: null,
  sku: "SKU-CHG",
  barcode: "SLP-000010",
  barcode_type: "CODE_128",
  selling_price: "4500.00",
};
const cable = { ...charger, product_id: "p-cable", name: "Plain Cable", sku: "SKU-CBL", barcode: "SLP-000011", selling_price: null };
const phoneA = {
  kind: "UNIT",
  unit_id: "u-phone-a",
  unit_code: "SLU00000021",
  product_id: "p-phone",
  name: "iPhone 13",
  tracking_method: "IMEI",
  identifier_type: "IMEI",
  identifier: "356938035643809",
  selling_price: "185000.00",
  branch: branchA,
};
const phoneB = { ...phoneA, unit_id: "u-phone-b", unit_code: "SLU00000022", identifier: "356938035643810" };
const laptop = {
  ...phoneA,
  unit_id: "u-laptop",
  unit_code: "SLU00000023",
  product_id: "p-laptop",
  name: "Work Laptop",
  tracking_method: "SERIAL_NUMBER",
  identifier_type: "SERIAL_NUMBER",
  identifier: "LAP-SN-0001",
  selling_price: null,
};

const page = (data, meta = {}) => ({
  data,
  meta: { total: data.length, page: 1, limit: 20, totalPages: 1, hasNext: false, hasPrev: false, ...meta },
});

const renderAs = (user = admin) =>
  renderWithProviders(<BarcodeLabels />, { preloadedState: { auth: authState(user) } });

const openItemsTab = (user) => user.click(screen.getByRole("tab", { name: "Individual items" }));
const queueItems = () => within(screen.getByRole("list", { name: "Label queue" })).getAllByRole("listitem");

/** Resolve rows the way the server returns them for `items`. */
const resolvedFor = (items) => ({
  data: items.map((item) =>
    item.type === "PRODUCT"
      ? { ...[charger, cable].find((p) => p.product_id === item.productId), quantity: item.quantity }
      : [phoneA, phoneB, laptop].find((u) => u.unit_id === item.unitId),
  ),
  total_labels: items.reduce((sum, item) => sum + (item.type === "PRODUCT" ? item.quantity : 1), 0),
});

describe("BarcodeLabels", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    branchesService.listBranches.mockResolvedValue([branchA, branchB]);
    labelsService.searchProductLabels.mockResolvedValue(page([charger, cable]));
    labelsService.searchUnitLabels.mockResolvedValue(page([phoneA, phoneB, laptop]));
    labelsService.resolveLabelQueue.mockImplementation(({ items }) => Promise.resolve(resolvedFor(items)));
  });

  describe("searching", () => {
    it("loads products from the server, a page at a time", async () => {
      renderAs();

      expect(await screen.findByText("USB-C Charger")).toBeInTheDocument();
      expect(labelsService.searchProductLabels).toHaveBeenCalledWith({ page: 1, limit: 20 });
      expect(screen.getByText(/SKU-CHG ·/)).toBeInTheDocument();
      expect(screen.getByText(/SKU-CBL · Price not set/)).toBeInTheDocument();
    });

    it("sends the search to the server once 2 characters are typed, and not before", async () => {
      const user = userEvent.setup();
      renderAs();
      await screen.findByText("USB-C Charger");

      await user.type(screen.getByLabelText("Search products"), "c");
      expect(await screen.findByText("Type at least 2 characters to search.")).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 400));
      expect(labelsService.searchProductLabels).toHaveBeenCalledTimes(1);

      await user.type(screen.getByLabelText("Search products"), "ab");
      await waitFor(() =>
        expect(labelsService.searchProductLabels).toHaveBeenLastCalledWith({ search: "cab", page: 1, limit: 20 }),
      );
    });

    it("pages through results with Previous and Next", async () => {
      const user = userEvent.setup();
      labelsService.searchProductLabels.mockResolvedValue(page([charger], { total: 45, totalPages: 3, hasNext: true }));
      renderAs();

      const pager = await screen.findByRole("navigation", { name: "Search products pages" });
      expect(within(pager).getByText("Page 1 of 3")).toBeInTheDocument();
      await user.click(within(pager).getByRole("button", { name: "Next" }));

      await waitFor(() =>
        expect(labelsService.searchProductLabels).toHaveBeenLastCalledWith({ page: 2, limit: 20 }),
      );
    });

    it("shows loading, empty and error states", async () => {
      let finish;
      labelsService.searchProductLabels.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      renderAs();

      const panel = screen.getByRole("tabpanel");
      expect(within(panel).getByText("Loading…")).toBeInTheDocument();
      finish(page([]));
      expect(await within(panel).findByText("No quantity-tracked products found.")).toBeInTheDocument();
    });

    it("shows the server's message when a search fails", async () => {
      labelsService.searchProductLabels.mockRejectedValue({ response: { data: { message: "You do not have permission to access this resource" } } });
      renderAs();

      expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to access this resource");
    });

    it("lists units with their IMEI or serial number and unit code", async () => {
      const user = userEvent.setup();
      renderAs();
      await openItemsTab(user);

      expect(await screen.findByText("IMEI 356938035643809 · SLU00000021")).toBeInTheDocument();
      expect(screen.getByText("S/N LAP-SN-0001 · SLU00000023")).toBeInTheDocument();
    });
  });

  describe("branches", () => {
    it("lets an admin search every branch, or pick one", async () => {
      const user = userEvent.setup();
      renderAs(admin);
      await openItemsTab(user);

      const picker = screen.getByLabelText("Branch");
      expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "All branches",
        "Main Shop",
        "Kandy Branch",
      ]);
      expect(labelsService.searchUnitLabels).toHaveBeenCalledWith({ page: 1, limit: 20 });

      await user.selectOptions(picker, branchB.id);

      await waitFor(() =>
        expect(labelsService.searchUnitLabels).toHaveBeenLastCalledWith({ branchId: branchB.id, page: 1, limit: 20 }),
      );
    });

    it("holds a manager to their own branch: a fixed field, and only their branch is asked for", async () => {
      const user = userEvent.setup();
      renderAs(manager);
      await openItemsTab(user);

      const field = screen.getByLabelText("Branch");
      expect(field.tagName).toBe("INPUT");
      expect(field).toHaveValue("Main Shop");
      expect(field).toHaveAttribute("readonly");
      expect(screen.queryByRole("option", { name: "All branches" })).not.toBeInTheDocument();
      await waitFor(() => expect(labelsService.searchUnitLabels).toHaveBeenCalled());
      for (const [params] of labelsService.searchUnitLabels.mock.calls) {
        expect(params.branchId).toBe(branchA.id);
      }
    });
  });

  describe("the queue", () => {
    it("keeps products and units in the order they were added", async () => {
      const user = userEvent.setup();
      renderAs();

      await user.click(await screen.findByRole("button", { name: "Add Plain Cable" }));
      await openItemsTab(user);
      await user.click(await screen.findByRole("button", { name: "Add iPhone 13 SLU00000022" }));
      await user.click(screen.getByRole("tab", { name: "Products" }));
      await user.click(screen.getByRole("button", { name: "Add USB-C Charger" }));
      await openItemsTab(user);
      await user.click(screen.getByRole("button", { name: "Add Work Laptop SLU00000023" }));

      const items = queueItems();
      expect(items).toHaveLength(4);
      expect(items[0]).toHaveTextContent("Plain Cable");
      expect(items[0]).toHaveTextContent("Product label · SKU-CBL");
      expect(items[1]).toHaveTextContent("iPhone 13");
      expect(items[1]).toHaveTextContent("IMEI 356938035643810 · SLU00000022");
      expect(items[2]).toHaveTextContent("USB-C Charger");
      expect(items[3]).toHaveTextContent("Work Laptop");
      expect(items[3]).toHaveTextContent("S/N LAP-SN-0001 · SLU00000023");
      expect(screen.getByText("4 labels (up to 500)")).toBeInTheDocument();
    });

    it("lets different units of the same product be queued together, each once", async () => {
      const user = userEvent.setup();
      renderAs();
      await openItemsTab(user);

      await user.click(await screen.findByRole("button", { name: "Add iPhone 13 SLU00000021" }));
      await user.click(screen.getByRole("button", { name: "Add iPhone 13 SLU00000022" }));

      expect(queueItems()).toHaveLength(2);
      const queued = screen.getByRole("button", { name: "iPhone 13 SLU00000021 is in the queue" });
      expect(queued).toBeDisabled();
      expect(queued).toHaveTextContent("Added");
    });

    it("never queues a product twice: copies are its quantity", async () => {
      const user = userEvent.setup();
      renderAs();

      await user.click(await screen.findByRole("button", { name: "Add USB-C Charger" }));

      expect(screen.getByRole("button", { name: "USB-C Charger is in the queue" })).toBeDisabled();
      const copies = screen.getByLabelText("Copies of USB-C Charger");
      await user.clear(copies);
      await user.type(copies, "12");
      expect(copies).toHaveValue(12);
      expect(queueItems()).toHaveLength(1);
      expect(screen.getByText("12 labels (up to 500)")).toBeInTheDocument();
    });

    it("removes an entry and clears the queue", async () => {
      const user = userEvent.setup();
      renderAs();
      await user.click(await screen.findByRole("button", { name: "Add USB-C Charger" }));
      await user.click(screen.getByRole("button", { name: "Add Plain Cable" }));

      await user.click(screen.getByRole("button", { name: "Remove USB-C Charger" }));
      expect(queueItems()).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Add USB-C Charger" })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "Clear all" }));
      expect(screen.getByText("Add products or individual items to start a label sheet.")).toBeInTheDocument();
    });

    it("won't preview more than 500 labels", async () => {
      const user = userEvent.setup();
      renderAs();
      await user.click(await screen.findByRole("button", { name: "Add USB-C Charger" }));
      const copies = screen.getByLabelText("Copies of USB-C Charger");
      await user.clear(copies);
      await user.type(copies, "500");
      await openItemsTab(user);
      await user.click(await screen.findByRole("button", { name: "Add iPhone 13 SLU00000021" }));

      expect(screen.getByText(/501 labels — more than the 500-label limit/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Preview labels/ })).toBeDisabled();
      expect(labelsService.resolveLabelQueue).not.toHaveBeenCalled();
    });
  });

  describe("preview and print", () => {
    const buildMixedQueue = async (user) => {
      await user.click(await screen.findByRole("button", { name: "Add USB-C Charger" }));
      const copies = screen.getByLabelText("Copies of USB-C Charger");
      await user.clear(copies);
      await user.type(copies, "2");
      await openItemsTab(user);
      await user.click(await screen.findByRole("button", { name: "Add iPhone 13 SLU00000021" }));
      await user.click(screen.getByRole("button", { name: "Add Work Laptop SLU00000023" }));
    };

    it("resolves the queue in order, then previews labels that encode barcode and unit_code", async () => {
      const user = userEvent.setup();
      renderAs();
      await buildMixedQueue(user);

      expect(screen.getByRole("button", { name: /Print Labels/ })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: /Preview labels/ }));

      expect(labelsService.resolveLabelQueue).toHaveBeenCalledWith({
        items: [
          { type: "PRODUCT", productId: "p-charger", quantity: 2 },
          { type: "UNIT", unitId: "u-phone-a" },
          { type: "UNIT", unitId: "u-laptop" },
        ],
      });
      const sheet = await screen.findByText("4 labels");
      expect(sheet).toBeInTheDocument();
      const barcodes = screen.getAllByRole("img", { name: /^Barcode / }).map((img) => img.getAttribute("aria-label"));
      expect(barcodes).toEqual([
        "Barcode SLP-000010",
        "Barcode SLP-000010",
        "Barcode SLU00000021",
        "Barcode SLU00000023",
      ]);
      expect(screen.getByRole("button", { name: /Print Labels/ })).toBeEnabled();
    });

    it("prints the IMEI and serial number as text only, never as the barcode", async () => {
      const user = userEvent.setup();
      renderAs();
      await buildMixedQueue(user);
      await user.click(screen.getByRole("button", { name: /Preview labels/ }));

      const preview = await screen.findByRole("region", { name: "Preview" });
      expect(within(preview).getByText("IMEI 356938035643809")).toBeInTheDocument();
      expect(within(preview).getByText("S/N LAP-SN-0001")).toBeInTheDocument();
      expect(within(preview).queryByRole("img", { name: "Barcode 356938035643809" })).not.toBeInTheDocument();
      expect(within(preview).queryByRole("img", { name: "Barcode LAP-SN-0001" })).not.toBeInTheDocument();
      expect(within(preview).getAllByText("SOCIO.LK")).toHaveLength(4);
    });

    it("shows the selling price and leaves a missing price off", async () => {
      const user = userEvent.setup();
      renderAs();
      await buildMixedQueue(user);
      await user.click(screen.getByRole("button", { name: /Preview labels/ }));

      const preview = await screen.findByRole("region", { name: "Preview" });
      await within(preview).findAllByText(/4,500/);
      expect(within(preview).getAllByText(/4,500/)).toHaveLength(2);
      expect(within(preview).getAllByText(/185,000/)).toHaveLength(1);
      // The laptop has no selling price: its label shows none.
      const laptopLabel = within(preview).getByText("S/N LAP-SN-0001").closest("article");
      expect(laptopLabel.querySelector(".barcode-price")).toBeNull();
    });

    it("prints only a preview that matches the current queue", async () => {
      const user = userEvent.setup();
      const print = vi.spyOn(window, "print").mockImplementation(() => {});
      renderAs();
      await buildMixedQueue(user);
      await user.click(screen.getByRole("button", { name: /Preview labels/ }));
      await screen.findByText("4 labels");

      await user.click(screen.getByRole("button", { name: /Print Labels/ }));
      expect(print).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "Remove Work Laptop SLU00000023" }));
      expect(screen.getByText("The queue has changed. Preview the labels again before printing.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Print Labels/ })).toBeDisabled();
      expect(screen.queryAllByRole("img", { name: /^Barcode / })).toHaveLength(0);
      print.mockRestore();
    });

    it("shows each rejected item's reason and prints nothing", async () => {
      const user = userEvent.setup();
      labelsService.resolveLabelQueue.mockRejectedValue({
        response: {
          status: 400,
          data: {
            message: "Some items in the label queue cannot be printed.",
            code: "INVALID_LABEL_ITEMS",
            errors: [{ index: 1, reason: "UNIT_NOT_IN_STOCK", message: "This unit is not in stock." }],
          },
        },
      });
      renderAs();
      await buildMixedQueue(user);

      await user.click(screen.getByRole("button", { name: /Preview labels/ }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "1 item in the queue can't be printed. Remove or change it, then preview again. Nothing will print until every item is valid.",
      );
      const [first, second, third] = queueItems();
      expect(within(second).getByText("This unit is not in stock.")).toBeInTheDocument();
      expect(within(first).queryByText("This unit is not in stock.")).not.toBeInTheDocument();
      expect(within(third).queryByText("This unit is not in stock.")).not.toBeInTheDocument();
      expect(screen.queryAllByRole("img", { name: /^Barcode / })).toHaveLength(0);
      expect(screen.getByRole("button", { name: /Print Labels/ })).toBeDisabled();

      // Removing the bad item clears its message; the queue keeps the rest.
      await user.click(screen.getByRole("button", { name: "Remove iPhone 13 SLU00000021" }));
      expect(screen.queryByText("This unit is not in stock.")).not.toBeInTheDocument();
      expect(queueItems()).toHaveLength(2);
    });

    it("shows the server's limit and validation messages", async () => {
      const user = userEvent.setup();
      labelsService.resolveLabelQueue.mockRejectedValueOnce({
        response: { status: 400, data: { code: "LABEL_LIMIT_EXCEEDED", message: "A label queue can hold at most 500 labels; this one has 501." } },
      });
      renderAs();
      await buildMixedQueue(user);

      await user.click(screen.getByRole("button", { name: /Preview labels/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent("A label queue can hold at most 500 labels; this one has 501.");

      labelsService.resolveLabelQueue.mockRejectedValueOnce({
        response: { status: 403, data: { code: "WRONG_BRANCH", message: "You can only access data for your own branch." } },
      });
      await user.click(screen.getByRole("button", { name: /Preview labels/ }));
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent("You can only access data for your own branch."),
      );
    });
  });

  describe("cost prices", () => {
    it("offers no cost-price option: only the selling price", async () => {
      renderAs();
      await screen.findByText("USB-C Charger");

      // The old "Price shown" select offered "Cost price".
      expect(screen.queryByText("Cost price")).not.toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /cost|buying/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: /cost|buying/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Price shown")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Selling price")).toBeChecked();
      expect(screen.getByText("Labels show the selling price. Cost prices are never printed.")).toBeInTheDocument();
    });

    it("never prints a cost value, even if a response carried one", async () => {
      const user = userEvent.setup();
      labelsService.resolveLabelQueue.mockResolvedValue({
        data: [{ ...charger, quantity: 1, buying_price: "1234.00" }],
        total_labels: 1,
      });
      renderAs();
      await user.click(await screen.findByRole("button", { name: "Add USB-C Charger" }));
      await user.click(screen.getByRole("button", { name: /Preview labels/ }));

      const preview = await screen.findByRole("region", { name: "Preview" });
      await within(preview).findByRole("img", { name: "Barcode SLP-000010" });
      expect(preview).not.toHaveTextContent(/1,234/);
    });
  });
});
