import { vi } from "vitest";
import api from "./api";
import {
  COMPLETE_TIMEOUT_MS,
  RETURN_TIMEOUT_MS,
  VOID_TIMEOUT_MS,
  addSalePayment,
  completeSale,
  createReturn,
  listSales,
  removeSalePayment,
  voidSale,
} from "./salesService";
import { CLIENT_REQUEST_ID, createReturnResponse, returnTimeoutError } from "../test/returnEntities";

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

describe("salesService listSales", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("passes filters as axios params and returns { data, meta }", async () => {
    const page = { data: [{ id: "sale-1" }], meta: { total: 1, page: 1, hasNext: false } };
    api.get.mockResolvedValue({ data: page });
    const params = {
      branchId: "branch-1",
      completedFrom: "2026-10-21T00:00:00+05:30",
      completedTo: "2026-10-22T00:00:00+05:30",
      sort: "completed_at",
      page: 2,
      limit: 50,
    };

    await expect(listSales(params)).resolves.toEqual(page);
    expect(api.get).toHaveBeenCalledWith("/sales", { params });
  });

  it("leaves out undefined, null and empty values", async () => {
    api.get.mockResolvedValue({ data: { data: [], meta: {} } });

    await listSales({ branchId: "branch-1", q: "", cashierId: null, status: undefined, page: 0 });

    expect(api.get).toHaveBeenCalledWith("/sales", { params: { branchId: "branch-1", page: 0 } });
  });

  it("works with no params", async () => {
    api.get.mockResolvedValue({ data: { data: [], meta: {} } });

    await listSales();

    expect(api.get).toHaveBeenCalledWith("/sales", { params: {} });
  });
});

describe("salesService voidSale", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("posts the reason and approval with its own 30 s timeout, returning the voided sale", async () => {
    const sale = { id: "sale-1", status: "VOIDED", void_reason: "Wrong price" };
    api.post.mockResolvedValue({ data: sale });
    const payload = {
      void_reason: "Wrong price",
      approval: { approver_id: "user-9", pin: "482915" },
    };

    await expect(voidSale("sale-1", payload)).resolves.toEqual(sale);
    expect(VOID_TIMEOUT_MS).toBe(30000);
    expect(api.post).toHaveBeenCalledWith("/sales/sale-1/void", payload, { timeout: 30000 });
  });

  it("propagates request errors to the caller", async () => {
    const error = Object.assign(new Error("Request failed with status code 403"), {
      response: { status: 403, data: { code: "WRONG_PIN", attempts_left: 3 } },
    });
    api.post.mockRejectedValue(error);

    await expect(
      voidSale("sale-1", { void_reason: "Wrong price", approval: { approver_id: "u", pin: "1" } }),
    ).rejects.toBe(error);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});

describe("salesService createReturn", () => {
  const payload = {
    client_request_id: CLIENT_REQUEST_ID,
    lines: [{ sale_line_id: "line-case", quantity: 1, condition: "RESALEABLE" }],
    refunds: [{ method: "CASH", amount: 1600 }],
    reason: "Faulty item",
    approval: { approver_id: "user-manager", pin: "482915" },
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("posts the body as given with its own 30 s timeout; 201 is a new return", async () => {
    const body = createReturnResponse();
    api.post.mockResolvedValue({ status: 201, data: body });

    await expect(createReturn("sale-7", payload)).resolves.toEqual({
      return_id: "ret-1",
      sale: body.sale,
      resent: false,
    });
    expect(RETURN_TIMEOUT_MS).toBe(30000);
    expect(api.post).toHaveBeenCalledWith("/sales/sale-7/returns", payload, { timeout: 30000 });
  });

  it("200 is an accepted resend: the return recorded earlier", async () => {
    api.post.mockResolvedValue({ status: 200, data: createReturnResponse() });

    await expect(createReturn("sale-7", payload)).resolves.toMatchObject({ return_id: "ret-1", resent: true });
  });

  it("never resends by itself: a timeout reaches the caller after one POST", async () => {
    const error = returnTimeoutError();
    api.post.mockRejectedValue(error);

    await expect(createReturn("sale-7", payload)).rejects.toBe(error);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
