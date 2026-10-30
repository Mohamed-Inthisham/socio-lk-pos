import { vi } from "vitest";
import authReducer, { approvalPinSet, clearSignInNotice, logoutUser, setSignInNotice } from "./authSlice";
import { authState, cashDayState, createTestStore } from "../../test/renderWithProviders";
import { managerSessionUser } from "../../test/authEntities";
import { openCashDayEntity } from "../../test/cashDayEntities";
import * as authService from "../../services/authService";
import useActiveBranchStore from "../zustand/activeBranchStore";
import useTerminalSessionStore from "../zustand/terminalSessionStore";

vi.mock("../../services/authService");

describe("authSlice logoutUser", () => {
  it.each([false, true])("clears the session, cash day and persisted till pointers (API failure=%s)", async (fails) => {
    if (fails) authService.logoutAPI.mockRejectedValueOnce(new Error("Network unavailable"));
    else authService.logoutAPI.mockResolvedValueOnce({ success: true });
    useActiveBranchStore.getState().setActiveBranch("branch-main");
    useTerminalSessionStore.getState().setDraftSaleId("sale-private");
    useTerminalSessionStore.getState().setLastCompletedSaleId("sale-completed");
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
    expect(store.getState().auth).toMatchObject({ user: null, isAuthenticated: false });
    expect(useActiveBranchStore.getState().activeBranchId).toBeNull();
    expect(useTerminalSessionStore.getState()).toMatchObject({ draftSaleId: null, lastCompletedSaleId: null });
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

describe("authSlice sign-in notice (Task 2.4)", () => {
  const NOTICE = "Your password was changed successfully. Please sign in again with your new password.";

  it("survives the logout it comes with, then clears", async () => {
    authService.logoutAPI.mockResolvedValueOnce({ success: true });
    const store = createTestStore({ auth: authState(managerSessionUser()) });

    store.dispatch(setSignInNotice(NOTICE));
    await store.dispatch(logoutUser());

    expect(store.getState().auth).toMatchObject({ user: null, isAuthenticated: false, signInNotice: NOTICE });
    store.dispatch(clearSignInNotice());
    expect(store.getState().auth.signInNotice).toBeNull();
  });

  it("starts empty", () => {
    expect(authReducer(undefined, { type: "@@INIT" }).signInNotice).toBeNull();
  });
});
