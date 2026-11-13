import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BarcodeLabels from "./index";
import * as labelsService from "../../services/barcodeLabelsService";
import * as branchesService from "../../services/branchesService";
import { authState, renderWithProviders } from "../../test/renderWithProviders";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";

// Vitest runs from frontend/.
const indexCss = readFileSync(join(cwd(), "src", "index.css"), "utf8");

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
      expect(labelsService.searchProductLabels).toHaveBeenCalledWith({ page: 1, limit: 10 });
      const chargerRow = screen.getByText("USB-C Charger").closest("li");
      expect(chargerRow).toHaveTextContent("SKU-CHG");
      expect(chargerRow).toHaveTextContent("SLP-000010");
      expect(chargerRow).toHaveTextContent(/4,500/);
      expect(screen.getByText("Plain Cable").closest("li")).toHaveTextContent("No price");
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
        expect(labelsService.searchProductLabels).toHaveBeenLastCalledWith({ search: "cab", page: 1, limit: 10 }),
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
        expect(labelsService.searchProductLabels).toHaveBeenLastCalledWith({ page: 2, limit: 10 }),
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

      const phoneRow = (await screen.findByText("IMEI 356938035643809")).closest("li");
      expect(phoneRow).toHaveTextContent("SLU00000021");
      expect(phoneRow).toHaveTextContent("Main Shop");
      const laptopRow = screen.getByText("S/N LAP-SN-0001").closest("li");
      expect(laptopRow).toHaveTextContent("SLU00000023");
      expect(laptopRow).toHaveTextContent("No price");
    });

    it("shows the result count, and clears the search with one click", async () => {
      const user = userEvent.setup();
      renderAs();
      expect(await screen.findByText("2 results")).toBeInTheDocument();

      await user.type(screen.getByLabelText("Search products"), "cable");
      await waitFor(() =>
        expect(labelsService.searchProductLabels).toHaveBeenLastCalledWith({ search: "cable", page: 1, limit: 10 }),
      );
      await user.click(screen.getByRole("button", { name: "Clear search products" }));

      expect(screen.getByLabelText("Search products")).toHaveValue("");
      await waitFor(() =>
        expect(labelsService.searchProductLabels).toHaveBeenLastCalledWith({ page: 1, limit: 10 }),
      );
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
      expect(labelsService.searchUnitLabels).toHaveBeenCalledWith({ page: 1, limit: 10 });

      await user.selectOptions(picker, branchB.id);

      await waitFor(() =>
        expect(labelsService.searchUnitLabels).toHaveBeenLastCalledWith({ branchId: branchB.id, page: 1, limit: 10 }),
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
      expect(within(items[0]).getByText("Product")).toBeInTheDocument();
      expect(within(items[1]).getByText("Unit")).toBeInTheDocument();
      expect(screen.getByRole("status", { name: "Queue total" })).toHaveTextContent("4 entries · 4 labels (up to 500)");
      // Each tab counts what it has queued.
      expect(screen.getByRole("tab", { name: /Products/ })).toHaveTextContent("2");
      expect(screen.getByRole("tab", { name: /Individual items/ })).toHaveTextContent("2");
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
      expect(screen.getByRole("status", { name: "Queue total" })).toHaveTextContent("12 labels (up to 500)");
    });

    it("steps copies with − and +, within 1–500", async () => {
      const user = userEvent.setup();
      renderAs();
      await user.click(await screen.findByRole("button", { name: "Add USB-C Charger" }));

      const fewer = screen.getByRole("button", { name: "Fewer copies of USB-C Charger" });
      expect(fewer).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "More copies of USB-C Charger" }));
      await user.click(screen.getByRole("button", { name: "More copies of USB-C Charger" }));
      expect(screen.getByLabelText("Copies of USB-C Charger")).toHaveValue(3);
      await user.click(fewer);
      expect(screen.getByLabelText("Copies of USB-C Charger")).toHaveValue(2);
      expect(screen.getByRole("status", { name: "Queue total" })).toHaveTextContent("2 labels");
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

      expect(screen.getByRole("status", { name: "Queue total" })).toHaveTextContent(/501 labels — more than the 500-label limit/);
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
      expect(await screen.findByText("4 labels to print")).toBeInTheDocument();
      // The screen preview shows each queue row once, in order; a product's
      // copies are counted, not repeated.
      const rows = within(screen.getByRole("list", { name: "Label preview" })).getAllByRole("listitem");
      expect(rows).toHaveLength(3);
      expect(rows[0]).toHaveTextContent("Labels 1–2 of 4");
      expect(rows[0]).toHaveTextContent("× 2 copies");
      expect(rows[1]).toHaveTextContent("Label 3 of 4");
      expect(rows[2]).toHaveTextContent("Label 4 of 4");
      const barcodes = screen.getAllByRole("img", { name: /^Barcode / }).map((img) => img.getAttribute("aria-label"));
      expect(barcodes).toEqual(["Barcode SLP-000010", "Barcode SLU00000021", "Barcode SLU00000023"]);
      expect(screen.getByText("Preview is up to date. Ready to print.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Print Labels/ })).toBeEnabled();
    });

    it("prints every copy at its printed size, from a sheet kept out of the screen preview", async () => {
      const user = userEvent.setup();
      const { container } = renderAs();
      await buildMixedQueue(user);
      await user.click(screen.getByRole("button", { name: /Preview labels/ }));
      await screen.findByText("4 labels to print");

      // Outside the app root, in its own <body> child, so the global print
      // rule (index.css) doesn't hide it with the rest of the app.
      expect(container.querySelector(".barcode-print-sheet")).toBeNull();
      const sheet = document.querySelector("body > #barcode-label-print-root > .barcode-print-sheet");
      expect(sheet).toHaveAttribute("aria-hidden", "true");
      const printed = [...sheet.querySelectorAll(".barcode-label")];
      expect(printed.map((label) => label.querySelector("svg").getAttribute("aria-label"))).toEqual([
        "Barcode SLP-000010",
        "Barcode SLP-000010",
        "Barcode SLU00000021",
        "Barcode SLU00000023",
      ]);
      for (const label of printed) {
        expect(label.style.width).toBe("50mm");
        expect(label.style.height).toBe("25mm");
      }

      await user.selectOptions(screen.getByLabelText("Label size"), "30x20");
      for (const label of sheet.querySelectorAll(".barcode-label")) {
        expect(label.style.width).toBe("30mm");
        expect(label.style.height).toBe("20mm");
      }
      expect(container.querySelector("style").textContent).toContain(
        ".barcode-print-sheet .barcode-label { width:30mm !important; height:20mm !important;",
      );
    });

    it("zooms the screen preview without changing the printed size", async () => {
      const user = userEvent.setup();
      const { container } = renderAs();
      await buildMixedQueue(user);
      await user.click(screen.getByRole("button", { name: /Preview labels/ }));
      await screen.findByText("4 labels to print");

      const zoom = screen.getByRole("group", { name: "Preview zoom" });
      expect(within(zoom).getByRole("button", { name: "200%" })).toHaveAttribute("aria-pressed", "true");
      await user.click(within(zoom).getByRole("button", { name: "150%" }));

      const frame = container.querySelector(".barcode-zoom");
      expect(frame.style.transform).toBe("scale(1.5)");
      expect(frame.parentElement.style.width).toBe("75mm");
      expect(frame.parentElement.style.height).toBe("37.5mm");
      for (const label of document.querySelectorAll(".barcode-print-sheet .barcode-label")) {
        expect(label.style.width).toBe("50mm");
      }
    });

    it("warns, per label, when a label's lines don't fit the chosen size", async () => {
      const user = userEvent.setup();
      // jsdom has no layout: say every unit label overflows, nothing else does.
      const isUnitFace = (el) =>
        el.classList?.contains("barcode-label") && el.closest("[data-entry-key]")?.dataset.entryKey.includes("u-");
      const scroll = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function () {
        return isUnitFace(this) ? 120 : 0;
      });
      const client = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function () {
        return isUnitFace(this) ? 94 : 0;
      });
      renderAs();
      await buildMixedQueue(user);
      await user.click(screen.getByRole("button", { name: /Preview labels/ }));
      await screen.findByText("4 labels to print");

      expect(screen.getByText(/2 labels don’t fit on 50 × 25 mm: the last lines would be cut off/)).toBeInTheDocument();
      const rows = within(screen.getByRole("list", { name: "Label preview" })).getAllByRole("listitem");
      expect(within(rows[0]).queryByText("Doesn’t fit")).not.toBeInTheDocument();
      expect(within(rows[1]).getByText("Doesn’t fit")).toBeInTheDocument();
      expect(within(rows[2]).getByText("Doesn’t fit")).toBeInTheDocument();
      scroll.mockRestore();
      client.mockRestore();
    });

    it("shows no fit warning when every label fits", async () => {
      const user = userEvent.setup();
      renderAs();
      await buildMixedQueue(user);
      await user.click(screen.getByRole("button", { name: /Preview labels/ }));
      await screen.findByText("4 labels to print");

      expect(screen.queryByText(/fit on 50 × 25 mm/)).not.toBeInTheDocument();
      expect(screen.queryByText("Doesn’t fit")).not.toBeInTheDocument();
    });

    it("keeps the print root only while the page is open", () => {
      const { unmount } = renderAs();
      expect(document.querySelectorAll("body > #barcode-label-print-root")).toHaveLength(1);

      unmount();
      expect(document.querySelector("#barcode-label-print-root")).toBeNull();
    });

    it("is not hidden by the global print rule that keeps receipts alone on the page", () => {
      const printRules = indexCss.slice(indexCss.indexOf("@media print"));
      expect(printRules).toContain("body > *:not(#receipt-root):not(#barcode-label-print-root)");
      expect(printRules).not.toMatch(/body > \*:not\(#receipt-root\) \{/);
    });

    it("prints the IMEI and serial number as text only, never as the barcode", async () => {
      const user = userEvent.setup();
      renderAs();
      await buildMixedQueue(user);
      await user.click(screen.getByRole("button", { name: /Preview labels/ }));

      const preview = await screen.findByRole("region", { name: "Preview and print" });
      await within(preview).findByText("IMEI 356938035643809");
      expect(within(preview).getByText("S/N LAP-SN-0001")).toBeInTheDocument();
      expect(within(preview).getByText("IMEI (text only)")).toBeInTheDocument();
      expect(within(preview).getByText("Serial number (text only)")).toBeInTheDocument();
      expect(within(preview).queryByRole("img", { name: "Barcode 356938035643809" })).not.toBeInTheDocument();
      expect(within(preview).queryByRole("img", { name: "Barcode LAP-SN-0001" })).not.toBeInTheDocument();
      expect(within(preview).getAllByText("SOCIO.LK")).toHaveLength(3);
      // The printed sheet: never an IMEI or serial number as a barcode either.
      const printedCodes = [...document.querySelectorAll(".barcode-print-sheet svg")].map((svg) => svg.getAttribute("aria-label"));
      expect(printedCodes).not.toContain("Barcode 356938035643809");
      expect(printedCodes).not.toContain("Barcode LAP-SN-0001");
      expect(document.querySelectorAll(".barcode-print-sheet .barcode-brand")).toHaveLength(4);
    });

    it("shows the selling price and leaves a missing price off", async () => {
      const user = userEvent.setup();
      renderAs();
      await buildMixedQueue(user);
      await user.click(screen.getByRole("button", { name: /Preview labels/ }));

      const preview = await screen.findByRole("region", { name: "Preview and print" });
      await within(preview).findAllByText(/4,500/);
      // On the label face and in its details, once per preview row.
      expect(within(preview).getAllByText(/4,500/)).toHaveLength(2);
      expect(within(preview).getAllByText(/185,000/)).toHaveLength(2);
      // The laptop has no selling price: its label shows none.
      const laptopLabel = within(preview).getByText("S/N LAP-SN-0001").closest("article");
      expect(laptopLabel.querySelector(".barcode-price")).toBeNull();
      expect(within(preview).getByText("Not set: no price printed")).toBeInTheDocument();
    });

    it("prints only a preview that matches the current queue", async () => {
      const user = userEvent.setup();
      const print = vi.spyOn(window, "print").mockImplementation(() => {});
      renderAs();
      await buildMixedQueue(user);
      await user.click(screen.getByRole("button", { name: /Preview labels/ }));
      await screen.findByText("4 labels to print");

      await user.click(screen.getByRole("button", { name: /Print Labels/ }));
      expect(print).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "Remove Work Laptop SLU00000023" }));
      expect(screen.getByText("The queue has changed. Preview the labels again before printing.")).toBeInTheDocument();
      expect(screen.getByText("The queue changed after the last preview. Preview again before printing.")).toBeInTheDocument();
      expect(document.querySelectorAll(".barcode-print-sheet .barcode-label")).toHaveLength(0);
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
      expect(screen.getByText(/labels show the selling price, never a cost price/)).toBeInTheDocument();
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

      const preview = await screen.findByRole("region", { name: "Preview and print" });
      await within(preview).findByRole("img", { name: "Barcode SLP-000010" });
      expect(preview).not.toHaveTextContent(/1,234/);
      expect(document.querySelector(".barcode-print-sheet")).not.toHaveTextContent(/1,234/);
    });
  });
});
