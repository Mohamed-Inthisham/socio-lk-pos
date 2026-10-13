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

const renderLogin = (route = "/login") =>
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginForm />} />
      <Route path="/pos" element={<p>pos page</p>} />
      <Route path="/dashboard" element={<p>dashboard page</p>} />
      <Route path="/products" element={<p>products page</p>} />
    </Routes>,
    { route },
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
