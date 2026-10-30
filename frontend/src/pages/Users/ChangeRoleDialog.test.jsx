import { useState } from "react";
import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChangeRoleDialog from "./ChangeRoleDialog";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { adminRow, apiError, codedError, kandyBranch, mainBranch, managerRow, userRow } from "../../test/userEntities";
import * as usersService from "../../services/usersService";

vi.mock("../../services/usersService");

const onSaved = vi.fn();

const Host = ({ target }) => {
  const [user, setUser] = useState(null);
  return (
    <>
      <button type="button" onClick={() => setUser(target)}>Open role</button>
      <ChangeRoleDialog user={user} onClose={() => setUser(null)} onSaved={onSaved} />
    </>
  );
};

const openFor = async (target) => {
  const user = userEvent.setup();
  renderWithProviders(<Host target={target} />, {
    preloadedState: { auth: authState({ id: "user-admin", role: "admin" }), branches: branchesState([mainBranch, kandyBranch]) },
  });
  await user.click(screen.getByRole("button", { name: "Open role" }));
  const dialog = await screen.findByRole("dialog", { name: "Change role" });
  return { user, dialog };
};

const save = (user, dialog) => user.click(within(dialog).getByRole("button", { name: "Save role" }));

describe("ChangeRoleDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("starts from the user's role and branch, and explains the session effects", async () => {
    const { dialog } = await openFor(userRow());
    expect(within(dialog).getByLabelText(/Role/)).toHaveValue("cashier");
    expect(within(dialog).getByLabelText(/Branch/)).toHaveValue("branch-main");
    expect(dialog).toHaveTextContent("Nimal Silva · nimal@socio.lk");
    expect(dialog).toHaveTextContent("ends their saved sessions");
    expect(dialog).toHaveTextContent("up to 15 minutes");
  });

  it("sends role and branch together in one request, then reloads", async () => {
    usersService.changeUserRole.mockResolvedValue(managerRow());
    const { user, dialog } = await openFor(userRow());

    await user.selectOptions(within(dialog).getByLabelText(/Role/), "manager");
    await user.selectOptions(within(dialog).getByLabelText(/Branch/), "branch-kandy");
    await save(user, dialog);

    await waitFor(() => expect(usersService.changeUserRole).toHaveBeenCalledWith("user-cashier", { role: "manager", branch_id: "branch-kandy" }));
    expect(usersService.changeUserRole).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalled();
  });

  it("makes a user an admin with no branch", async () => {
    usersService.changeUserRole.mockResolvedValue(adminRow());
    const { user, dialog } = await openFor(managerRow());

    await user.selectOptions(within(dialog).getByLabelText(/Role/), "admin");
    expect(within(dialog).queryByLabelText(/Branch/)).not.toBeInTheDocument();
    await save(user, dialog);

    await waitFor(() => expect(usersService.changeUserRole).toHaveBeenCalledWith("user-manager", { role: "admin" }));
  });

  it.each(["manager", "cashier"])("needs a branch to make an admin a %s", async (role) => {
    const { user, dialog } = await openFor(adminRow({ id: "user-admin-2" }));

    await user.selectOptions(within(dialog).getByLabelText(/Role/), role);
    await save(user, dialog);

    expect(await within(dialog).findByText("Managers and cashiers need a branch")).toBeInTheDocument();
    expect(usersService.changeUserRole).not.toHaveBeenCalled();
  });

  it("warns that a new cashier's approval PIN is cleared", async () => {
    const { user, dialog } = await openFor(managerRow());
    await user.selectOptions(within(dialog).getByLabelText(/Role/), "cashier");
    expect(dialog).toHaveTextContent("approval PIN: theirs will be cleared");
  });

  it("sends nothing when nothing changed", async () => {
    const { user, dialog } = await openFor(userRow());
    await save(user, dialog);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(usersService.changeUserRole).not.toHaveBeenCalled();
  });

  it.each([
    ["LAST_ACTIVE_ADMIN", /last active admin/],
    ["CANNOT_CHANGE_OWN_ROLE", /can't change your own role/],
  ])("explains %s, keeping the dialog open", async (code, message) => {
    usersService.changeUserRole.mockRejectedValue(codedError(400, code));
    const { user, dialog } = await openFor(adminRow({ id: "user-admin-2" }));
    await user.selectOptions(within(dialog).getByLabelText(/Role/), "manager");
    await user.selectOptions(within(dialog).getByLabelText(/Branch/), "branch-main");

    await save(user, dialog);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows an inactive-branch refusal under Branch", async () => {
    usersService.changeUserRole.mockRejectedValue(apiError(400, { message: 'Branch "Kandy" is not active' }));
    const { user, dialog } = await openFor(userRow());
    await user.selectOptions(within(dialog).getByLabelText(/Branch/), "branch-kandy");

    await save(user, dialog);

    expect(await within(dialog).findByText('Branch "Kandy" is not active')).toBeInTheDocument();
  });

  it("still names a user's inactive branch", async () => {
    const { dialog } = await openFor(userRow({ branch_id: "branch-old", branch: { id: "branch-old", name: "Galle", is_active: false } }));
    expect(within(dialog).getByLabelText(/Branch/)).toHaveDisplayValue("Galle (inactive)");
  });
});
