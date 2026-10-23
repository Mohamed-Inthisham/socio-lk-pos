import { vi } from "vitest";
import api from "./api";
import { passInspection } from "./productUnitsService";
import { notInInspectionError, productUnitEntity } from "../test/returnEntities";

vi.mock("./api", () => ({
  default: { post: vi.fn() },
}));

describe("productUnitsService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
