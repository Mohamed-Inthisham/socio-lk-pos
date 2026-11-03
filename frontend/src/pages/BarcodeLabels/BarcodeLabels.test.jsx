import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BarcodeLabels from "./index";
import * as productsService from "../../services/productsService";
import * as productUnitsService from "../../services/productUnitsService";
import * as branchesService from "../../services/branchesService";
import { authState, renderWithProviders } from "../../test/renderWithProviders";

vi.mock("../../services/productsService");
vi.mock("../../services/productUnitsService");
vi.mock("../../services/branchesService");

const branchA = { id: "branch-a", name: "Main Shop", is_active: true };
const branchB = { id: "branch-b", name: "Kandy Branch", is_active: true };
const phone = {
  id: "product-phone",
  name: "iPhone 12 Used",
  sku: "SKU-PHONE",
  barcode: "BC-PHONE",
  tracking_method: "IMEI",
  selling_price: "65000.00",
};
const unitAtA = {
  id: "unit-a",
  product_id: phone.id,
  branch_id: branchA.id,
  imei: "356938035641001",
  imei_number: "356938035641001",
  serial_number: null,
  buying_price: "50000.00",
  selling_price: "65000.00",
};

const admin = { id: "user-admin", role: "admin", branch_id: null, branch: null };
const manager = { id: "user-manager", role: "manager", branch_id: branchA.id, branch: branchA };

const renderAs = (user) =>
  renderWithProviders(<BarcodeLabels />, { preloadedState: { auth: authState(user) } });

/** Switch the code source to in-stock IMEIs, which shows the branch field. */
const chooseImeiSource = async (user) => {
  await user.selectOptions(await screen.findByLabelText("Code source"), "UNIT_IMEI");
};

/**
 * Branch handling for in-stock units (Phase 2 P2-3): an admin picks any
 * branch or all of them; a manager's units come from their own branch,
 * shown as a fixed field, with no way to ask for another.
 */
describe("BarcodeLabels: branch of the in-stock units", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    productsService.listProducts.mockResolvedValue({ data: [phone] });
    branchesService.listBranches.mockResolvedValue([branchA, branchB]);
    productUnitsService.listAllProductUnits.mockResolvedValue([unitAtA]);
  });

  it("an admin keeps the branch picker, with All branches and each branch", async () => {
    const user = userEvent.setup();
    renderAs(admin);

    await chooseImeiSource(user);

    const picker = screen.getByLabelText("Branch");
    expect(picker.tagName).toBe("SELECT");
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All branches",
      "Main Shop",
      "Kandy Branch",
    ]);
    await waitFor(() =>
      expect(productUnitsService.listAllProductUnits).toHaveBeenLastCalledWith({ status: "IN_STOCK" }),
    );

    await user.selectOptions(picker, branchB.id);

    await waitFor(() =>
      expect(productUnitsService.listAllProductUnits).toHaveBeenLastCalledWith({
        status: "IN_STOCK",
        branchId: branchB.id,
      }),
    );
  });

  it("a manager gets their own branch, fixed: no picker, no All branches, no other branch", async () => {
    const user = userEvent.setup();
    renderAs(manager);

    await chooseImeiSource(user);

    const field = screen.getByLabelText("Branch");
    expect(field.tagName).toBe("INPUT");
    expect(field).toHaveValue("Main Shop");
    expect(field).toHaveAttribute("readonly");
    expect(screen.queryByRole("option", { name: "All branches" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Kandy Branch" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(productUnitsService.listAllProductUnits).toHaveBeenCalledWith({
        status: "IN_STOCK",
        branchId: branchA.id,
      }),
    );
    for (const [filters] of productUnitsService.listAllProductUnits.mock.calls) {
      expect(filters.branchId).toBe(branchA.id);
    }
  });

  it("a manager's in-stock IMEI still becomes a label", async () => {
    const user = userEvent.setup();
    renderAs(manager);

    await user.click(await screen.findByRole("button", { name: `Add ${phone.name}` }));
    await chooseImeiSource(user);

    expect(await screen.findByRole("img", { name: `Barcode ${unitAtA.imei_number}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print Labels/ })).toBeEnabled();
  });
});
