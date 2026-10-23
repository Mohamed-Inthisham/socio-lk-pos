import { vi } from "vitest";
import api from "./api";
import { listInspection } from "./saleReturnsService";
import { inspectionRow } from "../test/returnEntities";

vi.mock("./api", () => ({
  default: { get: vi.fn() },
}));

describe("saleReturnsService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("lists a branch's phones to check", async () => {
    const rows = [inspectionRow()];
    api.get.mockResolvedValue({ data: rows });

    await expect(listInspection("branch-main")).resolves.toEqual(rows);
    expect(api.get).toHaveBeenCalledWith("/sale-returns/inspection", { params: { branchId: "branch-main" } });
  });
});
