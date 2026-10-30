import { useState } from "react";
import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UserFormDialog from "./UserFormDialog";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { apiError, kandyBranch, mainBranch, userRow } from "../../test/userEntities";
import * as usersService from "../../services/usersService";

vi.mock("../../services/usersService");

const onSaved = vi.fn();

/** Opens the dialog for `user` (null to create), like the Users page. */
const Host = ({ user }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open form</button>
      <UserFormDialog open={open} user={user} onClose={() => setOpen(false)} onSaved={onSaved} />
    </>
  );
};

const renderHost = (user = null) =>
  renderWithProviders(<Host user={user} />, {
    preloadedState: { auth: authState({ id: "user-admin", role: "admin" }), branches: branchesState([mainBranch, kandyBranch]) },
  });

const openForm = async (user) => {
  await user.click(screen.getByRole("button", { name: "Open form" }));
  return screen.findByRole("dialog");
};

const field = (dialog, label) => within(dialog).getByLabelText(label);

const fillCreate = async (user, dialog, { name = "Kamal Perera", email = "kamal@socio.lk", pw = "fresh-pass-1", confirm = pw } = {}) => {
  if (name) await user.type(field(dialog, /Full name/), name);
  if (email) await user.type(field(dialog, /^Email/), email);
  if (pw) await user.type(field(dialog, /^Password/), pw);
  if (confirm) await user.type(field(dialog, /Confirm password/), confirm);
};

describe("UserFormDialog: create", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("checks every required field before sending anything", async () => {
    const user = userEvent.setup();
    renderHost();
    const dialog = await openForm(user);

    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    expect(await within(dialog).findByText("Enter the full name (at least 2 characters)")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter an email address")).toBeInTheDocument();
    expect(within(dialog).getByText("Use at least 8 characters")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter the password again")).toBeInTheDocument();
    expect(within(dialog).getByText("Managers and cashiers need a branch")).toBeInTheDocument();
    expect(usersService.createUser).not.toHaveBeenCalled();
  });

  it("defaults to a cashier, and sends the staff user with its branch, never the confirmation", async () => {
    const user = userEvent.setup();
    usersService.createUser.mockResolvedValue(userRow());
    renderHost();
    const dialog = await openForm(user);
    expect(field(dialog, /^Role/)).toHaveValue("cashier");

    await fillCreate(user, dialog);
    await user.selectOptions(field(dialog, /Branch/), "branch-kandy");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    await waitFor(() => expect(usersService.createUser).toHaveBeenCalledWith({
      full_name: "Kamal Perera", email: "kamal@socio.lk", password: "fresh-pass-1", role: "cashier", branch_id: "branch-kandy",
    }));
    expect(onSaved).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("hides the branch for an admin and sends none", async () => {
    const user = userEvent.setup();
    usersService.createUser.mockResolvedValue(userRow({ role: "admin" }));
    renderHost();
    const dialog = await openForm(user);
    await user.selectOptions(field(dialog, /Branch/), "branch-main");

    await user.selectOptions(field(dialog, /^Role/), "admin");

    expect(within(dialog).queryByLabelText(/Branch/)).not.toBeInTheDocument();
    expect(within(dialog).getByText("Admins work across all branches.")).toBeInTheDocument();
    await fillCreate(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));
    await waitFor(() => expect(usersService.createUser).toHaveBeenCalled());
    expect(usersService.createUser.mock.calls[0][0]).toEqual({
      full_name: "Kamal Perera", email: "kamal@socio.lk", password: "fresh-pass-1", role: "admin",
    });
  });

  it("shows the branch again for a manager", async () => {
    const user = userEvent.setup();
    renderHost();
    const dialog = await openForm(user);
    await user.selectOptions(field(dialog, /^Role/), "admin");
    await user.selectOptions(field(dialog, /^Role/), "manager");
    expect(field(dialog, /Branch/)).toBeInTheDocument();
  });

  it("counts the password in UTF-8 bytes: 25 Sinhala letters are too long", async () => {
    const user = userEvent.setup();
    renderHost();
    const dialog = await openForm(user);
    const sinhala = "ශ".repeat(25);
    await fillCreate(user, dialog, { pw: sinhala });
    await user.selectOptions(field(dialog, /Branch/), "branch-main");

    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    expect(await within(dialog).findByText(/That password is too long/)).toBeInTheDocument();
    expect(usersService.createUser).not.toHaveBeenCalled();
  });

  it("refuses a mismatched confirmation", async () => {
    const user = userEvent.setup();
    renderHost();
    const dialog = await openForm(user);
    await fillCreate(user, dialog, { confirm: "fresh-pass-2" });
    await user.selectOptions(field(dialog, /Branch/), "branch-main");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));
    expect(await within(dialog).findByText("The passwords don't match")).toBeInTheDocument();
  });

  it("shows a taken email (409) under Email, keeping the dialog open", async () => {
    const user = userEvent.setup();
    usersService.createUser.mockRejectedValue(apiError(409, { statusCode: 409, message: "Email is already registered", error: "Conflict" }));
    renderHost();
    const dialog = await openForm(user);
    await fillCreate(user, dialog);
    await user.selectOptions(field(dialog, /Branch/), "branch-main");

    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    expect(await within(dialog).findByText("That email is already registered to another user.")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("clears the passwords when closed", async () => {
    const user = userEvent.setup();
    renderHost();
    let dialog = await openForm(user);
    await fillCreate(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    dialog = await openForm(user);
    expect(field(dialog, /^Password/)).toHaveValue("");
    expect(field(dialog, /Confirm password/)).toHaveValue("");
    expect(field(dialog, /Full name/)).toHaveValue("");
  });
});

describe("UserFormDialog: edit", () => {
  const nimal = userRow();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("offers only name and email, filled in", async () => {
    const user = userEvent.setup();
    renderHost(nimal);
    const dialog = await openForm(user);

    expect(field(dialog, /Full name/)).toHaveValue("Nimal Silva");
    expect(field(dialog, /^Email/)).toHaveValue("nimal@socio.lk");
    expect(within(dialog).queryByLabelText(/Role/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Branch/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Password/)).not.toBeInTheDocument();
  });

  it("sends only what changed: never a role, branch or null", async () => {
    const user = userEvent.setup();
    usersService.updateUser.mockResolvedValue(userRow({ full_name: "Nimal S. Silva" }));
    renderHost(nimal);
    const dialog = await openForm(user);
    await user.clear(field(dialog, /Full name/));
    await user.type(field(dialog, /Full name/), "Nimal S. Silva");

    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(usersService.updateUser).toHaveBeenCalledWith("user-cashier", { full_name: "Nimal S. Silva" }));
    expect(onSaved).toHaveBeenCalled();
  });

  it("closes without a request when nothing changed", async () => {
    const user = userEvent.setup();
    renderHost(nimal);
    const dialog = await openForm(user);
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(usersService.updateUser).not.toHaveBeenCalled();
  });

  it("shows a taken email under Email", async () => {
    const user = userEvent.setup();
    usersService.updateUser.mockRejectedValue(apiError(409, { message: "Email is already registered" }));
    renderHost(nimal);
    const dialog = await openForm(user);
    await user.clear(field(dialog, /^Email/));
    await user.type(field(dialog, /^Email/), "asha@socio.lk");

    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog).findByText("That email is already registered to another user.")).toBeInTheDocument();
  });

  it("shows other server messages in the alert", async () => {
    const user = userEvent.setup();
    usersService.updateUser.mockRejectedValue(apiError(500, { message: "Internal server error" }));
    renderHost(nimal);
    const dialog = await openForm(user);
    await user.type(field(dialog, /Full name/), "x");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Couldn't save the changes. Try again.");
  });
});
