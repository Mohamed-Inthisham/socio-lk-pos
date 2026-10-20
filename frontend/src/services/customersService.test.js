import { vi } from "vitest";
import api from "./api";
import { createCustomer, listCustomers, updateCustomer } from "./customersService";

vi.mock("./api", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

describe("customersService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("patches a customer and returns the updated row", async () => {
    const customer = { id: "c1", name: "Kamal Perera", nic: "199012345678" };
    api.patch.mockResolvedValue({ data: customer });

    await expect(updateCustomer("c1", { nic: "199012345678" })).resolves.toEqual(customer);
    expect(api.patch).toHaveBeenCalledWith("/customers/c1", { nic: "199012345678" });
  });

  it("lists customers with search and limit, dropping empty values", async () => {
    const page = { data: [{ id: "c1", name: "Kamal Perera" }], meta: { total: 1 } };
    api.get.mockResolvedValue({ data: page });

    await expect(listCustomers({ search: "kam", limit: 10, page: "" })).resolves.toEqual(page);
    expect(api.get).toHaveBeenCalledWith("/customers", {
      params: { search: "kam", limit: 10 },
    });
  });

  it("creates a customer and returns the new row", async () => {
    const customer = { id: "c1", name: "Kamal Perera", phone: "0771234567", nic: null };
    api.post.mockResolvedValue({ data: customer });

    await expect(
      createCustomer({ name: "Kamal Perera", phone: "+94771234567" }),
    ).resolves.toEqual(customer);
    expect(api.post).toHaveBeenCalledWith("/customers", {
      name: "Kamal Perera",
      phone: "+94771234567",
    });
  });
});
