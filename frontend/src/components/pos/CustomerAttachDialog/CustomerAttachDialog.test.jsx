import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomerAttachDialog from ".";
import { posTerminalState, renderWithProviders } from "../../../test/renderWithProviders";
import { customer, draftSale } from "../../../test/posFixtures";
import * as customersService from "../../../services/customersService";
import * as salesService from "../../../services/salesService";

vi.mock("../../../services/customersService");
vi.mock("../../../services/salesService");

const kamal = customer();
const nimali = customer({ id: "cust-2", name: "Nimali Fernando", phone: "0712223333", nic: null });

const renderDialog = () => {
  const onClose = vi.fn();
  const utils = renderWithProviders(<CustomerAttachDialog open onClose={onClose} />, {
    preloadedState: { posTerminal: posTerminalState() },
  });
  return { ...utils, onClose };
};

const searchInput = () => screen.getByRole("combobox", { name: /search customers/i });

beforeEach(() => {
  vi.resetAllMocks();
  customersService.listCustomers.mockResolvedValue({ data: [kamal, nimali], meta: {} });
  salesService.updateSale.mockImplementation(async (_, { customer_id }) =>
    draftSale({ customer_id, customer: [kamal, nimali].find((c) => c.id === customer_id) ?? null }),
  );
});

describe("CustomerAttachDialog", () => {
  it("focuses the search, waits for 2+ chars and debounces into one search", async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(searchInput()).toHaveFocus();

    await user.type(searchInput(), "k");
    await new Promise((r) => setTimeout(r, 300));
    expect(customersService.listCustomers).not.toHaveBeenCalled();

    await user.type(searchInput(), "am");
    expect(customersService.listCustomers).not.toHaveBeenCalled();

    const list = await screen.findByRole("listbox", { name: /matching customers/i });
    expect(customersService.listCustomers).toHaveBeenCalledTimes(1);
    expect(customersService.listCustomers).toHaveBeenCalledWith({ search: "kam", limit: 10 });
    const first = within(list).getAllByRole("option")[0];
    expect(first).toHaveTextContent("Kamal Perera");
    expect(first).toHaveTextContent("077 123 4567 · NIC 199012345678");
  });

  it("attaches the highlighted customer on Enter and closes", async () => {
    const user = userEvent.setup();
    const { onClose, store } = renderDialog();

    await user.type(searchInput(), "per");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onClose).toHaveBeenCalledTimes(1);
    // Optimistic — the card has the customer before the PATCH answers.
    expect(store.getState().posTerminal.draftSale.customer).toEqual(nimali);
    await waitFor(() =>
      expect(salesService.updateSale).toHaveBeenCalledWith("sale-1", { customer_id: "cust-2" }),
    );
  });

  it("creates a customer inline after validating the phone, then attaches it", async () => {
    const created = customer({ id: "cust-new", name: "Sunil Silva", phone: "0779998888", nic: null });
    customersService.createCustomer.mockResolvedValue(created);
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.type(searchInput(), "Sunil Silva");
    await user.click(screen.getByRole("button", { name: /create new customer/i }));

    const form = screen.getByRole("form", { name: /new customer/i });
    expect(within(form).getByLabelText(/name/i)).toHaveValue("Sunil Silva");
    expect(within(form).getByLabelText(/name/i)).toHaveFocus();

    await user.type(within(form).getByLabelText(/phone/i), "12345");
    await user.click(within(form).getByRole("button", { name: /save and attach/i }));
    expect(within(form).getByText(/enter a sri lankan number/i)).toBeInTheDocument();
    expect(customersService.createCustomer).not.toHaveBeenCalled();

    await user.clear(within(form).getByLabelText(/phone/i));
    await user.type(within(form).getByLabelText(/phone/i), "+94 77 999 8888");
    await user.click(within(form).getByRole("button", { name: /save and attach/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(customersService.createCustomer).toHaveBeenCalledWith({
      name: "Sunil Silva",
      phone: "0779998888",
      nic: null,
    });
    expect(salesService.updateSale).toHaveBeenCalledWith("sale-1", { customer_id: "cust-new" });
  });

  it("offers the existing customer on a NIC clash and attaches them", async () => {
    customersService.createCustomer.mockRejectedValue(
      Object.assign(new Error("Conflict"), {
        response: {
          status: 409,
          data: { message: "A customer with NIC 199012345678 already exists", existing_customer_id: "cust-1" },
        },
      }),
    );
    customersService.getCustomer.mockResolvedValue(kamal);
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(screen.getByRole("button", { name: /create new customer/i }));
    const form = screen.getByRole("form", { name: /new customer/i });
    await user.type(within(form).getByLabelText(/name/i), "K. Perera");
    await user.type(within(form).getByLabelText(/phone/i), "0771234567");
    await user.type(within(form).getByLabelText(/nic/i), "199012345678");
    await user.click(within(form).getByRole("button", { name: /save and attach/i }));

    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent("already on file for Kamal Perera · 077 123 4567");
    expect(salesService.updateSale).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(alert).getByRole("button", { name: /use existing customer/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(salesService.updateSale).toHaveBeenCalledWith("sale-1", { customer_id: "cust-1" });
  });

  it("closes on Escape without touching the sale", async () => {
    const user = userEvent.setup();
    const { onClose, store } = renderDialog();

    await user.type(searchInput(), "kam");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(salesService.updateSale).not.toHaveBeenCalled();
    expect(store.getState().posTerminal.draftSale.customer).toBeUndefined();
  });
});
