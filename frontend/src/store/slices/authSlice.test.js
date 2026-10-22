import authReducer, { approvalPinSet } from "./authSlice";
import { authState } from "../../test/renderWithProviders";
import { managerSessionUser } from "../../test/authEntities";

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
