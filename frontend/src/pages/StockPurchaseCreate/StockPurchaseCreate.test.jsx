import { vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import StockPurchaseCreate from "./index";
import api from "../../services/api";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";

// The real services, with only the HTTP client mocked: checks the request
// body that leaves the browser, and how the page reads 201 and 200.
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const manager = { id: "user-manager", role: "manager", branch_id: "branch-main", full_name: "Nimal Silva" };
const preloadedState = {
  auth: authState(manager),
  branches: branchesState([{ id: "branch-main", name: "Main Shop", is_active: true }]),
};
const supplier = { id: "supplier-1", name: "Colombo Wholesale", is_active: true };
const cable = {
  id: "product-cable",
  name: "UGREEN Cable",
  sku: "SKU-CABLE",
  is_active: true,
  tracking_method: "QUANTITY",
  is_serialized: false,
  selling_price: "1500.00",
};
const recorded = { id: "purchase-1", purchase_number: "SP-0000ABCD" };

/** Where the page navigated, and with what state. */
const PurchaseProbe = () => {
  const location = useLocation();
  return <p data-testid="probe">{JSON.stringify({ path: location.pathname, state: location.state })}</p>;
};

const renderPage = () =>
  renderWithProviders(
    <Routes>
      <Route path="/stock-purchases/new" element={<StockPurchaseCreate />} />
      <Route path="/stock-purchases/:id" element={<PurchaseProbe />} />
    </Routes>,
    { preloadedState, route: "/stock-purchases/new" },
  );

const choose = async (user, trigger, option) => {
  await user.click(screen.getByRole("button", { name: trigger }));
  await user.click(await screen.findByRole("option", { name: option }));
};

/** Fill in one cable purchase, ready to submit. */
const fillForm = async (user) => {
  await screen.findByRole("heading", { name: "Purchase details" });
  await choose(user, /Select a supplier/, "Colombo Wholesale");
  await choose(user, /Select a product/, "UGREEN Cable · SKU-CABLE");
  await user.type(screen.getByPlaceholderText("e.g. 18000.00"), "400");
};

const submit = (user) => user.click(screen.getByRole("button", { name: "Record purchase and receive stock" }));

const probe = async () => JSON.parse((await screen.findByTestId("probe")).textContent);

const sentIds = () => api.post.mock.calls.map(([, body]) => body.client_request_id);

describe("StockPurchaseCreate: client_request_id (Phase 1 T1c)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // The page scrolls its error into view; jsdom has no scrolling.
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    api.get.mockImplementation((url) =>
      Promise.resolve({ data: url === "/suppliers" ? [supplier] : { data: [cable] } }),
    );
  });

  it("POST /stock-purchases carries a UUID client_request_id with the purchase", async () => {
    api.post.mockResolvedValue({ status: 201, data: recorded });
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    await submit(user);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe("/stock-purchases");
    expect(body.client_request_id).toMatch(UUID);
    expect(body).toMatchObject({
      supplier_id: "supplier-1",
      branch_id: "branch-main",
      items: [{ product_id: "product-cable", quantity: 1, unit_buying_price: "400" }],
    });
  });

  it("a 201 opens the new purchase without the already-recorded notice", async () => {
    api.post.mockResolvedValue({ status: 201, data: recorded });
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    await submit(user);

    expect(await probe()).toEqual({ path: "/stock-purchases/purchase-1", state: null });
  });

  it("a 200 (already recorded) opens that purchase with the already-recorded notice", async () => {
    api.post.mockResolvedValue({ status: 200, data: recorded });
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    await submit(user);

    expect(await probe()).toEqual({
      path: "/stock-purchases/purchase-1",
      state: { alreadyRecorded: true },
    });
  });

  it("a retry after a lost response sends the same client_request_id", async () => {
    api.post
      .mockRejectedValueOnce(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }))
      .mockResolvedValueOnce({ status: 200, data: recorded });
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    await submit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network Error");
    await submit(user);

    expect(await probe()).toEqual({
      path: "/stock-purchases/purchase-1",
      state: { alreadyRecorded: true },
    });
    expect(api.post).toHaveBeenCalledTimes(2);
    const [first, second] = sentIds();
    expect(first).toMatch(UUID);
    expect(second).toBe(first);
  });

  it("keeps the same client_request_id after a refusal and after the form is edited", async () => {
    api.post
      .mockRejectedValueOnce(
        Object.assign(new Error("Request failed with status code 409"), {
          response: { status: 409, data: { message: "Identifier 356938035643810 is already in stock." } },
        }),
      )
      .mockResolvedValueOnce({ status: 201, data: recorded });
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    await submit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("already in stock");
    await user.clear(screen.getByPlaceholderText("e.g. 18000.00"));
    await user.type(screen.getByPlaceholderText("e.g. 18000.00"), "450");
    await submit(user);

    await probe();
    const [first, second] = sentIds();
    expect(second).toBe(first);
    expect(api.post.mock.calls[1][1].items[0].unit_buying_price).toBe("450");
  });

  it("a double submit sends one client_request_id for both requests", async () => {
    let answer;
    api.post.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    const form = screen.getByRole("button", { name: "Record purchase and receive stock" }).closest("form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    answer({ status: 201, data: recorded });

    await probe();
    expect(api.post).toHaveBeenCalledTimes(2);
    const [first, second] = sentIds();
    expect(second).toBe(first);
  });

  it("a new visit to the page uses a new client_request_id", async () => {
    api.post.mockResolvedValue({ status: 201, data: recorded });
    const user = userEvent.setup();
    const first = renderPage();
    await fillForm(user);
    await submit(user);
    await probe();
    first.unmount();

    renderPage();
    await fillForm(user);
    await submit(user);
    await probe();

    const [firstId, secondId] = sentIds();
    expect(firstId).toMatch(UUID);
    expect(secondId).toMatch(UUID);
    expect(secondId).not.toBe(firstId);
  });
});
