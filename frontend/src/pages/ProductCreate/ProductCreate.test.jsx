import { vi } from "vitest";
import { screen } from "@testing-library/react";
import ProductCreate from ".";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { adminUser, mainShop } from "../../test/fixtures";

vi.mock("../../services/productsService");

describe("ProductCreate — default warranty (P5-18)", () => {
  it("starts on No warranty (P5-19), with no old warranty number fields", () => {
    renderWithProviders(<ProductCreate />, {
      route: "/products/new",
      preloadedState: {
        auth: authState(adminUser),
        branches: branchesState([mainShop]),
        brands: { brands: [], loading: false, error: null, initialized: true },
        categories: { categories: [], loading: false, error: null, initialized: true },
      },
    });

    expect(screen.getByText("Default warranty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No warranty" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Warranty \(months\)/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Checking warranty \(days\)/)).not.toBeInTheDocument();
  });
});
