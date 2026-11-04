import { vi } from "vitest";
import api from "./api";
import { getProductUnitDetails, listProductUnits, passInspection } from "./productUnitsService";
import { notInInspectionError, productUnitEntity } from "../test/returnEntities";

vi.mock("./api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

describe("productUnitsService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("lists units with the filters as query parameters", async () => {
    const page = { data: [productUnitEntity()], meta: { total: 1, totalPages: 1 } };
    api.get.mockResolvedValue({ status: 200, data: page });
    const params = {
      page: 2,
      limit: 25,
      imei: "356789012345671",
      status: "IN_STOCK",
      branchId: "branch-main",
    };

    await expect(listProductUnits(params)).resolves.toEqual(page);
    expect(api.get).toHaveBeenCalledWith("/product-units", { params });
  });

  it("reads one unit's details", async () => {
    const details = { unit: { id: "unit-a15" }, sales: [], returns: [] };
    api.get.mockResolvedValue({ status: 200, data: details });

    await expect(getProductUnitDetails("unit-a15")).resolves.toEqual(details);
    expect(api.get).toHaveBeenCalledWith("/product-units/unit-a15/details");
  });

  it("passes a phone's inspection and returns the unit, now in stock", async () => {
    const unit = productUnitEntity();
    api.post.mockResolvedValue({ status: 200, data: unit });

    await expect(passInspection("unit-a15")).resolves.toEqual(unit);
    expect(api.post).toHaveBeenCalledWith("/product-units/unit-a15/inspection-pass");
  });

  it("propagates NOT_IN_INSPECTION to the caller", async () => {
    const error = notInInspectionError();
    api.post.mockRejectedValue(error);

    await expect(passInspection("unit-a15")).rejects.toBe(error);
  });
});
