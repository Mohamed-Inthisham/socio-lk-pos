import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScanBar from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import { cableProduct, draftSale, phoneProduct, saleLine } from "../../../test/posFixtures";
import * as productsService from "../../../services/productsService";
import * as salesService from "../../../services/salesService";
import * as stockService from "../../../services/stockService";

vi.mock("../../../services/productsService");
vi.mock("../../../services/salesService");
vi.mock("../../../services/stockService");

const chargerProduct = { ...cableProduct, id: "p-charger", name: "USB-C Charger 20W", barcode: "SLP-000005" };

const renderScanBar = () =>
  renderWithProviders(<ScanBar branchId="branch-main" />, {
    preloadedState: { posTerminal: posTerminalState() },
  });

const input = () => screen.getByRole("combobox", { name: /scan barcode or search/i });

beforeEach(() => {
  vi.resetAllMocks();
  stockService.listStock.mockResolvedValue([]);
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

  it("says a returned phone is waiting to be checked (INSPECTION, P7-6)", async () => {
    productsService.getProductByBarcode.mockResolvedValue(phoneProduct);
    salesService.addSaleLine.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        response: {
          status: 409,
          data: {
            message: "IMEI '356938035643809' is not available (status: INSPECTION)",
            existing_unit: { id: "unit-9", status: "INSPECTION", product_id: phoneProduct.id },
          },
        },
      }),
    );
    const user = userEvent.setup();
    renderScanBar();

    await user.type(input(), "SLP-000042{Enter}");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("IMEI"), "356938035643809{Enter}");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This phone was returned and is waiting to be checked. It can't be sold until a manager passes it.",
    );
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

  describe("unit codes", () => {
    const IMEI = "356938035643809";
    const notFound = () =>
      Object.assign(new Error("not found"), { response: { status: 404, data: {} } });

    it("adds the unit with its real identifier, not the scanned code", async () => {
      productsService.getSellableUnitByIdentifier.mockResolvedValue({
        product: phoneProduct,
        identifier: IMEI,
        identifierType: "IMEI",
        unitId: "unit-1",
      });
      const user = userEvent.setup();
      renderScanBar();

      await user.type(input(), "SLU00000123{Enter}");

      await waitFor(() =>
        expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", {
          product_id: phoneProduct.id,
          product_unit_id: "unit-1",
          quantity: 1,
          imei_snapshot: IMEI,
        }),
      );
      expect(productsService.getSellableUnitByIdentifier).toHaveBeenCalledWith("SLU00000123", "branch-main");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("sends a serial product's real serial number", async () => {
      const hub = { ...phoneProduct, id: "p-hub", tracking_method: "SERIAL_NUMBER" };
      productsService.getSellableUnitByIdentifier.mockResolvedValue({
        product: hub,
        identifier: "SN-HUB-1",
        identifierType: "SERIAL_NUMBER",
        unitId: "unit-2",
      });
      const user = userEvent.setup();
      renderScanBar();

      await user.type(input(), "SLU00000124{Enter}");

      await waitFor(() =>
        expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", {
          product_id: hub.id,
          product_unit_id: "unit-2",
          quantity: 1,
          identifier_snapshot: "SN-HUB-1",
        }),
      );
    });

    it("pins the exact unit on an IMEI scan too", async () => {
      productsService.getSellableUnitByIdentifier.mockResolvedValue({
        product: phoneProduct,
        identifier: IMEI,
        identifierType: "IMEI",
        unitId: "unit-3",
      });
      const user = userEvent.setup();
      renderScanBar();

      await user.type(input(), `${IMEI}{Enter}`);

      await waitFor(() =>
        expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", {
          product_id: phoneProduct.id,
          product_unit_id: "unit-3",
          quantity: 1,
          imei_snapshot: IMEI,
        }),
      );
    });

    it("sends no unit id from the IMEI prompt: the backend resolves what was entered", async () => {
      productsService.getSellableUnitByIdentifier.mockRejectedValue(notFound());
      productsService.getProductByBarcode.mockResolvedValue(phoneProduct);
      const user = userEvent.setup();
      renderScanBar();

      await user.type(input(), "SLP-000042{Enter}");
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("IMEI"), `${IMEI}{Enter}`);

      await waitFor(() =>
        expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", {
          product_id: phoneProduct.id,
          quantity: 1,
          imei_snapshot: IMEI,
        }),
      );
    });

    // The prompt resolves nothing: the code goes to the sale line as entered,
    // and addLine finds that exact unit and stores its real IMEI or serial.
    it.each(["SLU00000123", "slu00000123"])("passes %s from the IMEI prompt to the sale line unchanged", async (code) => {
      productsService.getSellableUnitByIdentifier.mockRejectedValue(notFound());
      productsService.getProductByBarcode.mockResolvedValue(phoneProduct);
      const user = userEvent.setup();
      renderScanBar();

      await user.type(input(), "SLP-000042{Enter}");
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("IMEI"), `${code}{Enter}`);

      await waitFor(() =>
        expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", {
          product_id: phoneProduct.id,
          quantity: 1,
          imei_snapshot: code,
        }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(productsService.getSellableUnitByIdentifier).not.toHaveBeenCalledWith(code, "branch-main");
    });

    it("passes a unit code from the serial number prompt unchanged", async () => {
      const hub = { ...phoneProduct, id: "p-hub", tracking_method: "SERIAL_NUMBER" };
      productsService.getSellableUnitByIdentifier.mockRejectedValue(notFound());
      productsService.getProductByBarcode.mockResolvedValue(hub);
      const user = userEvent.setup();
      renderScanBar();

      await user.type(input(), "SLP-000042{Enter}");
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Serial number"), "SLU00000124{Enter}");

      await waitFor(() =>
        expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", {
          product_id: hub.id,
          quantity: 1,
          identifier_snapshot: "SLU00000124",
        }),
      );
    });

    it("still refuses a malformed IMEI in the prompt, then takes a valid one", async () => {
      productsService.getSellableUnitByIdentifier.mockRejectedValue(notFound());
      productsService.getProductByBarcode.mockResolvedValue(phoneProduct);
      const user = userEvent.setup();
      renderScanBar();

      await user.type(input(), "SLP-000042{Enter}");
      const dialog = await screen.findByRole("dialog");
      const field = within(dialog).getByLabelText("IMEI");
      await user.type(field, "SLU-1{Enter}");

      expect(await within(dialog).findByRole("alert")).toHaveTextContent("Enter the IMEI: 8–50 letters or digits.");
      expect(salesService.addSaleLine).not.toHaveBeenCalled();

      await user.clear(field);
      await user.type(field, `${IMEI}{Enter}`);

      await waitFor(() =>
        expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", {
          product_id: phoneProduct.id,
          quantity: 1,
          imei_snapshot: IMEI,
        }),
      );
    });

    it("shows the server's message for a sold unit's code, and adds nothing", async () => {
      productsService.getSellableUnitByIdentifier.mockRejectedValue(
        Object.assign(new Error("conflict"), {
          response: { status: 409, data: { message: "This item is not available to sell (status: SOLD)." } },
        }),
      );
      const user = userEvent.setup();
      renderScanBar();

      await user.type(input(), "SLU00000123{Enter}");

      expect(await screen.findByRole("alert")).toHaveTextContent("not available to sell (status: SOLD)");
      expect(salesService.addSaleLine).not.toHaveBeenCalled();
      expect(productsService.getProductByBarcode).not.toHaveBeenCalled();
    });

    it("says no item matches an unknown code, in any case, and adds nothing", async () => {
      productsService.getSellableUnitByIdentifier.mockRejectedValue(notFound());
      const user = userEvent.setup();
      renderScanBar();

      await user.type(input(), "slu00000999{Enter}");

      expect(await screen.findByRole("alert")).toHaveTextContent("No item matches that unit code at this branch.");
      expect(salesService.addSaleLine).not.toHaveBeenCalled();
    });

    it("still falls back to the product barcode when a unit lookup misses", async () => {
      productsService.getSellableUnitByIdentifier.mockRejectedValue(notFound());
      productsService.getProductByBarcode.mockResolvedValue(chargerProduct);
      const user = userEvent.setup();
      renderScanBar();

      await user.type(input(), "SLP-000005{Enter}");

      await waitFor(() => expect(productsService.getProductByBarcode).toHaveBeenCalledWith("SLP-000005"));
      await waitFor(() =>
        expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", {
          product_id: chargerProduct.id,
          quantity: 1,
        }),
      );
    });

    it("still hints at a 15-digit miss", async () => {
      productsService.getSellableUnitByIdentifier.mockRejectedValue(notFound());
      productsService.getProductByBarcode.mockRejectedValue(notFound());
      const user = userEvent.setup();
      renderScanBar();

      await user.type(input(), `${IMEI}{Enter}`);

      expect(await screen.findByRole("alert")).toHaveTextContent(/looks like an IMEI/i);
    });

    // Typed by hand, a code sits in the bar past the 250 ms debounce before
    // Enter: the name search must not run, or it shows "No products match".
    const pastDebounce = () => new Promise((resolve) => setTimeout(resolve, 400));

    it.each(["SLU00000001", "slu00000001"])(
      "runs no name search and opens no dropdown while %s is typed, then Enter adds the unit",
      async (code) => {
        productsService.getSellableUnitByIdentifier.mockResolvedValue({
          product: phoneProduct,
          identifier: IMEI,
          identifierType: "IMEI",
          unitId: "unit-1",
        });
        const user = userEvent.setup();
        renderScanBar();

        await user.type(input(), code);
        await pastDebounce();

        expect(productsService.listProducts).not.toHaveBeenCalled();
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
        expect(screen.queryByText(/No products match/)).not.toBeInTheDocument();
        expect(input()).toHaveAttribute("aria-expanded", "false");

        await user.keyboard("{Enter}");

        await waitFor(() =>
          expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", {
            product_id: phoneProduct.id,
            product_unit_id: "unit-1",
            quantity: 1,
            imei_snapshot: IMEI,
          }),
        );
        expect(productsService.getSellableUnitByIdentifier).toHaveBeenCalledWith(code, "branch-main");
        expect(productsService.listProducts).not.toHaveBeenCalled();
      },
    );

    it("never sends a code to the name search when the unit lookup resolves nothing", async () => {
      productsService.getSellableUnitByIdentifier.mockResolvedValue(null);
      const user = userEvent.setup();
      renderScanBar();

      await user.type(input(), "SLU00000001{Enter}");
      await waitFor(() => expect(productsService.getSellableUnitByIdentifier).toHaveBeenCalledTimes(1));
      await pastDebounce();

      expect(productsService.listProducts).not.toHaveBeenCalled();
      expect(productsService.getProductByBarcode).not.toHaveBeenCalled();
      expect(salesService.addSaleLine).not.toHaveBeenCalled();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("still name-searches a value that only starts like a code", async () => {
      productsService.listProducts.mockResolvedValue({ data: [], meta: {} });
      const user = userEvent.setup();
      renderScanBar();

      await user.type(input(), "SLU1234");

      await waitFor(() =>
        expect(productsService.listProducts).toHaveBeenCalledWith({ search: "SLU1234", branchId: "branch-main", limit: 20 }),
      );
    });
  });

  // The backend refuses a second line for the same physical item (409
  // ITEM_ALREADY_IN_SALE); the till shows its message and keeps the sale.
  describe("the same item twice", () => {
    const IMEI = "356938035643809";
    const DUPLICATE = "This item is already added to the current sale.";
    const firstLine = saleLine({
      id: "line-first",
      product_id: phoneProduct.id,
      product_name_snapshot: phoneProduct.name,
      unit_price: "245000.00",
      line_total: "245000.00",
      imei_snapshot: IMEI,
      product_unit_id: "unit-1",
    });
    const duplicate = () =>
      Object.assign(new Error("conflict"), {
        response: {
          status: 409,
          data: { message: DUPLICATE, code: "ITEM_ALREADY_IN_SALE", sale_line_id: "line-first" },
        },
      });
    const renderWithFirstLine = () =>
      renderWithProviders(<ScanBar branchId="branch-main" />, {
        preloadedState: { posTerminal: posTerminalState({ draftSale: draftSale({ lines: [firstLine] }) }) },
      });
    const expectSaleUnchanged = (store) => {
      const { posTerminal } = store.getState();
      expect(posTerminal.draftSale.lines).toEqual([firstLine]);
      expect(posTerminal.pendingLines).toEqual([]);
      expect(posTerminal.draftSaleId).toBe("sale-1");
    };

    it("shows the duplicate message for a second scan of the same unit, and keeps the first line", async () => {
      productsService.getSellableUnitByIdentifier.mockResolvedValue({
        product: phoneProduct,
        identifier: IMEI,
        identifierType: "IMEI",
        unitId: "unit-1",
      });
      salesService.addSaleLine.mockRejectedValue(duplicate());
      const user = userEvent.setup();
      const { store } = renderWithFirstLine();

      await user.type(input(), "SLU00000001{Enter}");

      expect(await screen.findByRole("alert")).toHaveTextContent(DUPLICATE);
      expect(salesService.addSaleLine).toHaveBeenCalledTimes(1);
      expectSaleUnchanged(store);
    });

    it("shows the duplicate message inside the IMEI prompt and keeps it open", async () => {
      productsService.getSellableUnitByIdentifier.mockRejectedValue(
        Object.assign(new Error("not found"), { response: { status: 404, data: {} } }),
      );
      productsService.getProductByBarcode.mockResolvedValue(phoneProduct);
      salesService.addSaleLine.mockRejectedValue(duplicate());
      const user = userEvent.setup();
      const { store } = renderWithFirstLine();

      await user.type(input(), "SLP-000042{Enter}");
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("IMEI"), `${IMEI}{Enter}`);

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(DUPLICATE);
      expect(within(dialog).getByRole("alert")).not.toHaveTextContent(/unit status/);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expectSaleUnchanged(store);
    });

    it("still adds a different unit of the same product", async () => {
      productsService.getSellableUnitByIdentifier.mockResolvedValue({
        product: phoneProduct,
        identifier: "490154203237518",
        identifierType: "IMEI",
        unitId: "unit-2",
      });
      const user = userEvent.setup();
      renderWithFirstLine();

      await user.type(input(), "SLU00000002{Enter}");

      await waitFor(() =>
        expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", {
          product_id: phoneProduct.id,
          product_unit_id: "unit-2",
          quantity: 1,
          imei_snapshot: "490154203237518",
        }),
      );
      expect(screen.queryByText(DUPLICATE)).not.toBeInTheDocument();
    });
  });
});
