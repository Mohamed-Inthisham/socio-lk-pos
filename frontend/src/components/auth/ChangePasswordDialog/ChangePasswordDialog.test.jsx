import { useState } from "react";
import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import ChangePasswordDialog from ".";
import ProtectedRoute from "../ProtectedRoute";
import LoginForm from "../LoginForm";
import { authState, renderWithProviders } from "../../../test/renderWithProviders";
import { apiError, codedError } from "../../../test/userEntities";
import { cashierSessionUser } from "../../../test/authEntities";
import { SIGN_IN_AGAIN_MESSAGE } from "../../../utils/userErrors";
import * as authService from "../../../services/authService";

vi.mock("../../../services/authService");

const CURRENT = "old-pass-1";
const NEW = "new-pass-12";

const Host = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p>Till page</p>
      <button type="button" onClick={() => setOpen(true)}>Open password</button>
      <ChangePasswordDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
};

/** The dialog on a signed-in page, with the real login page behind it. */
const renderFlow = () =>
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginForm />} />
      <Route path="/pos" element={<ProtectedRoute><Host /></ProtectedRoute>} />
    </Routes>,
    { route: "/pos", preloadedState: { auth: authState(cashierSessionUser()) } },
  );

const openDialog = async (user) => {
  await user.click(screen.getByRole("button", { name: "Open password" }));
  return screen.findByRole("dialog", { name: "Change password" });
};

const fill = async (user, dialog, { current = CURRENT, next = NEW, confirm = next } = {}) => {
  if (current) await user.type(within(dialog).getByLabelText("Current password"), current);
  if (next) await user.type(within(dialog).getByLabelText(/^New password/), next);
  if (confirm) await user.type(within(dialog).getByLabelText("Confirm new password"), confirm);
};
const submit = (user, dialog) => user.click(within(dialog).getByRole("button", { name: "Change password" }));

describe("ChangePasswordDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authService.logoutAPI.mockResolvedValue({ success: true });
  });

  it("changes the password, keeps the user signed in, and shows a success view", async () => {
    authService.changeOwnPassword.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { store } = renderFlow();
    const dialog = await openDialog(user);
    await fill(user, dialog);

    await submit(user, dialog);

    await waitFor(() => expect(authService.changeOwnPassword).toHaveBeenCalledWith({ current_password: CURRENT, new_password: NEW }));
    const done = await screen.findByRole("dialog", { name: "Password changed" });
    expect(within(done).getByRole("status")).toHaveTextContent("You're still signed in here");
    expect(done.querySelectorAll("input")).toHaveLength(0);
    expect(store.getState().auth.isAuthenticated).toBe(true);
    expect(authService.logoutAPI).not.toHaveBeenCalled();
    expect(JSON.stringify(store.getState())).not.toContain(NEW);
  });

  it("shows a wrong current password under the field, clears it, and lets the user retry", async () => {
    authService.changeOwnPassword
      .mockRejectedValueOnce(codedError(403, "WRONG_PASSWORD", "Current password is incorrect."))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderFlow();
    const dialog = await openDialog(user);
    await fill(user, dialog);

    await submit(user, dialog);

    expect(await within(dialog).findByText("Your current password is incorrect.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Current password")).toHaveValue("");
    expect(within(dialog).getByLabelText("Current password")).toHaveFocus();
    expect(within(dialog).getByLabelText(/^New password/)).toHaveValue(NEW);

    await user.type(within(dialog).getByLabelText("Current password"), "right-pass-1");
    await submit(user, dialog);
    expect(await screen.findByRole("dialog", { name: "Password changed" })).toBeInTheDocument();
    expect(authService.changeOwnPassword).toHaveBeenCalledTimes(2);
  });

  it("shows SAME_PASSWORD under New password", async () => {
    authService.changeOwnPassword.mockRejectedValue(codedError(400, "SAME_PASSWORD"));
    const user = userEvent.setup();
    renderFlow();
    const dialog = await openDialog(user);
    await fill(user, dialog);
    await submit(user, dialog);
    expect(await within(dialog).findByText("Choose a password different from your current one.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Change password" })).toBeInTheDocument();
  });

  it("checks the confirmation and the rules before sending", async () => {
    const user = userEvent.setup();
    renderFlow();
    const dialog = await openDialog(user);
    await fill(user, dialog, { confirm: "new-pass-13" });
    await submit(user, dialog);
    expect(await within(dialog).findByText("The passwords don't match")).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText(/^New password/));
    await user.clear(within(dialog).getByLabelText("Confirm new password"));
    await fill(user, dialog, { current: "", next: "ශ".repeat(25) });
    await submit(user, dialog);
    expect(await within(dialog).findByText(/That password is too long/)).toBeInTheDocument();
    expect(authService.changeOwnPassword).not.toHaveBeenCalled();
  });

  it("shows other failures in the alert", async () => {
    authService.changeOwnPassword.mockRejectedValue(apiError(500, { message: "Internal server error" }));
    const user = userEvent.setup();
    renderFlow();
    const dialog = await openDialog(user);
    await fill(user, dialog);
    await submit(user, dialog);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Couldn't change your password. Try again.");
  });

  it("clears every field when closed", async () => {
    const user = userEvent.setup();
    renderFlow();
    let dialog = await openDialog(user);
    await fill(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    dialog = await openDialog(user);
    for (const label of ["Current password", /^New password/, "Confirm new password"]) {
      expect(within(dialog).getByLabelText(label)).toHaveValue("");
    }
  });

  describe("503 PASSWORD_CHANGED_SIGN_IN_AGAIN", () => {
    const signInAgain = () => codedError(503, "PASSWORD_CHANGED_SIGN_IN_AGAIN", "Your password was changed. Please sign in again.");

    it("says the password was changed, offers only Sign in, and never retries", async () => {
      authService.changeOwnPassword.mockRejectedValue(signInAgain());
      const user = userEvent.setup();
      const { store } = renderFlow();
      const dialog = await openDialog(user);
      await fill(user, dialog);

      await submit(user, dialog);

      const result = await screen.findByRole("dialog", { name: "Password changed" });
      expect(within(result).getByRole("alert")).toHaveTextContent(SIGN_IN_AGAIN_MESSAGE);
      expect(result).not.toHaveTextContent(/Couldn't|failed/i);
      expect(within(result).getByRole("button", { name: "Sign in" })).toHaveFocus();
      expect(within(result).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
      expect(within(result).queryByRole("button", { name: "Close dialog" })).not.toBeInTheDocument();
      expect(result.querySelectorAll("input")).toHaveLength(0);

      // Escape doesn't dismiss it: the session can't be kept.
      await user.keyboard("{Escape}");
      expect(screen.getByRole("dialog", { name: "Password changed" })).toBeInTheDocument();
      expect(authService.changeOwnPassword).toHaveBeenCalledTimes(1);
      expect(store.getState().auth.isAuthenticated).toBe(true);
    });

    it("Sign in logs out through the usual flow and shows the notice once on the login page", async () => {
      authService.changeOwnPassword.mockRejectedValue(signInAgain());
      const user = userEvent.setup();
      const { store } = renderFlow();
      const dialog = await openDialog(user);
      await fill(user, dialog);
      await submit(user, dialog);

      await user.click(await screen.findByRole("button", { name: "Sign in" }));

      // logoutUser: the server clears the cookies, the app its state.
      await waitFor(() => expect(authService.logoutAPI).toHaveBeenCalledTimes(1));
      expect(await screen.findByRole("status")).toHaveTextContent(SIGN_IN_AGAIN_MESSAGE);
      expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
      expect(screen.queryByText("Till page")).not.toBeInTheDocument();
      expect(store.getState().auth.isAuthenticated).toBe(false);
      expect(store.getState().auth.user).toBeNull();
      // Shown once: cleared from the store as soon as it is on screen.
      expect(store.getState().auth.signInNotice).toBeNull();
      expect(authService.changeOwnPassword).toHaveBeenCalledTimes(1);
    });
  });
});
