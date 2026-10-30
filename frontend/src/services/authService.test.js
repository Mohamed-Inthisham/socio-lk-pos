import { vi } from "vitest";
import api, { withAuthLock } from "./api";
import {
  changeOwnPassword,
  getCurrentUser,
  LOGIN_RATE_LIMITED_MESSAGE,
  loginAPI,
  logoutAPI,
} from "./authService";

vi.mock("./api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  withAuthLock: vi.fn((task) => task()),
}));

describe("logoutAPI", () => {
  it("uses the browser-compatible refresh-cookie path", async () => {
    api.post.mockResolvedValueOnce({ data: { success: true } });

    await expect(logoutAPI()).resolves.toEqual({ success: true });

    expect(api.post).toHaveBeenLastCalledWith("/auth/refresh/logout");
  });

  it("sends logout under the auth lock", async () => {
    let locked = false;
    withAuthLock.mockImplementationOnce(async (task) => {
      locked = true;
      try {
        return await task();
      } finally {
        locked = false;
      }
    });
    api.post.mockImplementationOnce(async () => {
      expect(locked).toBe(true);
      return { data: { success: true } };
    });

    await logoutAPI();

    expect(withAuthLock).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenLastCalledWith("/auth/refresh/logout");
  });

  it("preserves local logout behavior when the request fails", async () => {
    api.post.mockRejectedValueOnce(new Error("Network unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(logoutAPI()).resolves.toEqual({ success: true });
    } finally {
      log.mockRestore();
    }
  });
});

describe("loginAPI errors", () => {
  const httpError = (status, data) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status, data },
    });

  it("shows a friendly message for 429, whatever the server's text", async () => {
    api.post.mockRejectedValueOnce(
      httpError(429, { statusCode: 429, message: "ThrottlerException: Too Many Requests" }),
    );

    await expect(loginAPI({ email: "x", password: "y" })).rejects.toThrow(
      LOGIN_RATE_LIMITED_MESSAGE,
    );
  });

  it("keeps the server's message for 401", async () => {
    api.post.mockRejectedValueOnce(
      httpError(401, { statusCode: 401, message: "Invalid email or password" }),
    );

    await expect(loginAPI({ email: "x", password: "y" })).rejects.toThrow(
      "Invalid email or password",
    );
  });

  it("keeps the first validation message for 400", async () => {
    api.post.mockRejectedValueOnce(
      httpError(400, { message: ["Email must be a valid email address"] }),
    );

    await expect(loginAPI({ email: "x", password: "y" })).rejects.toThrow(
      "Email must be a valid email address",
    );
  });

  it("keeps the existing fallback when there is no response", async () => {
    api.post.mockRejectedValueOnce(new Error("Network Error"));

    await expect(loginAPI({ email: "x", password: "y" })).rejects.toThrow(
      "Invalid email or password",
    );
  });
});

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
      has_approval_pin: false,
      approval_pin_set_at: null,
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

  it("keeps the approval PIN state on /auth/me (P6-18)", async () => {
    const manager = {
      ...cashier,
      role: "manager",
      has_approval_pin: true,
      approval_pin_set_at: "2026-10-22T06:00:00.000Z",
    };
    api.get.mockResolvedValueOnce({ data: { user: manager } });

    const { user } = await getCurrentUser();

    expect(user.has_approval_pin).toBe(true);
    expect(user.approval_pin_set_at).toBe("2026-10-22T06:00:00.000Z");
  });

  it("keeps the approval PIN state on login", async () => {
    api.post.mockResolvedValueOnce({
      data: { user: { ...admin, has_approval_pin: false, approval_pin_set_at: null } },
    });

    const { user } = await loginAPI({ email: "x", password: "y" });

    expect(user.has_approval_pin).toBe(false);
    expect(user.approval_pin_set_at).toBeNull();
  });

  it("defaults missing approval PIN fields to false / null", async () => {
    api.get.mockResolvedValueOnce({ data: { user: cashier } });

    const { user } = await getCurrentUser();

    expect(user.has_approval_pin).toBe(false);
    expect(user.approval_pin_set_at).toBeNull();
  });
});

describe("changeOwnPassword", () => {
  it("puts only the current and new password, resolving to nothing on 204", async () => {
    api.put.mockResolvedValueOnce({ status: 204, data: "" });

    await expect(
      changeOwnPassword({ current_password: "old-pass-1", new_password: "new-pass-1", confirm_password: "new-pass-1" }),
    ).resolves.toBeUndefined();

    expect(api.put).toHaveBeenCalledWith("/auth/me/password", {
      current_password: "old-pass-1",
      new_password: "new-pass-1",
    });
  });

  it("propagates the 503 PASSWORD_CHANGED_SIGN_IN_AGAIN error without retrying", async () => {
    const error = Object.assign(new Error("Request failed"), {
      response: { status: 503, data: { code: "PASSWORD_CHANGED_SIGN_IN_AGAIN" } },
    });
    api.put.mockRejectedValueOnce(error);

    await expect(
      changeOwnPassword({ current_password: "old-pass-1", new_password: "new-pass-1" }),
    ).rejects.toBe(error);
    expect(api.put).toHaveBeenCalledTimes(1);
  });
});
