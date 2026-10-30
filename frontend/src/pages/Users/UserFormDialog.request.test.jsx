import { useState } from "react";
import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UserFormDialog from "./UserFormDialog";
import api from "../../services/api";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { kandyBranch, mainBranch, userRow } from "../../test/userEntities";

// The real usersService, with only the HTTP client mocked: checks the
// request body that leaves the browser, not just what the dialog passes
// to the service (the other dialog tests mock the service).
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const Host = ({ user }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open form</button>
      <UserFormDialog open={open} user={user} onClose={() => setOpen(false)} onSaved={() => {}} />
    </>
  );
};

const openForm = async (target = null) => {
  const user = userEvent.setup();
  renderWithProviders(<Host user={target} />, {
    preloadedState: { auth: authState({ id: "user-admin", role: "admin" }), branches: branchesState([mainBranch, kandyBranch]) },
  });
  await user.click(screen.getByRole("button", { name: "Open form" }));
  return { user, dialog: await screen.findByRole("dialog") };
};

describe("UserFormDialog: the request sent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("POST /users carries the contact details", async () => {
    api.post.mockResolvedValue({ data: userRow() });
    const { user, dialog } = await openForm();
    await user.type(within(dialog).getByLabelText(/Full name/), "Charaka Perera");
    await user.type(within(dialog).getByLabelText(/^Email/), "charaka@gmail.com");
    await user.type(within(dialog).getByLabelText(/Contact number/), "0778822391");
    await user.type(within(dialog).getByLabelText(/^NIC/), "901234567v");
    await user.type(within(dialog).getByLabelText(/^Address/), "4 Lake Road, Galle");
    await user.type(within(dialog).getByLabelText(/^Password/), "fresh-pass-1");
    await user.type(within(dialog).getByLabelText(/Confirm password/), "fresh-pass-1");
    await user.selectOptions(within(dialog).getByLabelText(/Branch/), "branch-main");

    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/users", {
      full_name: "Charaka Perera",
      email: "charaka@gmail.com",
      password: "fresh-pass-1",
      role: "cashier",
      branch_id: "branch-main",
      phone: "0778822391",
      nic: "901234567V",
      address: "4 Lake Road, Galle",
    }));
  });

  it("PATCH /users/:id carries a changed contact detail", async () => {
    api.patch.mockResolvedValue({ data: userRow() });
    const { user, dialog } = await openForm(userRow({ phone: null, nic: null, address: null }));
    await user.type(within(dialog).getByLabelText(/Contact number/), "+94 77 882 2391");
    await user.type(within(dialog).getByLabelText(/^Address/), "4 Lake Road, Galle");

    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/users/user-cashier", {
      phone: "0778822391",
      address: "4 Lake Road, Galle",
    }));
  });
});
