import { vi } from "vitest";
import api from "./api";
import { listProducts } from "./productsService";

vi.mock("./api", () => ({
  default: { get: vi.fn() },
}));

const page = {
  data: [{ id: "p1", name: "iPhone 15" }],
  meta: {
    total: 1,
    page: 1,
    limit: 50,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  },
};

describe("listProducts", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: page });
  });

  it("returns the paginated envelope", async () => {
    await expect(listProducts()).resolves.toEqual(page);
    expect(api.get).toHaveBeenCalledWith("/products", { params: undefined });
  });

  it("sends search and pagination params, dropping empty values", async () => {
    await listProducts({ search: "iph", brandId: "", limit: 200 });

    expect(api.get).toHaveBeenCalledWith("/products", {
      params: { search: "iph", limit: 200 },
    });
  });
});
