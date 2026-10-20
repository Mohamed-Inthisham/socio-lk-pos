import { vi } from "vitest";
import api from "./api";
import {
  COMPLETE_TIMEOUT_MS,
  addSalePayment,
  completeSale,
  removeSalePayment,
} from "./salesService";

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

describe("salesService completeSale", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("posts with no body and its own 30 s timeout, returning the completed sale", async () => {
    const sale = { id: "sale-1", status: "COMPLETED", sale_number: "INV-20261020-0001" };
    api.post.mockResolvedValue({ data: sale });

    await expect(completeSale("sale-1")).resolves.toEqual(sale);
    expect(COMPLETE_TIMEOUT_MS).toBe(30000);
    expect(api.post).toHaveBeenCalledWith("/sales/sale-1/complete", undefined, {
      timeout: 30000,
    });
  });

  it("propagates request errors to the caller", async () => {
    const error = Object.assign(new Error("timeout of 30000ms exceeded"), {
      code: "ECONNABORTED",
    });
    api.post.mockRejectedValue(error);

    await expect(completeSale("sale-1")).rejects.toBe(error);
  });
});
