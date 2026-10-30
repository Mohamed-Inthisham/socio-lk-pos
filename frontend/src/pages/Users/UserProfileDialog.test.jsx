import { vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UserProfileDialog from "./UserProfileDialog";
import { renderWithProviders } from "../../test/renderWithProviders";
import { adminRow, managerRow, userRow } from "../../test/userEntities";

const actions = { onClose: vi.fn(), onEdit: vi.fn(), onChangeRole: vi.fn(), onResetPassword: vi.fn(), onToggleStatus: vi.fn() };

const show = (user, { isSelf = false } = {}) => {
  renderWithProviders(<UserProfileDialog user={user} isSelf={isSelf} {...actions} />);
  return screen.getByRole("dialog", { name: "User profile" });
};

describe("UserProfileDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows who the user is, where they work and when the account was added", () => {
    const card = show(userRow());
    expect(card).toHaveTextContent("NS");
    expect(card).toHaveTextContent("Nimal Silva");
    expect(card).toHaveTextContent("nimal@socio.lk");
    expect(card).toHaveTextContent("Cashier");
    expect(card).toHaveTextContent("Active");
    expect(card).toHaveTextContent("Main Shop");
    // 04:00 UTC is 9:30 AM in Colombo.
    expect(card).toHaveTextContent("Added on01 Oct 2026, 9:30 AM");
    expect(card).toHaveTextContent("Cashiers don't hold one");
  });

  it("shows an admin's branches and when their PIN was set", () => {
    const card = show(adminRow());
    expect(card).toHaveTextContent("Administrator");
    expect(card).toHaveTextContent("All branches");
    expect(card).toHaveTextContent("Set on 20 Oct 2026, 9:30 AM");
  });

  it("says a manager without a PIN has none, and names an inactive user and branch", () => {
    const card = show(managerRow({
      approval_pin_set_at: null, is_active: false, branch: { id: "branch-old", name: "Galle", is_active: false },
    }));
    expect(card).toHaveTextContent("Approval PINNot set");
    expect(card).toHaveTextContent("Inactive");
    expect(card).toHaveTextContent("Galle (inactive)");
  });

  it("never shows a secret field, even if one arrived", () => {
    const card = show(userRow({ password_hash: "$2b$12$abcdefghijklmnopqrstuv", approval_pin_hash: "$2b$12$pinpin" }));
    expect(card.textContent).not.toMatch(/\$2b\$/);
  });

  it("passes the user to each action", async () => {
    const user = userEvent.setup();
    const nimal = userRow();
    const card = show(nimal);
    for (const [name, handler] of [
      ["Edit details", actions.onEdit],
      ["Change role", actions.onChangeRole],
      ["Reset password", actions.onResetPassword],
      ["Deactivate", actions.onToggleStatus],
    ]) {
      await user.click(within(card).getByRole("button", { name }));
      expect(handler).toHaveBeenCalledWith(nimal);
    }
  });

  it("offers Reactivate for an inactive user", () => {
    const card = show(userRow({ is_active: false }));
    expect(within(card).getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
  });

  it("on your own card offers only Edit, and says why", () => {
    const card = show(adminRow(), { isSelf: true });
    expect(card).toHaveTextContent("You");
    expect(within(card).getAllByRole("button").map((b) => b.textContent || b.getAttribute("aria-label")))
      .toEqual(["Close dialog", "Edit details", "Close"]);
    expect(card).toHaveTextContent("change your password from your user menu");
  });

  it("closes from Close", async () => {
    const user = userEvent.setup();
    const card = show(userRow());
    await user.click(within(card).getByRole("button", { name: "Close" }));
    expect(actions.onClose).toHaveBeenCalled();
  });
});
