import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import Users from ".";
import RoleProtectedRoute from "../../components/auth/RoleProtectedRoute";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import {
  adminRow,
  apiError,
  codedError,
  kandyBranch,
  mainBranch,
  managerRow,
  userRow,
  usersPage,
} from "../../test/userEntities";
import * as usersService from "../../services/usersService";

vi.mock("../../services/usersService");

const me = { id: "user-admin", email: "ruwan@socio.lk", name: "Ruwan Fernando", role: "admin", branch_id: null };
const rows = [adminRow(), managerRow(), userRow()];

const renderUsers = ({ user = me } = {}) =>
  renderWithProviders(<Users />, {
    route: "/users",
    preloadedState: { auth: authState(user), branches: branchesState([mainBranch, kandyBranch]) },
  });

/** The desktop table (the mobile cards render the same rows again in jsdom). */
const table = () => screen.getByRole("table", { name: "Users" });
const lastQuery = () => usersService.listUsers.mock.calls.at(-1)[0];

describe("Users page", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    usersService.listUsers.mockResolvedValue(usersPage(rows));
  });

  describe("listing", () => {
    it("asks for active users, 20 a page, and shows each user's role, branch, status and PIN", async () => {
      renderUsers();
      await within(await screen.findByRole("table", { name: "Users" })).findByText("Nimal Silva");

      expect(usersService.listUsers).toHaveBeenCalledWith({
        search: undefined, role: undefined, branchId: undefined, isActive: true, page: 1, limit: 20,
      });
      const [admin, manager, cashier] = within(table()).getAllByRole("row").slice(1);
      expect(admin).toHaveTextContent("Ruwan FernandoYouruwan@socio.lk");
      expect(admin).toHaveTextContent("Administrator");
      expect(admin).toHaveTextContent("All branches");
      expect(admin).toHaveTextContent("Set");
      expect(manager).toHaveTextContent("Manager");
      expect(manager).toHaveTextContent("Main Shop");
      expect(cashier).toHaveTextContent("Cashier");
      expect(cashier).toHaveTextContent("Active");
      expect(within(cashier).getAllByRole("cell")[4]).toHaveTextContent("—");
    });

    it("labels a user at an inactive branch, and an inactive user", async () => {
      usersService.listUsers.mockResolvedValue(usersPage([
        userRow({ is_active: false, branch: { id: "branch-old", name: "Galle", is_active: false }, branch_id: "branch-old" }),
      ]));
      renderUsers();
      const [row] = within(await screen.findByRole("table", { name: "Users" })).getAllByRole("row").slice(1);
      await waitFor(() => expect(row).toHaveTextContent("Galle (inactive)"));
      expect(row).toHaveTextContent("Inactive");
    });

    it("never shows a secret field, even if one arrived", async () => {
      usersService.listUsers.mockResolvedValue(usersPage([
        userRow({ password_hash: "$2b$12$abcdefghijklmnopqrstuv", approval_pin_hash: "$2b$12$pinpinpinpinpin" }),
      ]));
      const { container } = renderUsers();
      await screen.findAllByText("Nimal Silva");
      expect(container.textContent).not.toMatch(/\$2b\$/);
    });

    it("shows skeletons while loading", () => {
      usersService.listUsers.mockReturnValue(new Promise(() => {}));
      const { container } = renderUsers();
      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
      expect(screen.queryByText(/No active users/)).not.toBeInTheDocument();
    });

    it("says when there are no users, and when none match the filters", async () => {
      const user = userEvent.setup();
      usersService.listUsers.mockResolvedValue(usersPage([]));
      renderUsers();
      expect((await screen.findAllByText("No active users yet.")).length).toBeGreaterThan(0);

      await user.selectOptions(screen.getByLabelText("Role"), "manager");
      expect((await screen.findAllByText("No users match these filters.")).length).toBeGreaterThan(0);
    });

    it("shows an error with Try again, which loads again", async () => {
      const user = userEvent.setup();
      usersService.listUsers.mockRejectedValueOnce(apiError(500, { message: "Internal server error" }));
      renderUsers();

      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load users. Try again.");
      await user.click(screen.getByRole("button", { name: "Try again" }));
      await within(table()).findByText("Nimal Silva");
      expect(usersService.listUsers).toHaveBeenCalledTimes(2);
    });
  });

  describe("filters and pages", () => {
    it.each([
      ["Role", "cashier", { role: "cashier" }],
      ["Status", "inactive", { isActive: false }],
      ["Status", "all", { isActive: undefined }],
      ["Branch", "branch-kandy", { branchId: "branch-kandy" }],
    ])("the %s filter (%s) goes to the server, from page 1", async (label, value, expected) => {
      const user = userEvent.setup();
      usersService.listUsers.mockResolvedValue(usersPage(rows, { totalPages: 3, total: 50 }));
      renderUsers();
      await within(await screen.findByRole("table", { name: "Users" })).findByText("Nimal Silva");
      await user.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() => expect(lastQuery().page).toBe(2));

      await user.selectOptions(screen.getByLabelText(label), value);

      await waitFor(() => expect(lastQuery()).toMatchObject({ ...expected, page: 1 }));
    });

    it("waits for typing to pause before searching, then starts at page 1", async () => {
      const user = userEvent.setup();
      renderUsers();
      await within(await screen.findByRole("table", { name: "Users" })).findByText("Nimal Silva");

      await user.type(screen.getByRole("searchbox", { name: "Search users" }), "nim");
      // Nothing per keystroke.
      expect(usersService.listUsers.mock.calls.some(([q]) => q.search === "n" || q.search === "ni")).toBe(false);

      await waitFor(() => expect(lastQuery()).toMatchObject({ search: "nim", page: 1 }));
      expect(usersService.listUsers.mock.calls.filter(([q]) => q.search).length).toBe(1);
    });

    it("pages with Previous and Next", async () => {
      const user = userEvent.setup();
      usersService.listUsers.mockResolvedValue(usersPage(rows, { totalPages: 2, total: 25 }));
      renderUsers();
      const pages = await screen.findByRole("navigation", { name: "User pages" });
      expect(pages).toHaveTextContent("Page 1 of 2");
      expect(within(pages).getByRole("button", { name: "Previous" })).toBeDisabled();

      await user.click(within(pages).getByRole("button", { name: "Next" }));
      await waitFor(() => expect(pages).toHaveTextContent("Page 2 of 2"));
      expect(lastQuery()).toMatchObject({ page: 2, limit: 20 });
    });
  });

  describe("row actions", () => {
    it("on the admin's own row, role, reset and deactivate are disabled with the reason", async () => {
      renderUsers();
      const own = within(await screen.findByRole("table", { name: "Users" }));
      await own.findByText("Ruwan Fernando");

      expect(own.getByRole("button", { name: "Edit Ruwan Fernando" })).toBeEnabled();
      expect(own.getByRole("button", { name: "Change role for Ruwan Fernando" })).toBeDisabled();
      expect(own.getByRole("button", { name: "Change role for Ruwan Fernando" })).toHaveAttribute("title", "You can't change your own role");
      expect(own.getByRole("button", { name: "Reset password for Ruwan Fernando" })).toHaveAttribute("title", "Use Change password in your user menu");
      expect(own.getByRole("button", { name: "Deactivate Ruwan Fernando" })).toHaveAttribute("title", "You can't deactivate your own account");
      // Everyone else's are enabled.
      expect(own.getByRole("button", { name: "Change role for Nimal Silva" })).toBeEnabled();
      expect(own.getByRole("button", { name: "Reset password for Nimal Silva" })).toBeEnabled();
      expect(own.getByRole("button", { name: "Deactivate Nimal Silva" })).toBeEnabled();
    });

    it("deactivates after confirmation, explaining the effects, then reloads", async () => {
      const user = userEvent.setup();
      usersService.deactivateUser.mockResolvedValue(userRow({ is_active: false }));
      renderUsers();
      await user.click(within(await screen.findByRole("table", { name: "Users" })).getByRole("button", { name: "Deactivate Nimal Silva" }));

      const dialog = await screen.findByRole("dialog", { name: "Deactivate user" });
      expect(dialog).toHaveTextContent("no longer be able to sign in");
      expect(dialog).toHaveTextContent("approval PIN is cleared");
      expect(dialog).toHaveTextContent("up to 15 minutes");
      expect(usersService.deactivateUser).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole("button", { name: "Yes, deactivate" }));
      await waitFor(() => expect(usersService.deactivateUser).toHaveBeenCalledWith("user-cashier"));
      await waitFor(() => expect(usersService.listUsers).toHaveBeenCalledTimes(2));
    });

    it("shows the last-active-admin refusal in the confirmation", async () => {
      const user = userEvent.setup();
      usersService.listUsers.mockResolvedValue(usersPage([adminRow({ id: "user-admin-2", full_name: "Second Admin" })]));
      usersService.deactivateUser.mockRejectedValue(codedError(400, "LAST_ACTIVE_ADMIN"));
      renderUsers();
      await user.click(within(await screen.findByRole("table", { name: "Users" })).getByRole("button", { name: "Deactivate Second Admin" }));
      const dialog = await screen.findByRole("dialog", { name: "Deactivate user" });

      await user.click(within(dialog).getByRole("button", { name: "Yes, deactivate" }));

      expect(await within(dialog).findByText(/last active admin/)).toBeInTheDocument();
      expect(usersService.listUsers).toHaveBeenCalledTimes(1);
    });

    it("reactivates an inactive user, and shows an inactive-branch refusal", async () => {
      const user = userEvent.setup();
      usersService.listUsers.mockResolvedValue(usersPage([userRow({ is_active: false })]));
      usersService.reactivateUser
        .mockRejectedValueOnce(apiError(400, { statusCode: 400, message: 'Branch "Main Shop" is not active', error: "Bad Request" }))
        .mockResolvedValueOnce(userRow());
      renderUsers();
      await user.click(within(await screen.findByRole("table", { name: "Users" })).getByRole("button", { name: "Reactivate Nimal Silva" }));
      const dialog = await screen.findByRole("dialog", { name: "Reactivate user" });

      await user.click(within(dialog).getByRole("button", { name: "Yes, reactivate" }));
      expect(await within(dialog).findByText('Branch "Main Shop" is not active')).toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: "Yes, reactivate" }));
      await waitFor(() => expect(usersService.listUsers).toHaveBeenCalledTimes(2));
      expect(usersService.reactivateUser).toHaveBeenCalledWith("user-cashier");
    });

    it("reloads after adding a user", async () => {
      const user = userEvent.setup();
      usersService.createUser.mockResolvedValue(userRow({ id: "user-new" }));
      renderUsers();
      await within(await screen.findByRole("table", { name: "Users" })).findByText("Nimal Silva");

      await user.click(screen.getByRole("button", { name: "Add user" }));
      const dialog = await screen.findByRole("dialog", { name: "Add user" });
      await user.type(within(dialog).getByLabelText(/Full name/), "Kamal Perera");
      await user.type(within(dialog).getByLabelText(/^Email/), "kamal@socio.lk");
      await user.type(within(dialog).getByLabelText(/Contact number/), "0771234567");
      await user.type(within(dialog).getByLabelText(/^NIC/), "199012345678");
      await user.type(within(dialog).getByLabelText(/^Address/), "12 Temple Road, Kandy");
      await user.type(within(dialog).getByLabelText(/^Password/), "fresh-pass-1");
      await user.type(within(dialog).getByLabelText(/Confirm password/), "fresh-pass-1");
      await user.selectOptions(within(dialog).getByLabelText(/Branch/), "branch-main");
      await user.click(within(dialog).getByRole("button", { name: "Add user" }));

      await waitFor(() => expect(usersService.listUsers).toHaveBeenCalledTimes(2));
    });
  });
});

describe("Users page: profile card", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    usersService.listUsers.mockResolvedValue(usersPage(rows));
  });

  const ready = async () => {
    const user = userEvent.setup();
    renderUsers();
    await within(await screen.findByRole("table", { name: "Users" })).findByText("Nimal Silva");
    return user;
  };

  it("opens when a row is clicked, without another request", async () => {
    const user = await ready();
    const [, , cashier] = within(table()).getAllByRole("row").slice(1);

    await user.click(within(cashier).getByText("Main Shop"));

    const card = await screen.findByRole("dialog", { name: "User profile" });
    expect(card).toHaveTextContent("Nimal Silva");
    expect(card).toHaveTextContent("nimal@socio.lk");
    expect(usersService.listUsers).toHaveBeenCalledTimes(1);
  });

  it("opens from the keyboard through the name", async () => {
    const user = await ready();
    within(table()).getByRole("button", { name: "View profile for Asha Perera" }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "User profile" })).toHaveTextContent("Asha Perera");
  });

  it("isn't opened by a row action", async () => {
    const user = await ready();
    await user.click(within(table()).getByRole("button", { name: "Reset password for Nimal Silva" }));
    expect(await screen.findByRole("dialog", { name: "Reset password" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "User profile" })).not.toBeInTheDocument();
  });

  it("hands an action over to its own dialog", async () => {
    const user = await ready();
    await user.click(within(table()).getByRole("button", { name: "View profile for Nimal Silva" }));
    const card = await screen.findByRole("dialog", { name: "User profile" });

    await user.click(within(card).getByRole("button", { name: "Change role" }));

    const roleDialog = await screen.findByRole("dialog", { name: "Change role" });
    expect(roleDialog).toHaveTextContent("Nimal Silva · nimal@socio.lk");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "User profile" })).not.toBeInTheDocument());
  });

  it("offers only Edit on the admin's own card", async () => {
    const user = await ready();
    await user.click(within(table()).getByRole("button", { name: "View profile for Ruwan Fernando" }));
    const card = await screen.findByRole("dialog", { name: "User profile" });
    expect(within(card).getByRole("button", { name: "Edit details" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Change role" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
    expect(card).toHaveTextContent("This is your account");
  });
});

describe("/users route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    usersService.listUsers.mockResolvedValue(usersPage(rows));
  });

  const renderAt = (role) =>
    renderWithProviders(
      <Routes>
        <Route path="/dashboard" element={<p>Dashboard page</p>} />
        <Route path="/users" element={<RoleProtectedRoute allowedRoles={["admin"]}><Users /></RoleProtectedRoute>} />
      </Routes>,
      { route: "/users", preloadedState: { auth: authState({ ...me, id: `user-${role}`, role }), branches: branchesState([mainBranch]) } },
    );

  it.each(["manager", "cashier"])("sends a %s to the dashboard, without asking for users", (role) => {
    renderAt(role);
    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(usersService.listUsers).not.toHaveBeenCalled();
  });

  it("shows the page to an admin", async () => {
    renderAt("admin");
    expect(await screen.findByRole("heading", { name: "Users", level: 1 })).toBeInTheDocument();
  });
});
