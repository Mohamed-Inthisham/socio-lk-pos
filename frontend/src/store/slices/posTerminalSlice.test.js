import { vi } from "vitest";
import { createTestStore } from "../../test/renderWithProviders";
import {
  draftSale,
  saleLine,
  cableProduct,
  customer,
  tradeInPayment,
  cashPayment,
  cardPayment,
} from "../../test/posFixtures";
import useTerminalSessionStore from "../zustand/terminalSessionStore";
import * as salesService from "../../services/salesService";
import * as stockService from "../../services/stockService";
import * as customersService from "../../services/customersService";
import {
  addLine,
  addPayment,
  attachCustomer,
  createAndAttachCustomer,
  detachCustomer,
  discardDraftSale,
  ensureDraftSale,
  removeLine,
  removePayment,
  resetMutationQueue,
  saveCustomerNic,
  selectAttachedCustomer,
  selectBalanceDue,
  selectCartLines,
  selectCartSyncing,
  selectHasTradeInPayment,
  selectIsFullyPaid,
  selectPaidTotal,
  selectPayments,
  selectStockWarnings,
  selectTradeInImeis,
  updateLineQty,
} from "./posTerminalSlice";

vi.mock("../../services/salesService");
vi.mock("../../services/stockService");
vi.mock("../../services/customersService");

const httpError = (status, message = "error") =>
  Object.assign(new Error(message), {
    response: { status, data: { message } },
  });

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const readyStore = (sale = draftSale()) => {
  const store = createTestStore();
  salesService.createSale.mockResolvedValue(sale);
  return { store, ready: store.dispatch(ensureDraftSale({ branchId: sale.branch_id })) };
};

beforeEach(() => {
  vi.resetAllMocks();
  resetMutationQueue();
  stockService.listStock.mockResolvedValue([]);
  useTerminalSessionStore.getState().clear();
});

describe("posTerminal draft lifecycle", () => {
  it("creates a draft when none is stored and persists its id", async () => {
    const store = createTestStore();
    salesService.createSale.mockResolvedValue({ id: "sale-new", branch_id: "branch-main", status: "DRAFT" });

    await store.dispatch(ensureDraftSale({ branchId: "branch-main" }));

    expect(salesService.getSale).not.toHaveBeenCalled();
    expect(salesService.createSale).toHaveBeenCalledWith({ branch_id: "branch-main" });
    expect(store.getState().posTerminal.status).toBe("ready");
    expect(store.getState().posTerminal.draftSale.lines).toEqual([]);
    expect(useTerminalSessionStore.getState().draftSaleId).toBe("sale-new");
  });

  it("resumes the stored draft when it is still a DRAFT on this branch", async () => {
    const sale = draftSale({ lines: [saleLine()] });
    useTerminalSessionStore.getState().setDraftSaleId(sale.id);
    salesService.getSale.mockResolvedValue(sale);
    const store = createTestStore();

    await store.dispatch(ensureDraftSale({ branchId: sale.branch_id }));

    expect(salesService.getSale).toHaveBeenCalledWith(sale.id);
    expect(salesService.createSale).not.toHaveBeenCalled();
    expect(store.getState().posTerminal.draftSale).toEqual(sale);
  });

  it.each([
    ["was deleted (404)", () => Promise.reject(httpError(404))],
    ["is no longer a DRAFT", () => Promise.resolve(draftSale({ status: "COMPLETED" }))],
  ])("creates a fresh draft when the stored one %s", async (_, getSale) => {
    useTerminalSessionStore.getState().setDraftSaleId("sale-old");
    salesService.getSale.mockImplementation(getSale);
    salesService.createSale.mockResolvedValue({ id: "sale-new", branch_id: "branch-main", status: "DRAFT" });
    const store = createTestStore();

    await store.dispatch(ensureDraftSale({ branchId: "branch-main" }));

    expect(salesService.createSale).toHaveBeenCalledTimes(1);
    expect(store.getState().posTerminal.draftSaleId).toBe("sale-new");
    expect(useTerminalSessionStore.getState().draftSaleId).toBe("sale-new");
  });

  it("does not start a second draft when resuming fails on a network error", async () => {
    useTerminalSessionStore.getState().setDraftSaleId("sale-old");
    salesService.getSale.mockRejectedValue(new Error("Network Error"));
    const store = createTestStore();

    await store.dispatch(ensureDraftSale({ branchId: "branch-main" }));

    expect(salesService.createSale).not.toHaveBeenCalled();
    expect(store.getState().posTerminal.status).toBe("error");
    expect(useTerminalSessionStore.getState().draftSaleId).toBe("sale-old");
  });

  it("discards the current draft and opens a fresh one", async () => {
    const { store, ready } = readyStore(draftSale({ id: "sale-old" }));
    await ready;
    salesService.discardSale.mockResolvedValue();
    salesService.createSale.mockResolvedValue({ id: "sale-new", branch_id: "branch-main", status: "DRAFT" });

    await store.dispatch(discardDraftSale({ branchId: "branch-main" }));

    expect(salesService.discardSale).toHaveBeenCalledWith("sale-old");
    expect(store.getState().posTerminal.draftSaleId).toBe("sale-new");
    expect(useTerminalSessionStore.getState().draftSaleId).toBe("sale-new");
  });

  it("keeps the current draft when the discard request fails", async () => {
    const { store, ready } = readyStore(draftSale({ id: "sale-old" }));
    await ready;
    salesService.discardSale.mockRejectedValue(new Error("Network Error"));

    const result = await store.dispatch(discardDraftSale({ branchId: "branch-main" }));

    expect(result.payload.stage).toBe("discard");
    expect(salesService.createSale).toHaveBeenCalledTimes(1); // the initial create only
    expect(store.getState().posTerminal.status).toBe("ready");
    expect(store.getState().posTerminal.draftSaleId).toBe("sale-old");
  });
});

describe("posTerminal line mutations", () => {
  it("shows a pending row immediately, then replaces it with the server sale", async () => {
    const { store, ready } = readyStore();
    await ready;
    const request = deferred();
    salesService.addSaleLine.mockReturnValue(request.promise);

    const pending = store.dispatch(addLine({ product: cableProduct }));

    let lines = selectCartLines(store.getState());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      pending: true,
      product_name_snapshot: cableProduct.name,
      unit_price: cableProduct.selling_price,
    });

    request.resolve(draftSale({ lines: [saleLine()] }));
    await pending;

    lines = selectCartLines(store.getState());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: "line-1", pending: false });
    expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", {
      product_id: cableProduct.id,
      quantity: 1,
    });
  });

  it("rolls back the pending row and reports the error when addLine fails", async () => {
    const { store, ready } = readyStore();
    await ready;
    salesService.addSaleLine.mockRejectedValue(httpError(400, "Product is not active"));

    await store.dispatch(addLine({ product: cableProduct }));

    expect(selectCartLines(store.getState())).toEqual([]);
    expect(store.getState().posTerminal.lineError.message).toBe("Product is not active");
    expect(store.getState().posTerminal.status).toBe("ready");
  });

  it("sends the IMEI for serialized products", async () => {
    const { store, ready } = readyStore();
    await ready;
    salesService.addSaleLine.mockResolvedValue(draftSale());

    await store.dispatch(addLine({ product: { id: "p-phone", name: "iPhone" }, imei: "354789102345678" }));

    expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-1", {
      product_id: "p-phone",
      quantity: 1,
      imei_snapshot: "354789102345678",
    });
  });

  it("marks the sale gone when it was completed elsewhere", async () => {
    const { store, ready } = readyStore();
    await ready;
    salesService.addSaleLine.mockRejectedValue(
      httpError(400, "Cannot add a line to a COMPLETED sale. Only DRAFT sales are mutable."),
    );

    await store.dispatch(addLine({ product: cableProduct }));

    expect(store.getState().posTerminal.status).toBe("gone");
    expect(useTerminalSessionStore.getState().draftSaleId).toBeNull();
  });

  it("updates a line's quantity from the server response", async () => {
    const { store, ready } = readyStore(draftSale({ lines: [saleLine()] }));
    await ready;
    salesService.updateSaleLine.mockResolvedValue(draftSale({ lines: [saleLine({ quantity: 3 })] }));

    await store.dispatch(updateLineQty({ lineId: "line-1", quantity: 3 }));

    expect(salesService.updateSaleLine).toHaveBeenCalledWith("sale-1", "line-1", { quantity: 3 });
    expect(selectCartLines(store.getState())[0].quantity).toBe(3);
  });

  it("removes a line and re-fetches the sale", async () => {
    const { store, ready } = readyStore(draftSale({ lines: [saleLine()] }));
    await ready;
    salesService.removeSaleLine.mockResolvedValue();
    salesService.getSale.mockResolvedValue(draftSale());

    await store.dispatch(removeLine({ lineId: "line-1" }));

    expect(salesService.removeSaleLine).toHaveBeenCalledWith("sale-1", "line-1");
    expect(selectCartLines(store.getState())).toEqual([]);
  });
});

describe("posTerminal stock refresh", () => {
  it("fetches branch stock for the product after each successful add", async () => {
    const { store, ready } = readyStore();
    await ready;
    stockService.listStock.mockResolvedValue([{ quantity: 0, manage_stock: true }]);
    salesService.addSaleLine.mockResolvedValue(draftSale({ lines: [saleLine()] }));

    await store.dispatch(addLine({ product: cableProduct }));

    await vi.waitFor(() =>
      expect(store.getState().posTerminal.stockByProduct[cableProduct.id]).toEqual({ quantity: 0, manage_stock: true }),
    );
    expect(stockService.listStock).toHaveBeenCalledWith({ productId: cableProduct.id, branchId: "branch-main" });
    expect(selectStockWarnings(store.getState())).toEqual({ "line-1": { available: 0, required: 1 } });
  });

  it("loads stock for a resumed draft with one branch-wide request", async () => {
    const sale = draftSale({
      lines: [saleLine(), saleLine({ id: "line-2", line_number: 2 }), saleLine({ id: "line-3", product_id: "p-other" })],
    });
    useTerminalSessionStore.getState().setDraftSaleId(sale.id);
    salesService.getSale.mockResolvedValue(sale);
    stockService.listStock.mockResolvedValue([
      { product_id: cableProduct.id, quantity: 1, manage_stock: true },
      { product_id: "p-other", quantity: 9, manage_stock: true },
      { product_id: "p-not-in-cart", quantity: 4, manage_stock: true },
    ]);
    const store = createTestStore();

    await store.dispatch(ensureDraftSale({ branchId: "branch-main" }));

    await vi.waitFor(() => expect(Object.keys(store.getState().posTerminal.stockByProduct)).toHaveLength(2));
    expect(stockService.listStock).toHaveBeenCalledTimes(1);
    expect(stockService.listStock).toHaveBeenCalledWith({ branchId: "branch-main" });
    // cable: 2 lines × 1 = 2 needed, 1 in stock → both cable lines warn
    expect(Object.keys(selectStockWarnings(store.getState()))).toEqual(["line-1", "line-2"]);
  });

  it("records a failed lookup and clears it when a later lookup succeeds", async () => {
    const { store, ready } = readyStore();
    await ready;
    salesService.addSaleLine.mockResolvedValue(draftSale({ lines: [saleLine()] }));
    stockService.listStock.mockRejectedValueOnce(Object.assign(new Error("Too Many Requests"), { response: { status: 429, data: {} } }));

    await store.dispatch(addLine({ product: cableProduct }));
    await vi.waitFor(() => expect(store.getState().posTerminal.stockErrors).toEqual({ [cableProduct.id]: true }));

    stockService.listStock.mockResolvedValue([{ quantity: 5, manage_stock: true }]);
    await store.dispatch(addLine({ product: cableProduct }));
    await vi.waitFor(() => expect(store.getState().posTerminal.stockErrors).toEqual({}));
  });
});


describe("posTerminal customer", () => {
  it("attaches a customer optimistically, then settles on the server sale", async () => {
    const { store, ready } = readyStore();
    await ready;
    const request = deferred();
    salesService.updateSale.mockReturnValue(request.promise);

    const pending = store.dispatch(attachCustomer({ customer: customer() }));

    expect(selectAttachedCustomer(store.getState())).toEqual(customer());
    expect(store.getState().posTerminal.customerSaving).toBe(true);

    request.resolve(draftSale({ customer_id: "cust-1", customer: customer() }));
    await pending;

    expect(salesService.updateSale).toHaveBeenCalledWith("sale-1", { customer_id: "cust-1" });
    expect(selectAttachedCustomer(store.getState())).toEqual(customer());
    expect(store.getState().posTerminal.customerSaving).toBe(false);
  });

  it("rolls the card back and reports the error when the attach fails", async () => {
    const { store, ready } = readyStore();
    await ready;
    salesService.updateSale.mockRejectedValue(httpError(400, "customer_id cust-1 refers to a deleted customer"));

    await store.dispatch(attachCustomer({ customer: customer() }));

    expect(selectAttachedCustomer(store.getState())).toBeNull();
    expect(store.getState().posTerminal.customerError.message).toMatch(/deleted customer/);
    expect(store.getState().posTerminal.customerSaving).toBe(false);
  });

  it("detaches the customer with customer_id: null", async () => {
    const { store, ready } = readyStore(draftSale({ customer_id: "cust-1", customer: customer() }));
    await ready;
    salesService.updateSale.mockResolvedValue(draftSale());

    await store.dispatch(detachCustomer());

    expect(salesService.updateSale).toHaveBeenCalledWith("sale-1", { customer_id: null });
    expect(selectAttachedCustomer(store.getState())).toBeNull();
  });

  it("refuses to detach while the sale has a TRADE_IN payment", async () => {
    const { store, ready } = readyStore(
      draftSale({ customer_id: "cust-1", customer: customer(), payments: [tradeInPayment()] }),
    );
    await ready;

    await store.dispatch(detachCustomer());

    expect(selectHasTradeInPayment(store.getState())).toBe(true);
    expect(salesService.updateSale).not.toHaveBeenCalled();
    expect(selectAttachedCustomer(store.getState())).toEqual(customer());
  });

  it("refuses to detach while a TRADE_IN payment is still pending (P4-11)", async () => {
    const { store, ready } = readyStore(
      draftSale({ lines: [saleLine()], total: "50000.00", customer_id: "cust-1", customer: customer() }),
    );
    await ready;
    const request = deferred();
    salesService.addSalePayment.mockReturnValue(request.promise);

    const paying = store.dispatch(addPayment({
      payment_method: "TRADE_IN",
      amount: 40000,
      trade_in_product_id: "p-phone",
      trade_in_imei: "354789102345678",
      trade_in_buying_price: 40000,
    }));
    await store.dispatch(detachCustomer());

    expect(selectHasTradeInPayment(store.getState())).toBe(true);
    expect(salesService.updateSale).not.toHaveBeenCalled();
    expect(selectAttachedCustomer(store.getState())).toEqual(customer());

    // Settle it: the mutation queue is shared across tests.
    request.reject(httpError(500));
    await paying;
  });

  it("saves the attached customer's NIC (P4-13) and updates the card's customer", async () => {
    const { store, ready } = readyStore(draftSale({ customer_id: "cust-1", customer: customer({ nic: null }) }));
    await ready;
    customersService.updateCustomer.mockResolvedValue(customer({ nic: "199012345678" }));

    await store.dispatch(saveCustomerNic({ nic: "199012345678" })).unwrap();

    expect(customersService.updateCustomer).toHaveBeenCalledWith("cust-1", { nic: "199012345678" });
    expect(selectAttachedCustomer(store.getState())).toEqual(customer({ nic: "199012345678" }));
    expect(store.getState().posTerminal.customerError).toBeNull();
  });

  it("rejects an NIC clash with the other customer's id, leaving the customer unchanged", async () => {
    const { store, ready } = readyStore(draftSale({ customer_id: "cust-1", customer: customer({ nic: null }) }));
    await ready;
    customersService.updateCustomer.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        response: { status: 409, data: { message: "A customer with NIC X already exists", existing_customer_id: "cust-2" } },
      }),
    );

    const result = await store.dispatch(saveCustomerNic({ nic: "199012345678" }));

    expect(result.payload).toMatchObject({ status: 409, existing_customer_id: "cust-2" });
    expect(selectAttachedCustomer(store.getState()).nic).toBeNull();
    expect(store.getState().posTerminal.customerError).toBeNull();
  });

  it("creates a customer, then attaches it to the sale", async () => {
    const { store, ready } = readyStore();
    await ready;
    const created = customer({ id: "cust-new", nic: null });
    customersService.createCustomer.mockResolvedValue(created);
    salesService.updateSale.mockResolvedValue(draftSale({ customer_id: "cust-new", customer: created }));

    const result = await store.dispatch(
      createAndAttachCustomer({ name: "Kamal Perera", phone: "0771234567" }),
    );

    expect(result.error).toBeUndefined();
    expect(customersService.createCustomer).toHaveBeenCalledWith({ name: "Kamal Perera", phone: "0771234567" });
    expect(salesService.updateSale).toHaveBeenCalledWith("sale-1", { customer_id: "cust-new" });
    expect(selectAttachedCustomer(store.getState())).toEqual(created);
    expect(store.getState().posTerminal.customerSaving).toBe(false);
  });

  it("rejects a NIC clash with the existing customer and attaches nothing", async () => {
    const { store, ready } = readyStore();
    await ready;
    customersService.createCustomer.mockRejectedValue(
      Object.assign(new Error("Conflict"), {
        response: {
          status: 409,
          data: { message: "A customer with NIC 199012345678 already exists", existing_customer_id: "cust-1" },
        },
      }),
    );
    customersService.getCustomer.mockResolvedValue(customer());

    const result = await store.dispatch(
      createAndAttachCustomer({ name: "K Perera", phone: "0771234567", nic: "199012345678" }),
    );

    expect(result.payload).toMatchObject({
      stage: "create",
      status: 409,
      existing_customer_id: "cust-1",
      existing_customer: customer(),
    });
    expect(customersService.getCustomer).toHaveBeenCalledWith("cust-1");
    expect(salesService.updateSale).not.toHaveBeenCalled();
    expect(selectAttachedCustomer(store.getState())).toBeNull();
  });

  it("returns the created customer when only the attach step fails", async () => {
    const { store, ready } = readyStore();
    await ready;
    const created = customer({ id: "cust-new" });
    customersService.createCustomer.mockResolvedValue(created);
    salesService.updateSale.mockRejectedValue(new Error("Network Error"));

    const result = await store.dispatch(
      createAndAttachCustomer({ name: "Kamal Perera", phone: "0771234567" }),
    );

    expect(result.payload).toMatchObject({ stage: "attach", customer: created });
    expect(selectAttachedCustomer(store.getState())).toBeNull();
    expect(store.getState().posTerminal.customerError.message).toBe("Network Error");
  });

  it("keeps the optimistic customer when an earlier line response lands first", async () => {
    const { store, ready } = readyStore();
    await ready;
    const add = deferred();
    const patch = deferred();
    salesService.addSaleLine.mockReturnValue(add.promise);
    salesService.updateSale.mockReturnValue(patch.promise);

    const adding = store.dispatch(addLine({ product: cableProduct }));
    const attaching = store.dispatch(attachCustomer({ customer: customer() }));
    add.resolve(draftSale({ lines: [saleLine()] })); // still customer: null
    await adding;

    expect(selectAttachedCustomer(store.getState())).toEqual(customer());
    expect(selectCartLines(store.getState())).toHaveLength(1);

    patch.resolve(draftSale({ lines: [saleLine()], customer_id: "cust-1", customer: customer() }));
    await attaching;
    expect(selectAttachedCustomer(store.getState())).toEqual(customer());
  });
});

describe("posTerminal payments", () => {
  const cartSale = (overrides = {}) =>
    draftSale({ lines: [saleLine()], subtotal: "1500.00", total: "1500.00", ...overrides });

  it("shows a pending payment at once, then settles on the server sale", async () => {
    const { store, ready } = readyStore(cartSale());
    await ready;
    const request = deferred();
    salesService.addSalePayment.mockReturnValue(request.promise);
    const body = { payment_method: "CASH", amount: 1500, cash_received: 2000 };

    const paying = store.dispatch(addPayment(body));

    expect(selectPayments(store.getState())).toEqual([
      expect.objectContaining({
        pending: true,
        payment_method: "CASH",
        amount: "1500.00",
        cash_received: "2000.00",
      }),
    ]);
    expect(selectCartSyncing(store.getState())).toBe(true);
    // Totals stay server-only while the payment is in flight
    expect(selectPaidTotal(store.getState())).toBe("0.00");

    request.resolve(cartSale({ amount_paid: "1500.00", change_due: "500.00", payments: [cashPayment()] }));
    await paying;

    expect(salesService.addSalePayment).toHaveBeenCalledWith("sale-1", body);
    expect(selectPayments(store.getState())).toEqual([
      expect.objectContaining({ id: "pay-cash", pending: false }),
    ]);
    expect(selectPaidTotal(store.getState())).toBe("1500.00");
    expect(selectBalanceDue(store.getState())).toBe("0.00");
    expect(selectCartSyncing(store.getState())).toBe(false);
  });

  it("shows a pending trade-in with its trade_in_* fields and product name, without sending the product row", async () => {
    const { store, ready } = readyStore(cartSale({ total: "50000.00", customer_id: "cust-1", customer: customer() }));
    await ready;
    const request = deferred();
    salesService.addSalePayment.mockReturnValue(request.promise);
    const body = {
      payment_method: "TRADE_IN",
      amount: 40000,
      trade_in_product_id: "p-used-ip12",
      trade_in_imei: "354789102345678",
      trade_in_buying_price: 40000,
      trade_in_selling_price: 55000.5,
      trade_in_notes: "Battery 89%",
    };
    const product = { id: "p-used-ip12", name: "Used iPhone 12 128GB", is_serialized: true };

    const paying = store.dispatch(addPayment({ ...body, trade_in_product: product }));

    expect(selectPayments(store.getState())).toEqual([
      {
        id: expect.stringMatching(/^pending-/),
        pending: true,
        payment_method: "TRADE_IN",
        amount: "40000.00",
        cash_received: null,
        reference_number: null,
        trade_in_product_id: "p-used-ip12",
        trade_in_product: { id: "p-used-ip12", name: "Used iPhone 12 128GB" },
        trade_in_imei: "354789102345678",
        trade_in_buying_price: "40000.00",
        trade_in_selling_price: "55000.50",
        trade_in_notes: "Battery 89%",
      },
    ]);

    request.resolve(cartSale({ total: "50000.00", amount_paid: "40000.00", payments: [tradeInPayment()] }));
    await paying;

    expect(salesService.addSalePayment).toHaveBeenCalledWith("sale-1", body);
    expect(selectPayments(store.getState())).toEqual([
      expect.objectContaining({ id: "pay-ti", pending: false }),
    ]);
  });

  it("gives a pending trade-in null optionals when the resale price, notes and product are left out", async () => {
    const { store, ready } = readyStore(cartSale({ total: "50000.00" }));
    await ready;
    const request = deferred();
    salesService.addSalePayment.mockReturnValue(request.promise);

    const paying = store.dispatch(addPayment({
      payment_method: "TRADE_IN",
      amount: 40000,
      trade_in_product_id: "p-phone",
      trade_in_imei: "354789102345678",
      trade_in_buying_price: 40000,
    }));

    expect(selectPayments(store.getState())[0]).toMatchObject({
      trade_in_product: null,
      trade_in_selling_price: null,
      trade_in_notes: null,
    });

    request.reject(httpError(500));
    await paying;
  });

  it("keeps trade-in fields off pending rows for other methods", async () => {
    const { store, ready } = readyStore(cartSale());
    await ready;
    const request = deferred();
    salesService.addSalePayment.mockReturnValue(request.promise);

    const paying = store.dispatch(
      addPayment({ payment_method: "CARD", amount: 500, reference_number: "AUTH-1" }),
    );

    expect(Object.keys(selectPayments(store.getState())[0])).not.toContain("trade_in_imei");

    request.reject(httpError(500));
    await paying;
  });

  it("drops the pending row and keeps the error on the slice when the payment fails", async () => {
    const { store, ready } = readyStore(cartSale());
    await ready;
    salesService.addSalePayment.mockRejectedValue(
      httpError(400, "reference_number is required for CARD payments"),
    );

    const result = await store.dispatch(addPayment({ payment_method: "CARD", amount: 500 }));

    expect(result.payload.message).toBe("reference_number is required for CARD payments");
    expect(selectPayments(store.getState())).toEqual([]);
    expect(store.getState().posTerminal.paymentError.message).toBe(
      "reference_number is required for CARD payments",
    );
    expect(store.getState().posTerminal.lineError).toBeNull();
    expect(store.getState().posTerminal.draftSale).toEqual(cartSale());
  });

  it("marks the sale gone when a payment lands on a completed sale", async () => {
    const { store, ready } = readyStore(cartSale());
    await ready;
    salesService.addSalePayment.mockRejectedValue(
      httpError(400, "Cannot add a payment to a COMPLETED sale. Only DRAFT sales are mutable."),
    );

    await store.dispatch(addPayment({ payment_method: "CASH", amount: 1500, cash_received: 1500 }));

    expect(store.getState().posTerminal.status).toBe("gone");
    expect(useTerminalSessionStore.getState().draftSaleId).toBeNull();
  });

  it("hides a removed payment at once, then re-fetches the sale", async () => {
    const paid = cartSale({ amount_paid: "1000.00", payments: [cardPayment()] });
    const { store, ready } = readyStore(paid);
    await ready;
    const request = deferred();
    salesService.removeSalePayment.mockReturnValue(request.promise);
    salesService.getSale.mockResolvedValue(cartSale());

    const removing = store.dispatch(removePayment({ paymentId: "pay-card" }));

    expect(selectPayments(store.getState())).toEqual([]);
    expect(selectPaidTotal(store.getState())).toBe("1000.00"); // server figure until it answers

    request.resolve();
    await removing;

    expect(salesService.removeSalePayment).toHaveBeenCalledWith("sale-1", "pay-card");
    expect(salesService.getSale).toHaveBeenCalledWith("sale-1");
    expect(selectPayments(store.getState())).toEqual([]);
    expect(selectBalanceDue(store.getState())).toBe("1500.00");
  });

  it("restores the payment and reports the error when the removal fails", async () => {
    const paid = cartSale({ amount_paid: "1000.00", payments: [cardPayment()] });
    const { store, ready } = readyStore(paid);
    await ready;
    salesService.removeSalePayment.mockRejectedValue(new Error("Network Error"));

    await store.dispatch(removePayment({ paymentId: "pay-card" }));

    expect(selectPayments(store.getState())).toEqual([
      expect.objectContaining({ id: "pay-card", pending: false }),
    ]);
    expect(store.getState().posTerminal.paymentError.message).toBe("Network Error");
  });

  it("waits for an in-flight line edit before sending a payment", async () => {
    const { store, ready } = readyStore(cartSale());
    await ready;
    const lineEdit = deferred();
    salesService.updateSaleLine.mockReturnValue(lineEdit.promise);
    const twoCables = cartSale({
      lines: [saleLine({ quantity: 2, line_total: "3000.00" })],
      subtotal: "3000.00",
      total: "3000.00",
    });
    salesService.addSalePayment.mockResolvedValue({
      ...twoCables,
      amount_paid: "3000.00",
      payments: [cashPayment({ amount: "3000.00", cash_received: "3000.00" })],
    });

    const editing = store.dispatch(updateLineQty({ lineId: "line-1", quantity: 2 }));
    const paying = store.dispatch(
      addPayment({ payment_method: "CASH", amount: 3000, cash_received: 3000 }),
    );
    // Let every pending microtask run: an unqueued call would have fired by now
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(salesService.updateSaleLine).toHaveBeenCalledTimes(1);
    expect(salesService.addSalePayment).not.toHaveBeenCalled();

    lineEdit.resolve(twoCables);
    await editing;
    await paying;

    expect(salesService.addSalePayment).toHaveBeenCalledTimes(1);
    expect(selectPaidTotal(store.getState())).toBe("3000.00");
    expect(selectIsFullyPaid(store.getState())).toBe(true);
  });

  it("keeps a payment hidden when an older line response still lists it", async () => {
    const paid = cartSale({ amount_paid: "1000.00", payments: [cardPayment()] });
    const { store, ready } = readyStore(paid);
    await ready;
    const lineEdit = deferred();
    const deletion = deferred();
    salesService.updateSaleLine.mockReturnValue(lineEdit.promise);
    salesService.removeSalePayment.mockReturnValue(deletion.promise);
    salesService.getSale.mockResolvedValue(cartSale({ lines: [saleLine({ quantity: 2 })] }));

    const editing = store.dispatch(updateLineQty({ lineId: "line-1", quantity: 2 }));
    const removing = store.dispatch(removePayment({ paymentId: "pay-card" }));
    lineEdit.resolve({ ...paid, lines: [saleLine({ quantity: 2 })] }); // still has pay-card
    await editing;

    expect(selectPayments(store.getState())).toEqual([]);

    deletion.resolve();
    await removing;
    expect(selectPayments(store.getState())).toEqual([]);
  });
});

describe("posTerminal payment selectors", () => {
  const stateWith = (draftSale) => ({
    posTerminal: { draftSale, pendingPayments: [], removingPaymentIds: [] },
  });

  it("subtracts in cents, so decimal partial payments leave an exact balance", () => {
    const state = stateWith(
      draftSale({ lines: [saleLine()], total: "100.30", amount_paid: "50.10" }),
    );

    expect(selectPaidTotal(state)).toBe("50.10");
    expect(selectBalanceDue(state)).toBe("50.20");
    expect(selectIsFullyPaid(state)).toBe(false);
  });

  it.each([
    ["is fully paid when the balance is zero", { lines: [saleLine()], total: "1500.00", amount_paid: "1500.00" }, true],
    ["is not fully paid with an empty cart", { lines: [], total: "0.00", amount_paid: "0.00" }, false],
    ["is not fully paid with a balance left", { lines: [saleLine()], total: "1500.00", amount_paid: "0.00" }, false],
  ])("%s", (_, sale, expected) => {
    expect(selectIsFullyPaid(stateWith(draftSale(sale)))).toBe(expected);
  });

  it("reports zero paid and zero balance before a sale is loaded", () => {
    const state = stateWith(null);

    expect(selectPaidTotal(state)).toBe("0.00");
    expect(selectBalanceDue(state)).toBe("0.00");
    expect(selectPayments(state)).toEqual([]);
    expect(selectHasTradeInPayment(state)).toBe(false);
    expect(selectTradeInImeis(state)).toEqual([]);
  });

  it("counts recorded and pending trade-ins, and lists their IMEIs minus one being removed", () => {
    const pending = tradeInPayment({ id: "pending-1", trade_in_imei: "AB12345678" });
    const state = {
      posTerminal: {
        draftSale: draftSale({
          payments: [
            cashPayment(),
            tradeInPayment(),
            tradeInPayment({ id: "pay-ti-2", trade_in_imei: "354789102345679" }),
          ],
        }),
        pendingPayments: [pending],
        removingPaymentIds: ["pay-ti-2"],
      },
    };

    expect(selectHasTradeInPayment(state)).toBe(true);
    expect(selectTradeInImeis(state)).toEqual(["354789102345678", "AB12345678"]);
  });

  it.each([
    ["only a pending trade-in", [], [tradeInPayment({ id: "pending-1" })], true],
    ["only non-trade-in tenders", [cashPayment(), cardPayment()], [], false],
  ])("selectHasTradeInPayment with %s", (_, payments, pendingPayments, expected) => {
    const state = {
      posTerminal: { draftSale: draftSale({ payments }), pendingPayments, removingPaymentIds: [] },
    };

    expect(selectHasTradeInPayment(state)).toBe(expected);
  });
});
