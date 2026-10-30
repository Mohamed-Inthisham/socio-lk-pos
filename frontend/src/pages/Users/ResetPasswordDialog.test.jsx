import { useState } from "react";
import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResetPasswordDialog from "./ResetPasswordDialog";
import { authState, renderWithProviders } from "../../test/renderWithProviders";
import { apiError, codedError, userRow } from "../../test/userEntities";
import * as usersService from "../../services/usersService";

vi.mock("../../services/usersService");

const NEW = "fresh-pass-1";

const Host = ({ target }) => {
  const [user, setUser] = useState(null);
  return (
    <>
      <button type="button" onClick={() => setUser(target)}>Open reset</button>
      <ResetPasswordDialog user={user} onClose={() => setUser(null)} />
    </>
  );
};

const setup = async (target = userRow()) => {
  const user = userEvent.setup();
  renderWithProviders(<Host target={target} />, { preloadedState: { auth: authState({ id: "user-admin", role: "admin" }) } });
  await user.click(screen.getByRole("button", { name: "Open reset" }));
  const dialog = await screen.findByRole("dialog", { name: "Reset password" });
  return { user, dialog };
};

const fill = async (user, dialog, pw = NEW, confirm = pw) => {
  if (pw) await user.type(within(dialog).getByLabelText(/^New password/), pw);
  if (confirm) await user.type(within(dialog).getByLabelText(/Confirm new password/), confirm);
};
const submit = (user, dialog) => user.click(within(dialog).getByRole("button", { name: "Reset password" }));

describe("ResetPasswordDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("explains the effects and that the PIN stays", async () => {
    const { dialog } = await setup();
    expect(dialog).toHaveTextContent("Nimal Silva · nimal@socio.lk");
    expect(dialog).toHaveTextContent("saved sessions end");
    expect(dialog).toHaveTextContent("up to 15 minutes");
    expect(dialog).toHaveTextContent("approval PIN doesn't change");
  });

  it("sends only the new password, then shows a success view without it", async () => {
    usersService.resetUserPassword.mockResolvedValue(undefined);
    const { user, dialog } = await setup();
    await fill(user, dialog);

    await submit(user, dialog);

    await waitFor(() => expect(usersService.resetUserPassword).toHaveBeenCalledWith("user-cashier", { new_password: NEW }));
    const done = await screen.findByRole("dialog", { name: "Password reset" });
    expect(within(done).getByRole("status")).toHaveTextContent("Nimal Silva's password was reset");
    expect(done.textContent).not.toContain(NEW);
    expect(done.querySelectorAll("input")).toHaveLength(0);
    expect(within(done).getByRole("button", { name: "Done" })).toHaveFocus();
  });

  it("checks the length and the confirmation first", async () => {
    const { user, dialog } = await setup();
    await fill(user, dialog, "short7!");
    await submit(user, dialog);
    expect(await within(dialog).findByText("Use at least 8 characters")).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText(/^New password/));
    await user.clear(within(dialog).getByLabelText(/Confirm new password/));
    await fill(user, dialog, NEW, "fresh-pass-2");
    await submit(user, dialog);
    expect(await within(dialog).findByText("The passwords don't match")).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText(/^New password/));
    await user.clear(within(dialog).getByLabelText(/Confirm new password/));
    const tamil = "த".repeat(25);
    await fill(user, dialog, tamil);
    await submit(user, dialog);
    expect(await within(dialog).findByText(/That password is too long/)).toBeInTheDocument();
    expect(usersService.resetUserPassword).not.toHaveBeenCalled();
  });

  it("explains CANNOT_RESET_OWN_PASSWORD", async () => {
    usersService.resetUserPassword.mockRejectedValue(codedError(400, "CANNOT_RESET_OWN_PASSWORD"));
    const { user, dialog } = await setup();
    await fill(user, dialog);
    await submit(user, dialog);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("use Change password in your user menu");
  });

  it("shows a server password message under New password", async () => {
    usersService.resetUserPassword.mockRejectedValue(apiError(400, { message: ["Password must be at least 8 characters"] }));
    const { user, dialog } = await setup();
    await fill(user, dialog);
    await submit(user, dialog);
    expect(await within(dialog).findByText("Password must be at least 8 characters")).toBeInTheDocument();
  });

  it("clears the passwords when closed, and opens on the form again", async () => {
    usersService.resetUserPassword.mockResolvedValue(undefined);
    const { user, dialog } = await setup();
    await fill(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Open reset" }));
    let again = await screen.findByRole("dialog", { name: "Reset password" });
    expect(within(again).getByLabelText(/^New password/)).toHaveValue("");
    expect(within(again).getByLabelText(/Confirm new password/)).toHaveValue("");

    // And after a success, Done then reopening shows the form, empty.
    await fill(user, again);
    await submit(user, again);
    await user.click(await screen.findByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Open reset" }));
    again = await screen.findByRole("dialog", { name: "Reset password" });
    expect(within(again).getByLabelText(/^New password/)).toHaveValue("");
  });
});
