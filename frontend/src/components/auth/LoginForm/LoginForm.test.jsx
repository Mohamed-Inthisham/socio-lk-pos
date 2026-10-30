import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import LoginForm from "./index";
import { loginAPI } from "../../../services/authService";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { adminUser, cashierUser } from "../../../test/fixtures";

vi.mock("../../../services/authService", () => ({
  loginAPI: vi.fn(),
  logoutAPI: vi.fn(),
  getCurrentUser: vi.fn(),
}));

const renderLogin = (route = "/login", options = {}) =>
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginForm />} />
      <Route path="/pos" element={<p>pos page</p>} />
      <Route path="/dashboard" element={<p>dashboard page</p>} />
      <Route path="/products" element={<p>products page</p>} />
    </Routes>,
    { route, ...options },
  );

const signIn = async () => {
  await userEvent.type(screen.getByLabelText("Email"), "someone@socio.lk");
  await userEvent.type(screen.getByLabelText("Password"), "secret");
  await userEvent.click(screen.getByRole("button", { name: "Sign In" }));
};

describe("LoginForm redirect", () => {
  it("sends cashiers to the POS terminal", async () => {
    loginAPI.mockResolvedValueOnce({ user: cashierUser });
    renderLogin();
    await signIn();
    expect(await screen.findByText("pos page")).toBeInTheDocument();
  });

  it("sends other roles to the dashboard", async () => {
    loginAPI.mockResolvedValueOnce({ user: adminUser });
    renderLogin();
    await signIn();
    expect(await screen.findByText("dashboard page")).toBeInTheDocument();
  });

  it("returns a cashier to the page they were trying to open", async () => {
    loginAPI.mockResolvedValueOnce({ user: cashierUser });
    renderLogin({
      pathname: "/login",
      state: { from: { pathname: "/products" } },
    });
    await signIn();
    expect(await screen.findByText("products page")).toBeInTheDocument();
  });
});

describe("LoginForm sign-in notice (Task 2.4)", () => {
  const NOTICE = "Your password was changed successfully. Please sign in again with your new password.";
  const signedOut = (signInNotice) => ({
    auth: { user: null, isAuthenticated: false, loading: false, error: null, initialized: true, signInNotice },
  });

  it("shows the notice once, clearing it from the store", () => {
    const { store, unmount } = renderLogin("/login", { preloadedState: signedOut(NOTICE) });

    expect(screen.getByRole("status")).toHaveTextContent(NOTICE);
    expect(store.getState().auth.signInNotice).toBeNull();

    unmount();
    renderLogin("/login", { store });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows nothing without a notice", () => {
    renderLogin("/login", { preloadedState: signedOut(null) });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
