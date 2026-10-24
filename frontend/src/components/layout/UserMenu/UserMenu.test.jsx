import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UserMenu from ".";
import { authState, renderWithProviders } from "../../../test/renderWithProviders";
import {
  adminSessionUser,
  cashierSessionUser,
  managerSessionUser,
  pinSetResponse,
} from "../../../test/authEntities";
import * as approvalsService from "../../../services/approvalsService";

vi.mock("../../../services/approvalsService");

const renderMenu = (user) =>
  renderWithProviders(<UserMenu />, { preloadedState: { auth: authState(user) } });

const openMenu = async (user, name) => {
  await user.click(screen.getByRole("button", { name: new RegExp(name) }));
  return screen.findByRole("menu");
};

const pinItem = () => screen.queryByRole("menuitem", { name: /Approval PIN/ });

describe("UserMenu: Approval PIN (P6-18)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("a manager without a PIN sees Approval PIN, Not set", async () => {
    const user = userEvent.setup();
    renderMenu(managerSessionUser());
    await openMenu(user, "Asha Perera");

    expect(pinItem()).toHaveTextContent("Approval PINNot set");
  });

  it("an admin with a PIN sees when it was set (Colombo time)", async () => {
    const user = userEvent.setup();
    renderMenu(adminSessionUser({ has_approval_pin: true, approval_pin_set_at: "2026-10-22T09:05:00.000Z" }));
    await openMenu(user, "Ruwan Fernando");

    expect(pinItem()).toHaveTextContent("Approval PINSet on 22 Oct 2026, 2:35 PM");
  });

  it("a cashier doesn't see it at all", async () => {
    const user = userEvent.setup();
    renderMenu(cashierSessionUser());
    const menu = await openMenu(user, "Nimal Silva");

    expect(pinItem()).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Log out/ })).toBeInTheDocument();
  });

  it("opens the dialog, and after saving the menu shows the new date", async () => {
    approvalsService.setApprovalPin.mockResolvedValue(pinSetResponse("2026-10-22T09:05:00.000Z"));
    const user = userEvent.setup();
    renderMenu(managerSessionUser());
    await openMenu(user, "Asha Perera");

    await user.click(pinItem());
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Current password"), "secret-pass");
    await user.type(within(dialog).getByLabelText("New PIN"), "482915");
    await user.type(within(dialog).getByLabelText("Confirm PIN"), "482915");
    await user.click(within(dialog).getByRole("button", { name: "Save PIN" }));
    await within(dialog).findByRole("status");
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await openMenu(user, "Asha Perera");
    expect(pinItem()).toHaveTextContent("Set on 22 Oct 2026, 2:35 PM");
  });
});
