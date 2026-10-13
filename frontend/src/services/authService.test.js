import { vi } from "vitest";
import api from "./api";
import { getCurrentUser, loginAPI } from "./authService";

vi.mock("./api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const branch = { id: "branch-1", name: "Main Shop" };

const cashier = {
  id: "user-1",
  email: "cashier@socio.lk",
  full_name: "Test Cashier",
  role: "cashier",
  branch_id: "branch-1",
  branch,
};

const admin = {
  id: "user-2",
  email: "admin@socio.lk",
  full_name: "Test Admin",
  role: "admin",
  branch_id: null,
  branch: null,
};

describe("authService user mapping", () => {
  it("keeps branch_id and branch for staff on /auth/me", async () => {
    api.get.mockResolvedValueOnce({ data: { user: cashier } });

    const { user } = await getCurrentUser();

    expect(user).toEqual({
      id: "user-1",
      email: "cashier@socio.lk",
      name: "Test Cashier",
      role: "cashier",
      branch_id: "branch-1",
      branch,
      avatar: null,
    });
  });

  it("keeps branch_id and branch on login", async () => {
    api.post.mockResolvedValueOnce({ data: { user: cashier } });

    const { user } = await loginAPI({ email: "x", password: "y" });

    expect(user.branch_id).toBe("branch-1");
    expect(user.branch).toEqual(branch);
  });

  it("returns null branch fields for admins", async () => {
    api.get.mockResolvedValueOnce({ data: { user: admin } });

    const { user } = await getCurrentUser();

    expect(user.branch_id).toBeNull();
    expect(user.branch).toBeNull();
  });

  it("normalises missing branch fields to null", async () => {
    const legacy = { ...cashier };
    delete legacy.branch_id;
    delete legacy.branch;
    api.get.mockResolvedValueOnce({ data: { user: legacy } });

    const { user } = await getCurrentUser();

    expect(user.branch_id).toBeNull();
    expect(user.branch).toBeNull();
  });
});
