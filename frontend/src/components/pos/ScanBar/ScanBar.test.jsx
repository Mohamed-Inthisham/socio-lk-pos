import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScanBar from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import { cableProduct, draftSale, phoneProduct, saleLine } from "../../../test/posFixtures";
import * as productsService from "../../../services/productsService";
import * as salesService from "../../../services/salesService";

vi.mock("../../../services/productsService");
vi.mock("../../../services/salesService");

const chargerProduct = { ...cableProduct, id: "p-charger", name: "USB-C Charger 20W", barcode: "SLP-000005" };

const renderScanBar = () =>
  renderWithProviders(<ScanBar branchId="branch-main" />, {
    preloadedState: { posTerminal: posTerminalState() },
  });

const input = () => screen.getByRole("combobox", { name: /scan barcode or search/i });

beforeEach(() => {
  vi.resetAllMocks();
  salesService.addSaleLine.mockResolvedValue(draftSale({ lines: [saleLine()] }));
});

describe("ScanBar", () => {
  it("auto-focuses the input on mount", () => {
    renderScanBar();
    expect(input()).toHaveFocus();
  });

  it("routes a barcode-shaped value to by-barcode and adds the product", async () => {
    productsService.getProductByBarcode.mockResolvedValue(cableProduct);
    const user = userEvent.setup();
    renderScanBar();

    await user.type(input(), "4006381333931{Enter}");

    await waitFor(() =>
      expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", { product_id: cableProduct.id, quantity: 1 }),
    );
    expect(productsService.getProductByBarcode).toHaveBeenCalledWith("4006381333931");
    expect(productsService.listProducts).not.toHaveBeenCalled();
    expect(input()).toHaveValue("");
    expect(input()).toHaveFocus();
  });

  it("debounces text input into one branch-scoped search", async () => {
    productsService.listProducts.mockResolvedValue({ data: [cableProduct], meta: {} });
    const user = userEvent.setup();
    renderScanBar();

    await user.type(input(), "usb");
    expect(productsService.listProducts).not.toHaveBeenCalled();

    expect(await screen.findByRole("option", { name: /usb-c cable/i })).toBeInTheDocument();
    expect(productsService.listProducts).toHaveBeenCalledTimes(1);
    expect(productsService.listProducts).toHaveBeenCalledWith({ search: "usb", branchId: "branch-main", limit: 20 });
    expect(productsService.getProductByBarcode).not.toHaveBeenCalled();
  });

  it("navigates results with the arrow keys and adds the picked one on Enter", async () => {
    productsService.listProducts.mockResolvedValue({ data: [cableProduct, chargerProduct], meta: {} });
    const user = userEvent.setup();
    renderScanBar();

    await user.type(input(), "usb");
    const list = await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}");
    expect(within(list).getByRole("option", { name: /charger/i })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", { product_id: chargerProduct.id, quantity: 1 }),
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("asks for the IMEI before adding a serialized product", async () => {
    productsService.getProductByBarcode.mockResolvedValue(phoneProduct);
    const user = userEvent.setup();
    renderScanBar();

    await user.type(input(), "SLP-000042{Enter}");
    const dialog = await screen.findByRole("dialog", { name: /scan the imei/i });
    expect(salesService.addSaleLine).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("IMEI"), "356938035643809{Enter}");

    await waitFor(() =>
      expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", {
        product_id: phoneProduct.id,
        quantity: 1,
        imei_snapshot: "356938035643809",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the IMEI prompt open with the server error when the unit can't be sold", async () => {
    productsService.getProductByBarcode.mockResolvedValue(phoneProduct);
    salesService.addSaleLine.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        response: { status: 409, data: { message: "Unit is not IN_STOCK", existing_unit: { status: "SOLD" } } },
      }),
    );
    const user = userEvent.setup();
    renderScanBar();

    await user.type(input(), "SLP-000042{Enter}");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("IMEI"), "356938035643809{Enter}");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Unit is not IN_STOCK (unit status: SOLD)");
  });

  it("hints that a 15-digit miss is probably an IMEI", async () => {
    productsService.getProductByBarcode.mockRejectedValue(
      Object.assign(new Error("not found"), { response: { status: 404, data: {} } }),
    );
    const user = userEvent.setup();
    renderScanBar();

    await user.type(input(), "356938035643809{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(/looks like an IMEI/i);
    expect(salesService.addSaleLine).not.toHaveBeenCalled();
  });
});
