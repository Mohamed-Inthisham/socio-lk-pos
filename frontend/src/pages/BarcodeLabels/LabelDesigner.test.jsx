import { vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BarcodeLabels from "./index";
import * as labelsService from "../../services/barcodeLabelsService";
import * as branchesService from "../../services/branchesService";
import { authState, renderWithProviders } from "../../test/renderWithProviders";
import { defaultLayout } from "./labelDesign";

vi.mock("../../services/barcodeLabelsService");
vi.mock("../../services/branchesService");

/**
 * The visual label designer: click an item to select it, drag it or nudge
 * it with the arrow keys, and edit it from the toolbar. Every change is
 * checked on the printed sheet: the designer, the preview and the sheet
 * use the same layout.
 */

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
const phone = {
  kind: "UNIT",
  unit_id: "u-phone",
  unit_code: "SLU00000021",
  product_id: "p-phone",
  name: "iPhone 13",
  tracking_method: "IMEI",
  identifier_type: "IMEI",
  identifier: "356938035643809",
  selling_price: "185000.00",
  branch: { id: "branch-a", name: "Main Shop" },
};
const page = (data) => ({ data, meta: { total: data.length, page: 1, limit: 10, totalPages: 1, hasNext: false, hasPrev: false } });
const admin = { id: "user-admin", role: "admin", branch_id: null, branch: null };

const printedFor = (kind) =>
  [...document.querySelectorAll(".barcode-print-sheet .barcode-label")].find((label) =>
    kind === "UNIT" ? label.querySelector(".barcode-identifier") : !label.querySelector(".barcode-identifier"),
  );
const printedItem = (kind, id) => printedFor(kind).querySelector(`.barcode-${id}`);
const canvas = () => screen.getByRole("article", { name: /label design/ });
const canvasItem = (name) => within(canvas()).getByRole("button", { name });
const toolbar = () => screen.getByRole("toolbar", { name: "Selected item" });

/** Queue a product and a phone, and preview them, so the sheet has both. */
const previewBoth = async () => {
  const user = userEvent.setup();
  const view = renderWithProviders(<BarcodeLabels />, { preloadedState: { auth: authState(admin) } });
  await user.click(await screen.findByRole("button", { name: "Add USB-C Charger" }));
  await user.click(screen.getByRole("tab", { name: /Individual items/ }));
  await user.click(await screen.findByRole("button", { name: "Add iPhone 13 SLU00000021" }));
  await user.click(screen.getByRole("button", { name: /Preview labels/ }));
  await screen.findByText("2 labels to print");
  return { user, ...view };
};

describe("BarcodeLabels: visual label designer", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    branchesService.listBranches.mockResolvedValue([]);
    labelsService.searchProductLabels.mockResolvedValue(page([charger]));
    labelsService.searchUnitLabels.mockResolvedValue(page([phone]));
    labelsService.resolveLabelQueue.mockResolvedValue({ data: [{ ...charger, quantity: 1 }, phone], total_labels: 2 });
  });

  it("draws the label with every item, and asks to click one", async () => {
    renderWithProviders(<BarcodeLabels />, { preloadedState: { auth: authState(admin) } });

    expect(canvas()).toHaveAccessibleName("Product label design, 50 × 25 mm");
    expect(within(canvas()).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "SOCIO.LK brand",
      "Name",
      "Barcode",
      "Code text",
      "Selling price",
    ]);
    expect(toolbar()).toHaveTextContent("Click an item on the label to edit it");
    // The canvas shows sample text, and its barcode is decorative.
    expect(within(canvas()).queryByRole("img")).not.toBeInTheDocument();
  });

  it("prints the default layout: items stacked, at the label's size", async () => {
    await previewBoth();
    const layout = defaultLayout("50x25", "UNIT");

    expect(printedFor("UNIT").style).toMatchObject({ width: "50mm", height: "25mm" });
    for (const id of ["brand", "name", "barcode", "code", "identifier", "price"]) {
      expect(printedItem("UNIT", id).style.top).toBe(`${layout[id].y}mm`);
    }
    expect(printedItem("UNIT", "price").querySelector(".barcode-text").style).toMatchObject({ fontSize: "8pt", fontWeight: "700" });
  });

  it("edits the selected item from the toolbar: font size, bold, italic, alignment", async () => {
    const { user } = await previewBoth();

    await user.click(canvasItem("Selling price"));
    expect(within(toolbar()).getByText("Selling price")).toBeInTheDocument();
    await user.click(within(toolbar()).getByRole("button", { name: "Increase Font size" }));
    await user.click(within(toolbar()).getByRole("button", { name: "Increase Font size" }));
    await user.click(within(toolbar()).getByRole("button", { name: "Bold" }));
    await user.click(within(toolbar()).getByRole("button", { name: "Italic" }));
    await user.click(within(toolbar()).getByRole("button", { name: "Align right" }));

    expect(printedItem("PRODUCT", "price").querySelector(".barcode-text").style).toMatchObject({
      fontSize: "9pt",
      fontWeight: "400",
      fontStyle: "italic",
      textAlign: "right",
    });
    // The product template only: unit labels keep their price as it was.
    expect(printedItem("UNIT", "price").querySelector(".barcode-text").style.fontStyle).toBe("normal");
  });

  it("drags an item to a new position, in 0.5 mm steps", async () => {
    await previewBoth();
    const start = defaultLayout("50x25", "PRODUCT").price;
    const item = canvasItem("Selling price");

    // 10 screen px per mm on the canvas: 50 px right, 23 px up.
    fireEvent.pointerDown(item, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(item, { clientX: 150, clientY: 77, pointerId: 1 });
    fireEvent.pointerUp(item, { clientX: 150, clientY: 77, pointerId: 1 });

    const x = Math.min(start.x + 5, 50 - start.widthMm);
    const y = Math.round((start.y - 2.3) / 0.5) * 0.5;
    expect(printedItem("PRODUCT", "price").style).toMatchObject({ left: `${x}mm`, top: `${y}mm` });
  });

  it("nudges the selected item with the arrow keys, Shift for 2 mm", async () => {
    const { user } = await previewBoth();
    const start = defaultLayout("50x25", "PRODUCT").brand;

    await user.click(canvasItem("SOCIO.LK brand"));
    await user.click(within(toolbar()).getByRole("button", { name: "Decrease Width" }));
    await user.click(within(toolbar()).getByRole("button", { name: "Decrease Width" }));
    canvasItem("SOCIO.LK brand").focus();
    await user.keyboard("{ArrowRight}{Shift>}{ArrowDown}{/Shift}");

    expect(printedItem("PRODUCT", "brand").style).toMatchObject({
      width: `${start.widthMm - 1}mm`,
      left: `${start.x + 0.5}mm`,
      top: `${Math.round((start.y + 2) / 0.5) * 0.5}mm`,
    });
  });

  it("sets an exact position with the X and Y fields", async () => {
    const { user } = await previewBoth();

    await user.click(canvasItem("Code text"));
    const x = within(toolbar()).getByLabelText("X position");
    await user.clear(x);
    await user.type(x, "2");
    const y = within(toolbar()).getByLabelText("Y position");
    await user.clear(y);
    await user.type(y, "1");

    expect(printedItem("PRODUCT", "code").style).toMatchObject({ left: "2mm", top: "1mm" });
  });

  it("rotates one item a quarter turn at a time, inside the same label", async () => {
    const { user } = await previewBoth();

    await user.click(canvasItem("Selling price"));
    await user.click(within(toolbar()).getByRole("button", { name: "Rotate (now 0°)" }));
    await user.click(within(toolbar()).getByRole("button", { name: "Rotate (now 90°)" }));

    expect(printedItem("PRODUCT", "price").style.transform).toBe("rotate(180deg)");
    expect(printedItem("PRODUCT", "name").style.transform).toBe("");
    expect(printedFor("PRODUCT").style).toMatchObject({ width: "50mm", height: "25mm" });
  });

  it("turns a full-width item upright to fit, then lets it move anywhere it fits", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BarcodeLabels />, { preloadedState: { auth: authState(admin) } });
    await user.selectOptions(screen.getByLabelText("Label size"), "30x20");

    await user.click(canvasItem("SOCIO.LK brand"));
    expect(within(toolbar()).getByLabelText("Width")).toHaveValue(27);
    await user.click(within(toolbar()).getByRole("button", { name: "Rotate (now 0°)" }));

    expect(within(toolbar()).getByLabelText("Width")).toHaveValue(17);
    expect(within(toolbar()).getByRole("button", { name: "Increase Width" })).toBeDisabled();
    // Nudge it all the way right: well past the 3 mm an unturned 27 mm box allowed.
    canvasItem("SOCIO.LK brand").focus();
    for (let i = 0; i < 10; i += 1) await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    const x = Number(within(toolbar()).getByLabelText("X position").value);
    expect(x + 17 / 2).toBeGreaterThan(27); // its centre near the right edge
  });

  it("sets the barcode's height and width", async () => {
    const { user } = await previewBoth();
    const start = defaultLayout("50x25", "PRODUCT").barcode;

    await user.click(canvasItem("Barcode"));
    expect(within(toolbar()).queryByRole("button", { name: "Bold" })).not.toBeInTheDocument();
    await user.click(within(toolbar()).getByRole("button", { name: "Decrease Height" }));
    await user.click(within(toolbar()).getByRole("button", { name: "Decrease Width" }));

    expect(printedItem("PRODUCT", "barcode").style).toMatchObject({
      height: `${start.heightMm - 0.5}mm`,
      width: `${start.widthMm - 0.5}mm`,
    });
    expect(printedItem("PRODUCT", "barcode").querySelector("svg")).toHaveAttribute("aria-label", "Barcode SLP-000010");
  });

  it("hides only optional items: the brand, barcode and IMEI always print", async () => {
    const { user } = await previewBoth();

    for (const name of ["SOCIO.LK brand", "Barcode"]) {
      await user.click(canvasItem(name));
      expect(within(toolbar()).queryByRole("button", { name: /Shown|Hidden/ })).not.toBeInTheDocument();
    }
    await user.click(canvasItem("Name"));
    await user.click(within(toolbar()).getByRole("button", { name: "Shown" }));

    expect(canvasItem("Name (hidden)")).toBeInTheDocument();
    expect(printedItem("PRODUCT", "name")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Unit label/ }));
    await user.click(canvasItem("IMEI / serial"));
    expect(within(toolbar()).queryByRole("button", { name: /Shown|Hidden/ })).not.toBeInTheDocument();
  });

  it("keeps a layout per template and per label size", async () => {
    const { user } = await previewBoth();

    await user.click(screen.getByRole("button", { name: /Unit label/ }));
    expect(canvas()).toHaveAccessibleName("Unit label design, 50 × 25 mm");
    await user.click(canvasItem("IMEI / serial"));
    await user.click(within(toolbar()).getByRole("button", { name: "Bold" }));
    expect(printedItem("UNIT", "identifier").querySelector(".barcode-text").style.fontWeight).toBe("700");

    await user.selectOptions(screen.getByLabelText("Label size"), "40x20");
    expect(canvas()).toHaveAccessibleName("Unit label design, 40 × 20 mm");
    expect(printedItem("UNIT", "identifier").querySelector(".barcode-text").style.fontWeight).toBe("400");

    await user.selectOptions(screen.getByLabelText("Label size"), "50x25");
    expect(printedItem("UNIT", "identifier").querySelector(".barcode-text").style.fontWeight).toBe("700");
  });

  it("remembers the layout for next time, and resets it", async () => {
    const first = await previewBoth();
    await first.user.click(canvasItem("Selling price"));
    await first.user.click(within(toolbar()).getByRole("button", { name: "Italic" }));
    first.unmount();

    const again = await previewBoth();
    expect(printedItem("PRODUCT", "price").querySelector(".barcode-text").style.fontStyle).toBe("italic");

    await again.user.click(screen.getByRole("button", { name: "Reset layout" }));
    expect(printedItem("PRODUCT", "price").querySelector(".barcode-text").style.fontStyle).toBe("normal");
    expect(screen.getByRole("button", { name: "Reset layout" })).toBeDisabled();
  });

  const stubBoxes = (boxes) =>
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const rect = ([left, top, right, bottom]) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
      if (this.classList.contains("designer-canvas")) return rect([0, 0, 500, 250]);
      const id = Object.keys(boxes).find((key) => this.classList.contains(`barcode-${key}`) && this.closest(".designer-canvas"));
      return rect(id ? boxes[id] : [0, 0, 0, 0]);
    });

  it("flags an item that goes past the label's edge", async () => {
    const spy = stubBoxes({ price: [450, 200, 560, 230] });
    renderWithProviders(<BarcodeLabels />, { preloadedState: { auth: authState(admin) } });

    expect(await screen.findByText(/Selling price: past the label edge, overlapping another item, or cut short/)).toBeInTheDocument();
    expect(canvasItem("Selling price")).toHaveClass("designer-bad");
    expect(canvasItem("Name")).not.toHaveClass("designer-bad");
    spy.mockRestore();
  });

  it("flags two items that overlap, both of them", async () => {
    const spy = stubBoxes({ code: [10, 150, 200, 170], price: [100, 160, 300, 190] });
    renderWithProviders(<BarcodeLabels />, { preloadedState: { auth: authState(admin) } });

    expect(await screen.findByText(/Code text, Selling price: past the label edge, overlapping another item/)).toBeInTheDocument();
    expect(canvasItem("Code text")).toHaveClass("designer-bad");
    expect(canvasItem("Selling price")).toHaveClass("designer-bad");
    spy.mockRestore();
  });

  it("selects any item from the picker, even one covered on the canvas, and brings it to the front", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BarcodeLabels />, { preloadedState: { auth: authState(admin) } });
    const picker = screen.getByRole("group", { name: "Select item" });

    await user.click(within(picker).getByRole("button", { name: "Code text" }));

    expect(within(picker).getByRole("button", { name: "Code text" })).toHaveAttribute("aria-pressed", "true");
    expect(within(toolbar()).getByText("Code text")).toBeInTheDocument();
    expect(canvasItem("Code text").style.zIndex).toBe("2");
    expect(canvasItem("Selling price").style.zIndex).toBe("1");
  });

  it("never prints the IMEI as the barcode, whatever the layout", async () => {
    const { user } = await previewBoth();
    await user.click(screen.getByRole("button", { name: /Unit label/ }));
    await user.click(canvasItem("Barcode"));
    await user.click(within(toolbar()).getByRole("button", { name: "Rotate (now 0°)" }));

    const codes = [...document.querySelectorAll(".barcode-print-sheet svg")].map((svg) => svg.getAttribute("aria-label"));
    expect(codes).toEqual(["Barcode SLP-000010", "Barcode SLU00000021"]);
  });
});
