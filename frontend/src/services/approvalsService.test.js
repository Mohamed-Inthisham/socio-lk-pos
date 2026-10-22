import { vi } from "vitest";
import api from "./api";
import { listApprovers, setApprovalPin } from "./approvalsService";

vi.mock("./api", () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));

describe("approvalsService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("lists a branch's approvers", async () => {
    const approvers = [{ id: "user-9", full_name: "Asha Perera" }];
    api.get.mockResolvedValue({ data: approvers });

    await expect(listApprovers("branch-1")).resolves.toEqual(approvers);
    expect(api.get).toHaveBeenCalledWith("/approvers", { params: { branchId: "branch-1" } });
  });

  it("sets the session user's own PIN", async () => {
    const result = { has_approval_pin: true, approval_pin_set_at: "2026-10-22T06:00:00.000Z" };
    api.put.mockResolvedValue({ data: result });
    const payload = { current_password: "secret", pin: "482915" };

    await expect(setApprovalPin(payload)).resolves.toEqual(result);
    expect(api.put).toHaveBeenCalledWith("/auth/me/approval-pin", payload);
  });

  it("propagates a WRONG_PASSWORD 403 to the caller", async () => {
    const error = Object.assign(new Error("Request failed with status code 403"), {
      response: { status: 403, data: { code: "WRONG_PASSWORD" } },
    });
    api.put.mockRejectedValue(error);

    await expect(setApprovalPin({ current_password: "x", pin: "482915" })).rejects.toBe(error);
  });

  it("propagates a 403 on another branch's approver list", async () => {
    const error = Object.assign(new Error("Request failed with status code 403"), {
      response: { status: 403, data: { message: "Forbidden" } },
    });
    api.get.mockRejectedValue(error);

    await expect(listApprovers("branch-2")).rejects.toBe(error);
  });
});
