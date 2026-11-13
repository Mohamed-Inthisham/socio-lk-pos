import { vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BarcodeLabels from "./index";
import api from "../../services/api";
import { authState, renderWithProviders } from "../../test/renderWithProviders";

// The real barcodeLabelsService and branchesService, with only the HTTP
// client mocked: checks the exact requests that leave the browser, not just
// what the page passes to the service.
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const branchA = { id: "branch-a", name: "Main Shop", is_active: true };
const meta = { total: 1, page: 1, limit: 20, totalPages: 1, hasNext: false, hasPrev: false };
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
  branch: branchA,
};

const routeGet = (url) => {
  if (url === "/branches") return Promise.resolve({ data: [branchA] });
  if (url === "/barcode-labels/products") return Promise.resolve({ data: { data: [charger], meta } });
  if (url === "/barcode-labels/units") return Promise.resolve({ data: { data: [phone], meta } });
  return Promise.reject(new Error(`unexpected GET ${url}`));
};

describe("BarcodeLabels: the requests sent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.get.mockImplementation(routeGet);
    api.post.mockResolvedValue({
      data: { data: [{ ...phone }, { ...charger, quantity: 3 }], total_labels: 4 },
    });
  });

  it("searches the label endpoints, never /products or /product-units", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BarcodeLabels />, {
      preloadedState: { auth: authState({ id: "m", role: "manager", branch_id: branchA.id, branch: branchA }) },
    });

    await screen.findByText("USB-C Charger");
    await user.type(screen.getByLabelText("Search products"), "  chg  ");
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/barcode-labels/products", {
        params: { search: "chg", page: 1, limit: 10 },
      }),
    );
    await user.click(screen.getByRole("tab", { name: "Individual items" }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/barcode-labels/units", {
        params: { branchId: branchA.id, page: 1, limit: 10 },
      }),
    );

    const urls = api.get.mock.calls.map(([url]) => url);
    expect(urls.every((url) => ["/branches", "/barcode-labels/products", "/barcode-labels/units"].includes(url))).toBe(true);
  });

  it("POSTs the queue to /barcode-labels/resolve with exactly the approved fields, in order", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BarcodeLabels />, {
      preloadedState: { auth: authState({ id: "a", role: "admin", branch_id: null, branch: null }) },
    });

    await user.click(screen.getByRole("tab", { name: "Individual items" }));
    await user.click(await screen.findByRole("button", { name: "Add iPhone 13 SLU00000021" }));
    await user.click(screen.getByRole("tab", { name: "Products" }));
    await user.click(await screen.findByRole("button", { name: "Add USB-C Charger" }));
    const copies = screen.getByLabelText("Copies of USB-C Charger");
    await user.clear(copies);
    await user.type(copies, "3");
    await user.click(screen.getByRole("button", { name: /Preview labels/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith("/barcode-labels/resolve", {
      items: [
        { type: "UNIT", unitId: "u-phone" },
        { type: "PRODUCT", productId: "p-charger", quantity: 3 },
      ],
    });
    expect(await screen.findByRole("img", { name: "Barcode SLU00000021" })).toBeInTheDocument();
  });
});
