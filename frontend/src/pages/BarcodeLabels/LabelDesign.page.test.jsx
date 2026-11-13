import { vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BarcodeLabels from "./index";
import * as labelsService from "../../services/barcodeLabelsService";
import * as branchesService from "../../services/branchesService";
import { authState, renderWithProviders } from "../../test/renderWithProviders";

vi.mock("../../services/barcodeLabelsService");
vi.mock("../../services/branchesService");

/**
 * The Label design panel: order, text size, bold, italic, alignment,
 * barcode height and rotation. Each change is checked on the printed sheet,
 * not only the preview: the same LabelFace draws both.
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

const printed = () => document.querySelector(".barcode-print-sheet .barcode-label");
const printedLine = (id) => printed().querySelector(`.barcode-${id}`);
const printedOrder = () =>
  [...printed().querySelector(".barcode-content").children].map((el) =>
    el.tagName.toLowerCase() === "svg" ? "barcode" : [...el.classList].find((c) => c !== "barcode-line").replace("barcode-", ""),
  );
const design = () => screen.getByRole("region", { name: "Label design" });

const previewPhone = async () => {
  const user = userEvent.setup();
  const view = renderWithProviders(<BarcodeLabels />, { preloadedState: { auth: authState(admin) } });
  await user.click(screen.getByRole("tab", { name: /Individual items/ }));
  await user.click(await screen.findByRole("button", { name: "Add iPhone 13 SLU00000021" }));
  await user.click(screen.getByRole("button", { name: /Preview labels/ }));
  await screen.findByText("1 label to print");
  return { user, ...view };
};

describe("BarcodeLabels: label design", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    branchesService.listBranches.mockResolvedValue([]);
    labelsService.searchProductLabels.mockResolvedValue(page([charger]));
    labelsService.searchUnitLabels.mockResolvedValue(page([phone]));
    labelsService.resolveLabelQueue.mockResolvedValue({ data: [phone], total_labels: 1 });
  });

  it("prints the default design: the usual order and look", async () => {
    await previewPhone();

    expect(printedOrder()).toEqual(["brand", "name", "barcode", "code", "identifier", "price"]);
    expect(printedLine("price").style).toMatchObject({ fontSize: "8pt", fontWeight: "700", fontStyle: "normal", textAlign: "center" });
    expect(printedLine("brand")).toHaveTextContent("SOCIO.LK");
    expect(printedLine("identifier")).toHaveTextContent("IMEI 356938035643809");
  });

  it("makes a line bold, italic, larger and left-aligned, in print as on screen", async () => {
    const { user } = await previewPhone();
    const panel = design();

    await user.click(within(panel).getByRole("button", { name: "Bold Name" }));
    await user.click(within(panel).getByRole("button", { name: "Italic Name" }));
    await user.click(within(panel).getByRole("button", { name: "Larger Name text size" }));
    await user.click(within(panel).getByRole("button", { name: "Larger Name text size" }));
    await user.click(within(panel).getByRole("button", { name: "Align Name left" }));

    expect(within(panel).getByRole("button", { name: "Bold Name" })).toHaveAttribute("aria-pressed", "false");
    expect(within(panel).getByLabelText("Name text size")).toHaveValue(8);
    expect(printedLine("name").style).toMatchObject({ fontSize: "8pt", fontWeight: "400", fontStyle: "italic", textAlign: "left" });
    const previewName = screen.getByRole("list", { name: "Label preview" }).querySelector(".barcode-name");
    expect(previewName.style).toMatchObject({ fontSize: "8pt", fontStyle: "italic", textAlign: "left" });
  });

  it("moves lines to new positions on the label", async () => {
    const { user } = await previewPhone();
    const panel = design();

    await user.click(within(panel).getByRole("button", { name: "Move Selling price up" }));
    await user.click(within(panel).getByRole("button", { name: "Move Selling price up" }));
    await user.click(within(panel).getByRole("button", { name: "Move SOCIO.LK brand down" }));

    expect(printedOrder()).toEqual(["name", "brand", "barcode", "price", "code", "identifier"]);
    expect(within(panel).getByRole("button", { name: "Move Name up" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Move IMEI / serial down" })).toBeDisabled();
  });

  it("rotates the content inside the same label size", async () => {
    const { user } = await previewPhone();

    await user.click(within(design()).getByRole("button", { name: "90°" }));

    expect(printed().style).toMatchObject({ width: "50mm", height: "25mm" });
    const content = printed().querySelector(".barcode-content");
    expect(content.style.transform).toBe("translate(-50%, -50%) rotate(90deg)");
    expect(content.style).toMatchObject({ width: "22mm", height: "47mm" });
  });

  it("sets the barcode height", async () => {
    const { user } = await previewPhone();

    await user.click(within(design()).getByRole("button", { name: "Smaller Barcode height" }));

    expect(printed().querySelector(".barcode-svg").style.height).toBe("11mm");
    expect(printed().querySelector(".barcode-svg")).toHaveAttribute("aria-label", "Barcode SLU00000021");
  });

  it("hides only the optional lines: the brand, barcode and IMEI always print", async () => {
    const { user } = await previewPhone();
    const panel = design();

    expect(within(panel).queryByRole("checkbox", { name: "SOCIO.LK brand" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("checkbox", { name: "IMEI / serial" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("checkbox", { name: "Barcode" })).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("checkbox", { name: "Name" }));
    await user.click(within(panel).getByRole("checkbox", { name: "Code text" }));
    await user.click(within(panel).getByRole("checkbox", { name: "Selling price" }));

    expect(printedOrder()).toEqual(["brand", "barcode", "identifier"]);
  });

  it("remembers the design for next time, and resets to the default", async () => {
    const { user, unmount } = await previewPhone();
    await user.click(within(design()).getByRole("button", { name: "Italic Selling price" }));
    await user.click(within(design()).getByRole("button", { name: "180°" }));
    unmount();

    const again = await previewPhone();
    expect(printedLine("price").style.fontStyle).toBe("italic");
    expect(printed().querySelector(".barcode-content").style.transform).toContain("rotate(180deg)");

    await again.user.click(within(design()).getByRole("button", { name: "Reset design" }));
    expect(printedLine("price").style.fontStyle).toBe("normal");
    expect(printed().querySelector(".barcode-content").style.transform).toContain("rotate(0deg)");
    expect(within(design()).getByRole("button", { name: "Reset design" })).toBeDisabled();
  });

  it("warns when a line is cut short sideways, such as an IMEI on a turned label", async () => {
    // jsdom has no layout: say the preview's IMEI line is wider than its box.
    const isIdentifier = (el) => el.classList?.contains("barcode-identifier") && el.closest("[data-entry-key]");
    const wide = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function () {
      return isIdentifier(this) ? 200 : 0;
    });
    const box = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function () {
      return isIdentifier(this) ? 80 : 0;
    });
    const { user } = await previewPhone();
    await user.click(within(design()).getByRole("button", { name: "90°" }));

    expect(screen.getByText(/1 label doesn’t fit on 50 × 25 mm: some lines would be cut off/)).toBeInTheDocument();
    expect(screen.getByText("Doesn’t fit")).toBeInTheDocument();
    wide.mockRestore();
    box.mockRestore();
  });

  it("still never prints the IMEI as the barcode, whatever the design", async () => {
    const { user } = await previewPhone();
    await user.click(within(design()).getByRole("button", { name: "270°" }));
    await user.click(within(design()).getByRole("button", { name: "Move Barcode down" }));

    const codes = [...document.querySelectorAll(".barcode-print-sheet svg")].map((svg) => svg.getAttribute("aria-label"));
    expect(codes).toEqual(["Barcode SLU00000021"]);
  });
});
