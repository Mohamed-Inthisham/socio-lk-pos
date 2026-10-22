import { useState } from "react";
import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import ApprovalPinDialog from ".";
import { authState, renderWithProviders } from "../../../test/renderWithProviders";
import {
  malformedPinError,
  managerSessionUser,
  networkError,
  notManagerError,
  pinSetResponse,
  weakPinError,
  wrongPasswordError,
} from "../../../test/authEntities";
import { POS_RETURN_FOCUS_EVENT } from "../../../utils/posFocus";
import * as approvalsService from "../../../services/approvalsService";

vi.mock("../../../services/approvalsService");

const PASSWORD = "secret-pass";
const PIN = "482915";

const Host = () => {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  return (
    <>
      <p data-testid="where">{location.pathname}</p>
      <button type="button" onClick={() => setOpen(true)}>Open PIN</button>
      <ApprovalPinDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
};

const renderHost = (user = managerSessionUser()) =>
  renderWithProviders(
    <Routes>
      <Route path="/pos" element={<Host />} />
    </Routes>,
    { route: "/pos", preloadedState: { auth: authState(user) } },
  );

const dialog = () => screen.queryByRole("dialog");
const password = () => screen.getByLabelText("Current password");
const pin = () => screen.getByLabelText("New PIN");
const confirm = () => screen.getByLabelText("Confirm PIN");
const save = () => screen.getByRole("button", { name: "Save PIN" });

const openDialog = async (user) => {
  await user.click(screen.getByRole("button", { name: "Open PIN" }));
  await screen.findByRole("dialog");
};

const fill = async (user, { pw = PASSWORD, p = PIN, c = p } = {}) => {
  if (pw) await user.type(password(), pw);
  if (p) await user.type(pin(), p);
  if (c) await user.type(confirm(), c);
};

let consoleSpies;

beforeEach(() => {
  vi.resetAllMocks();
  consoleSpies = ["log", "info", "warn", "error", "debug"].map((m) => vi.spyOn(console, m));
});

afterEach(() => {
  consoleSpies.forEach((s) => s.mockRestore());
});

// Nothing anywhere holds the password or the PIN.
const expectNoSecrets = (store) => {
  const everything = [
    JSON.stringify(store.getState()),
    JSON.stringify({ ...localStorage }),
    JSON.stringify({ ...sessionStorage }),
    JSON.stringify(consoleSpies.flatMap((s) => s.mock.calls.map((c) => c.map(String)))),
  ].join("\n");
  expect(everything).not.toContain(PASSWORD);
  expect(everything).not.toContain(PIN);
};

describe("ApprovalPinDialog: the form (P6-18)", () => {
  it("opens on Current password, says Not set, with password and PIN fields that hide what's typed", async () => {
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);

    expect(within(dialog()).getByRole("heading", { name: "Set approval PIN" })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("Not set.");
    await waitFor(() => expect(password()).toHaveFocus());
    expect(password()).toHaveAttribute("type", "password");
    expect(password()).toHaveAttribute("autocomplete", "current-password");
    for (const field of [pin(), confirm()]) {
      expect(field).toHaveAttribute("type", "password");
      expect(field).toHaveAttribute("inputmode", "numeric");
      expect(field).toHaveAttribute("autocomplete", "off");
      expect(field).toHaveAttribute("maxlength", "6");
    }
  });

  it("says Change, with the date it was set, when there is a PIN", async () => {
    const user = userEvent.setup();
    renderHost(managerSessionUser({ has_approval_pin: true, approval_pin_set_at: "2026-10-20T03:00:00.000Z" }));
    await openDialog(user);

    expect(within(dialog()).getByRole("heading", { name: "Change approval PIN" })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("Set on 20 Oct 2026, 08:30.");
  });

  it("keeps digits only in the PIN fields", async () => {
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);

    await user.type(pin(), "48a2 9-15");

    expect(pin()).toHaveValue("482915");
  });
});

describe("ApprovalPinDialog: typing and pasting a PIN", () => {
  const hint = (field) => {
    const id = field.getAttribute("aria-describedby");
    return id?.endsWith("-hint") ? document.getElementById(id) : null;
  };

  it.each([
    ["New PIN", () => pin()],
    ["Confirm PIN", () => confirm()],
  ])("%s: key by key, digits kept, letters dropped, a 7th digit ignored", async (_, field) => {
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);

    await user.type(field(), "4");
    expect(field()).toHaveValue("4");
    await user.type(field(), "x");
    expect(field()).toHaveValue("4");
    await user.type(field(), "82915");
    expect(field()).toHaveValue("482915");
    await user.type(field(), "7");
    expect(field()).toHaveValue("482915");
  });

  it.each([
    ["New PIN", () => pin()],
    ["Confirm PIN", () => confirm()],
  ])("%s: pasting 12a3456 keeps 123456", async (_, field) => {
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);

    await user.click(field());
    await user.paste("12a3456");

    expect(field()).toHaveValue("123456");
  });

  it.each([
    ["full-width", "４８２９１５"],
    ["Sinhala Lith", "෪෮෨෯෧෫"],
    ["Tamil", "௪௮௨௯௧௫"],
    ["Devanagari", "४८२९१५"],
    ["Arabic-Indic", "٤٨٢٩١٥"],
  ])("%s digits typed key by key become 482915 in both fields, with no hint", async (_, typed) => {
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);

    await user.type(pin(), typed);
    await user.type(confirm(), typed);

    expect(pin()).toHaveValue("482915");
    expect(confirm()).toHaveValue("482915");
    expect(hint(pin())).toBeNull();
    expect(hint(confirm())).toBeNull();
  });

  it("shows 'Digits only' under that field when a key is dropped, and clears it on the next digit", async () => {
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);

    await user.type(pin(), "4a");
    expect(hint(pin())).toHaveTextContent("Digits only");
    expect(hint(pin())).toHaveClass("text-amber-700", "dark:text-amber-400");
    expect(hint(confirm())).toBeNull(); // only the field that dropped it

    await user.type(pin(), "{Backspace}");
    expect(hint(pin())).toHaveTextContent("Digits only"); // deleting isn't a new digit

    await user.type(pin(), "8");
    expect(hint(pin())).toBeNull();
    expect(screen.queryByText("Digits only")).not.toBeInTheDocument();
  });

  it("a paste with something dropped shows the hint; a clean paste clears it", async () => {
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);

    await user.click(confirm());
    await user.paste("12a3");
    expect(confirm()).toHaveValue("123");
    expect(hint(confirm())).toHaveTextContent("Digits only");

    await user.paste("456");
    expect(confirm()).toHaveValue("123456");
    expect(hint(confirm())).toBeNull();
  });

  it("an error on the field takes the hint's place", async () => {
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);

    await fill(user, { p: "123456" });
    await user.type(pin(), "{Backspace}a");
    await user.click(save());

    expect(await within(dialog()).findByText(/too easy to guess|must be 6 digits/)).toBeInTheDocument();
    expect(screen.queryByText("Digits only")).not.toBeInTheDocument();
  });

  it.each([
    ["a weak PIN", { p: "123456" }, "That PIN is too easy to guess"],
    ["PINs that don't match", { p: PIN, c: "482916" }, "The PINs don't match"],
    ["a short PIN", { p: "4829", c: "4829" }, "The PIN must be 6 digits"],
    ["no password", { pw: "" }, "Enter your current password"],
  ])("refuses %s without sending anything", async (_, values, message) => {
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);

    await fill(user, values);
    await user.click(save());

    expect(await within(dialog()).findByText(new RegExp(message))).toBeInTheDocument();
    expect(approvalsService.setApprovalPin).not.toHaveBeenCalled();
  });
});

describe("ApprovalPinDialog: saving", () => {
  it("sends the password and PIN only, records the new state, and says so with Done focused", async () => {
    approvalsService.setApprovalPin.mockResolvedValue(pinSetResponse("2026-10-22T09:05:00.000Z"));
    const user = userEvent.setup();
    const { store } = renderHost();
    await openDialog(user);

    await fill(user);
    await user.keyboard("{Enter}");

    const status = await within(dialog()).findByRole("status");
    expect(status).toHaveTextContent("PIN set on 22 Oct 2026, 14:35. You can now approve voids with it.");
    expect(approvalsService.setApprovalPin).toHaveBeenCalledWith({ current_password: PASSWORD, pin: PIN });
    expect(store.getState().auth.user).toMatchObject({
      has_approval_pin: true,
      approval_pin_set_at: "2026-10-22T09:05:00.000Z",
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toHaveFocus());
    expectNoSecrets(store);

    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
  });

  it("a wrong current password stays in the dialog: under the field, cleared and focused, nothing else changes", async () => {
    approvalsService.setApprovalPin.mockRejectedValue(wrongPasswordError());
    const user = userEvent.setup();
    const { store } = renderHost();
    const authBefore = store.getState().auth;
    await openDialog(user);

    await fill(user);
    await user.click(save());

    expect(await within(dialog()).findByText("Current password is incorrect.")).toBeInTheDocument();
    expect(password()).toHaveValue("");
    await waitFor(() => expect(password()).toHaveFocus());
    expect(pin()).toHaveValue(PIN); // kept: only the password was wrong
    // Not a login or permission failure: still signed in, same page, no state change
    expect(store.getState().auth).toEqual(authBefore);
    expect(screen.getByTestId("where")).toHaveTextContent("/pos");
    expect(dialog()).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expectNoSecrets(store);
  });

  it("the server's weak-PIN refusal shows under New PIN", async () => {
    approvalsService.setApprovalPin.mockRejectedValue(weakPinError());
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);

    await fill(user);
    await user.click(save());

    expect(await within(dialog()).findByText(/That PIN is too easy to guess/)).toBeInTheDocument();
    expect(pin()).toHaveAttribute("aria-invalid", "true");
  });

  it("a malformed-PIN 400 shows its first message under New PIN", async () => {
    approvalsService.setApprovalPin.mockRejectedValue(malformedPinError());
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);

    await fill(user);
    await user.click(save());

    expect(await within(dialog()).findByText("pin must be exactly 6 digits")).toBeInTheDocument();
  });

  it.each([
    ["a 403 without a code", notManagerError, "Only managers and admins can set an approval PIN."],
    ["no response", networkError, "Couldn't save the PIN. Try again."],
  ])("%s shows an alert in the dialog", async (_, error, message) => {
    approvalsService.setApprovalPin.mockRejectedValue(error());
    const user = userEvent.setup();
    const { store } = renderHost();
    await openDialog(user);

    await fill(user);
    await user.click(save());

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(message);
    expect(store.getState().auth.isAuthenticated).toBe(true);
    expectNoSecrets(store);
  });

  it("Esc doesn't close it while saving", async () => {
    let finish;
    approvalsService.setApprovalPin.mockImplementation(() => new Promise((r) => { finish = r; }));
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);

    await fill(user);
    await user.click(save());
    await user.keyboard("{Escape}");

    expect(dialog()).toBeInTheDocument();
    finish(pinSetResponse());
    expect(await within(dialog()).findByRole("status")).toBeInTheDocument();
  });
});

describe("ApprovalPinDialog: closing", () => {
  it("clears every field: reopening starts empty", async () => {
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);
    await fill(user);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await openDialog(user);

    expect(password()).toHaveValue("");
    expect(pin()).toHaveValue("");
    expect(confirm()).toHaveValue("");
  });

  it("asks the terminal to take focus back once it has gone (pos:return-focus)", async () => {
    const heard = vi.fn();
    window.addEventListener(POS_RETURN_FOCUS_EVENT, heard);
    const user = userEvent.setup();
    renderHost();
    await openDialog(user);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    window.removeEventListener(POS_RETURN_FOCUS_EVENT, heard);
  });
});
