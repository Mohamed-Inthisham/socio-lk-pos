import { vi } from "vitest";
import authReducer, { approvalPinSet, logoutUser } from "./authSlice";
import { authState, cashDayState, createTestStore } from "../../test/renderWithProviders";
import { managerSessionUser } from "../../test/authEntities";
import { openCashDayEntity } from "../../test/cashDayEntities";
import * as authService from "../../services/authService";

vi.mock("../../services/authService");

describe("authSlice logoutUser", () => {
  it("clears the cash day, so the next user on the till starts from a fresh read (P9)", async () => {
    authService.logoutAPI.mockResolvedValue(undefined);
    const store = createTestStore({
      auth: authState(managerSessionUser()),
      cashDay: cashDayState({
        branchId: "branch-main",
        current: { status: "open", today: openCashDayEntity() },
        open: { clientRequestId: "3f6a1c2e-8b4d-4e1a-9f0c-5d7b2a9e6c41" },
      }),
    });

    await store.dispatch(logoutUser());

    expect(store.getState().cashDay).toEqual(cashDayState());
  });
});

describe("authSlice approvalPinSet (P6-18)", () => {
  it("records the PIN as set, with its time, and nothing else", () => {
    const user = managerSessionUser({ has_approval_pin: false, approval_pin_set_at: null });
    const state = authReducer(
      authState(user),
      approvalPinSet({ has_approval_pin: true, approval_pin_set_at: "2026-10-22T09:05:00.000Z" }),
    );

    expect(state.user).toEqual({
      ...user,
      has_approval_pin: true,
      approval_pin_set_at: "2026-10-22T09:05:00.000Z",
    });
    expect(state.isAuthenticated).toBe(true);
  });

  it("does nothing without a signed-in user", () => {
    const state = authReducer(authState(null), approvalPinSet({ has_approval_pin: true, approval_pin_set_at: "x" }));
    expect(state.user).toBeNull();
  });
});
