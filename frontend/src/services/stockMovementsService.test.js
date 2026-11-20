import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "./api";
import { getStockMovements } from "./stockService";

vi.mock("./api", () => ({ default: { get: vi.fn() } }));

describe("getStockMovements", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests the read-only movement endpoint and omits empty filters", async () => {
    const response = { data: { data: [], meta: { total: 0 } } };
    api.get.mockResolvedValue(response);
    await expect(
      getStockMovements({
        page: 2,
        limit: 25,
        productId: "product-1",
        branchId: "",
        startDate: undefined,
        movementType: "SALE",
      }),
    ).resolves.toBe(response.data);
    expect(api.get).toHaveBeenCalledWith("/stock/movements", {
      params: {
        page: 2,
        limit: 25,
        productId: "product-1",
        movementType: "SALE",
      },
    });
  });
});
