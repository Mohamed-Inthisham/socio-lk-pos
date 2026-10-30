import { vi } from "vitest";
import api from "./api";
import {
  changeUserRole,
  createUser,
  deactivateUser,
  listUsers,
  reactivateUser,
  resetUserPassword,
  updateUser,
} from "./usersService";

vi.mock("./api", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const user = { id: "u1", full_name: "Nimal Silva", role: "cashier", branch_id: "b1" };

describe("usersService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("listUsers", () => {
    it("sends the filters, dropping empty ones", async () => {
      const page = { data: [user], meta: { total: 1, totalPages: 1 } };
      api.get.mockResolvedValue({ data: page });

      await expect(
        listUsers({ search: "nim", role: "cashier", branchId: "", isActive: true, page: 2, limit: 20, extra: null }),
      ).resolves.toEqual(page);
      expect(api.get).toHaveBeenCalledWith("/users", {
        params: { search: "nim", role: "cashier", isActive: true, page: 2, limit: 20 },
      });
    });

    it("keeps isActive=false (only inactive users)", async () => {
      api.get.mockResolvedValue({ data: { data: [], meta: {} } });
      await listUsers({ isActive: false });
      expect(api.get).toHaveBeenCalledWith("/users", { params: { isActive: false } });
    });

    it("sends no params when there are no filters", async () => {
      api.get.mockResolvedValue({ data: { data: [], meta: {} } });
      await listUsers();
      expect(api.get).toHaveBeenCalledWith("/users", { params: undefined });
    });
  });

  describe("createUser", () => {
    it("posts a staff user with its branch", async () => {
      api.post.mockResolvedValue({ data: user });
      const payload = {
        full_name: "Nimal Silva", email: "n@x.lk", password: "secret-pw", role: "cashier", branch_id: "b1",
        phone: "0778822391", nic: "199012345678", address: "12 Temple Road, Kandy",
      };

      await expect(createUser(payload)).resolves.toEqual(user);
      expect(api.post).toHaveBeenCalledWith("/users", payload);
    });

    it("never sends a branch for an admin", async () => {
      api.post.mockResolvedValue({ data: { ...user, role: "admin" } });
      await createUser({ full_name: "A", email: "a@x.lk", password: "secret-pw", role: "admin", branch_id: "b1", phone: "0771234567", nic: "901234567V", address: "Kandy" });
      expect(api.post).toHaveBeenCalledWith("/users", {
        full_name: "A", email: "a@x.lk", password: "secret-pw", role: "admin", phone: "0771234567", nic: "901234567V", address: "Kandy",
      });
    });

    it("never sends a confirmation field", async () => {
      api.post.mockResolvedValue({ data: user });
      await createUser({ full_name: "N", email: "n@x.lk", password: "secret-pw", confirm_password: "secret-pw", role: "cashier", branch_id: "b1" });
      expect(api.post.mock.calls[0][1]).not.toHaveProperty("confirm_password");
    });
  });

  describe("updateUser", () => {
    it("patches only name and email", async () => {
      api.patch.mockResolvedValue({ data: user });
      await expect(
        updateUser("u1", { full_name: "Nimal S", email: "n@x.lk", role: "admin", branch_id: "b2", is_active: false }),
      ).resolves.toEqual(user);
      expect(api.patch).toHaveBeenCalledWith("/users/u1", { full_name: "Nimal S", email: "n@x.lk" });
    });

    it("patches contact details", async () => {
      api.patch.mockResolvedValue({ data: user });
      await updateUser("u1", { phone: "0778822391", nic: "901234567V", address: "4 Lake Road" });
      expect(api.patch).toHaveBeenCalledWith("/users/u1", { phone: "0778822391", nic: "901234567V", address: "4 Lake Road" });
    });

    it("never sends a null branch_id or other nulls", async () => {
      api.patch.mockResolvedValue({ data: user });
      await updateUser("u1", { full_name: "Nimal S", email: null, branch_id: null, phone: null, nic: undefined });
      expect(api.patch).toHaveBeenCalledWith("/users/u1", { full_name: "Nimal S" });
    });
  });

  describe("changeUserRole", () => {
    it("sends role and branch together for staff", async () => {
      api.patch.mockResolvedValue({ data: user });
      await expect(changeUserRole("u1", { role: "manager", branch_id: "b2" })).resolves.toEqual(user);
      expect(api.patch).toHaveBeenCalledWith("/users/u1/role", { role: "manager", branch_id: "b2" });
    });

    it("sends no branch for an admin", async () => {
      api.patch.mockResolvedValue({ data: user });
      await changeUserRole("u1", { role: "admin", branch_id: "b2" });
      expect(api.patch).toHaveBeenCalledWith("/users/u1/role", { role: "admin" });
    });
  });

  it("deactivates and reactivates through their routes", async () => {
    api.post.mockResolvedValue({ data: user });
    await expect(deactivateUser("u1")).resolves.toEqual(user);
    await expect(reactivateUser("u1")).resolves.toEqual(user);
    expect(api.post).toHaveBeenNthCalledWith(1, "/users/u1/deactivate");
    expect(api.post).toHaveBeenNthCalledWith(2, "/users/u1/reactivate");
  });

  describe("resetUserPassword", () => {
    it("posts only new_password and resolves to nothing on 204", async () => {
      api.post.mockResolvedValue({ status: 204, data: "" });
      await expect(
        resetUserPassword("u1", { new_password: "fresh-pass", confirm_password: "fresh-pass" }),
      ).resolves.toBeUndefined();
      expect(api.post).toHaveBeenCalledWith("/users/u1/password", { new_password: "fresh-pass" });
    });
  });

  it("propagates API errors unchanged", async () => {
    const error = Object.assign(new Error("Request failed"), {
      response: { status: 400, data: { code: "LAST_ACTIVE_ADMIN" } },
    });
    api.patch.mockRejectedValue(error);
    await expect(changeUserRole("u1", { role: "cashier", branch_id: "b1" })).rejects.toBe(error);
    api.post.mockRejectedValue(error);
    await expect(deactivateUser("u1")).rejects.toBe(error);
  });
});
