import { vi } from "vitest";
import api from "./api";
import { addSalePayment, removeSalePayment } from "./salesService";

vi.mock("./api", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describe("salesService payments", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("posts a payment and returns the hydrated sale", async () => {
    const sale = { id: "sale-1", amount_paid: "1000.00", payments: [{ id: "pay-1" }] };
    api.post.mockResolvedValue({ data: sale });
    const payload = { payment_method: "CASH", amount: 1000, cash_received: 2000 };

    await expect(addSalePayment("sale-1", payload)).resolves.toEqual(sale);
    expect(api.post).toHaveBeenCalledWith("/sales/sale-1/payments", payload);
  });

  it("deletes a payment (204, no body)", async () => {
    api.delete.mockResolvedValue({ status: 204, data: "" });

    await expect(removeSalePayment("sale-1", "pay-1")).resolves.toBeUndefined();
    expect(api.delete).toHaveBeenCalledWith("/sales/sale-1/payments/pay-1");
  });

  it("propagates request errors to the caller", async () => {
    const error = Object.assign(new Error("Bad Request"), {
      response: { status: 400, data: { message: "reference_number is required for CARD payments" } },
    });
    api.post.mockRejectedValue(error);

    await expect(
      addSalePayment("sale-1", { payment_method: "CARD", amount: 500 }),
    ).rejects.toBe(error);
  });
});
