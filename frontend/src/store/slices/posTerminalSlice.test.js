import { vi } from "vitest";
import { createTestStore, posTerminalState } from "../../test/renderWithProviders";
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
  clearCompleteError,
  clearPosTerminal,
  completeSale,
  createAndAttachCustomer,
  detachCustomer,
  discardDraftSale,
  ensureDraftSale,
  refreshCartStock,
  reloadDraftSale,
  removeLine,
  removePayment,
  resetMutationQueue,
  saveCustomerNic,
  selectAttachedCustomer,
  selectBalanceDue,
  selectCanComplete,
  selectCanPay,
  selectCartLines,
  selectCartSyncing,
  selectCompleteError,
  selectCompleteIssue,
  selectHasTradeInPayment,
  selectIsCompleting,
  selectLastCompletedSale,
  selectNextDraft,
  startNextSale,
  selectIsFullyPaid,
  selectPaidTotal,
  selectPayments,
  selectStockShortfall,
  selectStockWarnings,
  selectTradeInImeis,
  updateLineDiscount,
  updateLineQty,
  updateLineWarranty,
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

  it.each(["completing", "completed"])(
    "does nothing while the sale is %s: the terminal remounting keeps the Sale complete panel (P6-1)",
    async (status) => {
      useTerminalSessionStore.getState().setDraftSaleId("sale-1");
      const store = createTestStore({ posTerminal: posTerminalState({ status }) });

      await store.dispatch(ensureDraftSale({ branchId: "branch-main" }));

      expect(salesService.getSale).not.toHaveBeenCalled();
      expect(salesService.createSale).not.toHaveBeenCalled();
      expect(store.getState().posTerminal.status).toBe(status);
    },
  );

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

  it("a pending row shows the warranty the line will start on (P5-18)", async () => {
    const { store, ready } = readyStore();
    await ready;
    salesService.addSaleLine.mockReturnValue(new Promise(() => {}));

    store.dispatch(addLine({ product: { ...cableProduct, default_warranty: "MONTH_6" } }));
    store.dispatch(addLine({ product: cableProduct })); // no default on the row → No warranty (P5-19)

    const pending = selectCartLines(store.getState()).filter((l) => l.pending);
    expect(pending.map((l) => l.warranty)).toEqual(["MONTH_6", "NO_WARRANTY"]);
  });

  it("changes a line's warranty through the queue, the row busy until it lands (P5-18)", async () => {
    const { store, ready } = readyStore(draftSale({ lines: [saleLine({ warranty: "CHECKING" })] }));
    await ready;
    const request = deferred();
    salesService.updateSaleLine.mockReturnValue(request.promise);

    const changing = store.dispatch(updateLineWarranty({ lineId: "line-1", warranty: "MONTH_12" }));

    expect(selectCartLines(store.getState())[0]).toMatchObject({ busy: true, warranty: "CHECKING" });
    request.resolve(draftSale({ lines: [saleLine({ warranty: "MONTH_12" })] }));
    await changing;

    expect(salesService.updateSaleLine).toHaveBeenCalledWith("sale-1", "line-1", { warranty: "MONTH_12" });
    expect(selectCartLines(store.getState())[0]).toMatchObject({ busy: false, warranty: "MONTH_12" });
  });

  it("reports a failed warranty change and frees the row (P5-18)", async () => {
    const { store, ready } = readyStore(draftSale({ lines: [saleLine({ warranty: "CHECKING" })] }));
    await ready;
    salesService.updateSaleLine.mockRejectedValue(httpError(400, "warranty must be one of the following values"));

    await store.dispatch(updateLineWarranty({ lineId: "line-1", warranty: "MONTH_12" }));

    expect(store.getState().posTerminal.lineError.message).toMatch(/warranty must be one of/);
    expect(selectCartLines(store.getState())[0]).toMatchObject({ busy: false, warranty: "CHECKING" });
    expect(store.getState().posTerminal.status).toBe("ready");
  });

  it("sets a line's discount through the queue, the row busy until it lands (P5-20)", async () => {
    const { store, ready } = readyStore(draftSale({ lines: [saleLine()] }));
    await ready;
    const request = deferred();
    salesService.updateSaleLine.mockReturnValue(request.promise);
    const discounted = saleLine({
      discount_type: "UNIT_PRICE",
      discount_value: "1200.00",
      discount_amount: "300.00",
      line_total: "1200.00",
    });

    const setting = store.dispatch(
      updateLineDiscount({ lineId: "line-1", discount_type: "UNIT_PRICE", discount_value: 1200 }),
    );

    expect(selectCartLines(store.getState())[0]).toMatchObject({ busy: true, discount_type: null });
    request.resolve(draftSale({ lines: [discounted] }));
    await setting;

    expect(salesService.updateSaleLine).toHaveBeenCalledWith("sale-1", "line-1", {
      discount_type: "UNIT_PRICE",
      discount_value: 1200,
    });
    expect(selectCartLines(store.getState())[0]).toMatchObject({ busy: false, line_total: "1200.00" });
  });

  it("removes a discount with both fields null (P5-20)", async () => {
    const { store, ready } = readyStore(draftSale({ lines: [saleLine({ discount_type: "PERCENT" })] }));
    await ready;
    salesService.updateSaleLine.mockResolvedValue(draftSale({ lines: [saleLine()] }));

    await store.dispatch(updateLineDiscount({ lineId: "line-1", discount_type: null, discount_value: null }));

    expect(salesService.updateSaleLine).toHaveBeenCalledWith("sale-1", "line-1", {
      discount_type: null,
      discount_value: null,
    });
  });

  it("leaves a failed discount to the dialog: no lineError, row freed (P5-20)", async () => {
    const { store, ready } = readyStore(draftSale({ lines: [saleLine()] }));
    await ready;
    const message =
      "Cannot reduce the sale total below the amount already paid. Remove or reduce payments first.";
    salesService.updateSaleLine.mockRejectedValue(httpError(400, message));

    const result = await store.dispatch(
      updateLineDiscount({ lineId: "line-1", discount_type: "PERCENT", discount_value: 50 }),
    );

    expect(result.payload.message).toBe(message);
    expect(store.getState().posTerminal.lineError).toBeNull();
    expect(selectCartLines(store.getState())[0].busy).toBe(false);
    expect(store.getState().posTerminal.status).toBe("ready");
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

describe("posTerminal complete (P5)", () => {
  const paidSale = (overrides = {}) =>
    draftSale({
      lines: [saleLine()],
      subtotal: "1500.00",
      total: "1500.00",
      amount_paid: "1500.00",
      change_due: "500.00",
      payments: [cashPayment()],
      ...overrides,
    });
  const completedSale = (overrides = {}) =>
    paidSale({
      status: "COMPLETED",
      sale_number: "INV-20261020-0001",
      completed_at: "2026-10-20T09:15:00.000Z",
      ...overrides,
    });
  const timeoutError = () =>
    Object.assign(new Error("timeout of 30000ms exceeded"), { code: "ECONNABORTED" });

  const paidStore = async (sale = paidSale()) => {
    const { store, ready } = readyStore(sale);
    await ready;
    return store;
  };

  it("completes: keeps the sale as lastCompletedSale; the pointer moves to the next draft opened in the background", async () => {
    const store = await paidStore();
    salesService.completeSale.mockResolvedValue(completedSale());
    const nextDraft = deferred();
    salesService.createSale.mockReturnValue(nextDraft.promise);

    const result = await store.dispatch(completeSale());

    expect(completeSale.fulfilled.match(result)).toBe(true);
    expect(salesService.completeSale).toHaveBeenCalledWith("sale-1");
    expect(salesService.getSale).not.toHaveBeenCalled();
    let { posTerminal } = store.getState();
    expect(posTerminal.status).toBe("completed");
    expect(posTerminal.draftSale).toBeNull();
    expect(posTerminal.draftSaleId).toBeNull();
    expect(selectNextDraft(store.getState()).status).toBe("creating");
    expect(selectLastCompletedSale(store.getState())).toEqual(completedSale());
    expect(selectCompleteError(store.getState())).toBeNull();
    expect(useTerminalSessionStore.getState().draftSaleId).toBeNull();
    expect(useTerminalSessionStore.getState().lastCompletedSaleId).toBe("sale-1");
    expect(salesService.createSale).toHaveBeenLastCalledWith({ branch_id: "branch-main" });

    nextDraft.resolve(draftSale({ id: "sale-2" }));
    await vi.waitFor(() => expect(selectNextDraft(store.getState()).status).toBe("ready"));

    ({ posTerminal } = store.getState());
    // Still on the panel: the next draft is ready behind it
    expect(posTerminal.status).toBe("completed");
    expect(posTerminal.draftSaleId).toBe("sale-2");
    expect(useTerminalSessionStore.getState().draftSaleId).toBe("sale-2");
    expect(useTerminalSessionStore.getState().lastCompletedSaleId).toBe("sale-1");
  });

  it("is 'completing' while the request is in flight and refuses a second run", async () => {
    const store = await paidStore();
    const request = deferred();
    salesService.completeSale.mockReturnValue(request.promise);

    const first = store.dispatch(completeSale());
    expect(selectIsCompleting(store.getState())).toBe(true);
    expect(selectCanComplete(store.getState())).toBe(false);

    const second = await store.dispatch(completeSale());
    expect(second.meta.condition).toBe(true);

    request.resolve(completedSale());
    await first;

    expect(salesService.completeSale).toHaveBeenCalledTimes(1);
    expect(store.getState().posTerminal.status).toBe("completed");
  });

  it("refuses to run without an open draft", async () => {
    const store = createTestStore();

    const result = await store.dispatch(completeSale());

    expect(result.meta.condition).toBe(true);
    expect(salesService.completeSale).not.toHaveBeenCalled();
  });

  it("waits for a queued cart edit before completing", async () => {
    const store = await paidStore();
    const removal = deferred();
    salesService.removeSalePayment.mockReturnValue(removal.promise);
    salesService.getSale.mockResolvedValue(paidSale());
    salesService.completeSale.mockResolvedValue(completedSale());

    const removing = store.dispatch(removePayment({ paymentId: "pay-cash" }));
    const completing = store.dispatch(completeSale());
    await Promise.resolve();
    expect(salesService.completeSale).not.toHaveBeenCalled();

    removal.resolve();
    await removing;
    await completing;

    expect(salesService.completeSale).toHaveBeenCalledTimes(1);
    expect(salesService.removeSalePayment.mock.invocationCallOrder[0]).toBeLessThan(
      salesService.completeSale.mock.invocationCallOrder[0],
    );
  });

  describe("lost answer: re-fetch the sale (P5-7)", () => {
    it.each([
      ["no response", () => new Error("Network Error")],
      ["a timeout", timeoutError],
      ["a 5xx", () => httpError(500, "Internal server error")],
      [
        "E2 (already completed)",
        () => httpError(400, "Cannot complete a COMPLETED sale. Only DRAFT sales can be completed."),
      ],
    ])("after %s, a COMPLETED sale counts as success", async (_, makeError) => {
      const store = await paidStore();
      salesService.completeSale.mockRejectedValue(makeError());
      salesService.getSale.mockResolvedValue(completedSale());
      salesService.createSale.mockResolvedValue(draftSale({ id: "sale-2" }));

      const result = await store.dispatch(completeSale());

      expect(completeSale.fulfilled.match(result)).toBe(true);
      expect(salesService.getSale).toHaveBeenCalledWith("sale-1");
      expect(store.getState().posTerminal.status).toBe("completed");
      expect(selectLastCompletedSale(store.getState()).sale_number).toBe("INV-20261020-0001");
      await vi.waitFor(() => expect(selectNextDraft(store.getState()).status).toBe("ready"));
      expect(useTerminalSessionStore.getState().draftSaleId).toBe("sale-2");
      expect(useTerminalSessionStore.getState().lastCompletedSaleId).toBe("sale-1");
    });

    it("a sale still in DRAFT is an error the cashier can retry; the draft stays", async () => {
      const store = await paidStore();
      salesService.completeSale.mockRejectedValueOnce(timeoutError());
      salesService.getSale.mockResolvedValue(paidSale());

      const result = await store.dispatch(completeSale());

      expect(completeSale.rejected.match(result)).toBe(true);
      expect(store.getState().posTerminal.status).toBe("ready");
      expect(store.getState().posTerminal.draftSale).not.toBeNull();
      expect(selectCompleteError(store.getState())).toMatchObject({
        kind: "timeout",
        reconcile: true,
      });
      expect(useTerminalSessionStore.getState().draftSaleId).toBe("sale-1");

      // Retry: the same thunk runs again from "ready"
      salesService.completeSale.mockResolvedValueOnce(completedSale());
      await store.dispatch(completeSale());

      expect(salesService.completeSale).toHaveBeenCalledTimes(2);
      expect(store.getState().posTerminal.status).toBe("completed");
      expect(selectCompleteError(store.getState())).toBeNull();
    });

    it.each([
      ["was voided", () => Promise.resolve(completedSale({ status: "VOIDED" }))],
      ["is gone (404)", () => Promise.reject(httpError(404, "Sale not found"))],
    ])("a sale that %s → gone", async (_, getSale) => {
      const store = await paidStore();
      salesService.completeSale.mockRejectedValue(httpError(500, "Internal server error"));
      salesService.getSale.mockImplementation(getSale);

      await store.dispatch(completeSale());

      expect(store.getState().posTerminal.status).toBe("gone");
      expect(store.getState().posTerminal.draftSaleId).toBeNull();
      expect(selectCompleteError(store.getState())).toMatchObject({ kind: "server", gone: true });
      expect(useTerminalSessionStore.getState().draftSaleId).toBeNull();
      expect(useTerminalSessionStore.getState().lastCompletedSaleId).toBeNull();
    });

    it("when the re-fetch fails too, the error is 'unconfirmed' and the draft stays", async () => {
      const store = await paidStore();
      salesService.completeSale.mockRejectedValue(new Error("Network Error"));
      salesService.getSale.mockRejectedValue(new Error("Network Error"));

      await store.dispatch(completeSale());

      expect(store.getState().posTerminal.status).toBe("ready");
      expect(selectCompleteError(store.getState())).toMatchObject({
        kind: "network",
        unconfirmed: true,
      });
      expect(useTerminalSessionStore.getState().draftSaleId).toBe("sale-1");
    });
  });

  describe("definite failures: no re-fetch", () => {
    it("E1: 404 → gone", async () => {
      const store = await paidStore();
      salesService.completeSale.mockRejectedValue(httpError(404, "Sale not found"));

      await store.dispatch(completeSale());

      expect(salesService.getSale).not.toHaveBeenCalled();
      expect(store.getState().posTerminal.status).toBe("gone");
      expect(selectCompleteError(store.getState())).toMatchObject({ kind: "not_found", gone: true });
      expect(useTerminalSessionStore.getState().draftSaleId).toBeNull();
    });

    it("E5: out of stock keeps the draft and carries the line, product and figures", async () => {
      const store = await paidStore();
      salesService.completeSale.mockRejectedValue(
        Object.assign(new Error("Conflict"), {
          response: {
            status: 409,
            data: {
              message: 'Insufficient stock for "USB-C Cable 1m": requested 1, available 0',
              product_id: "p-cable",
              sale_line_id: "line-1",
            },
          },
        }),
      );

      const result = await store.dispatch(completeSale());

      expect(completeSale.rejected.match(result)).toBe(true);
      expect(salesService.getSale).not.toHaveBeenCalled();
      expect(store.getState().posTerminal.status).toBe("ready");
      expect(selectCompleteError(store.getState())).toMatchObject({
        kind: "out_of_stock",
        product_id: "p-cable",
        sale_line_id: "line-1",
        requested: 1,
        available: 0,
      });
      expect(useTerminalSessionStore.getState().draftSaleId).toBe("sale-1");
    });

    it("E6: resolves the line selling the unit that was sold elsewhere", async () => {
      const store = await paidStore(
        paidSale({
          lines: [
            saleLine(),
            saleLine({ id: "line-2", product_unit_id: "unit-7", imei_snapshot: "354789102345678" }),
          ],
        }),
      );
      salesService.completeSale.mockRejectedValue(
        Object.assign(new Error("Conflict"), {
          response: {
            status: 409,
            data: {
              message: "Cannot sell IMEI '354789102345678': status is SOLD, expected IN_STOCK.",
              existing_unit: { id: "unit-7", status: "SOLD" },
            },
          },
        }),
      );

      await store.dispatch(completeSale());

      expect(selectCompleteError(store.getState())).toMatchObject({
        kind: "unit_sold",
        imei: "354789102345678",
        sale_line_id: "line-2",
      });
    });

    it("E10: a trade-in IMEI collision names the payment", async () => {
      const store = await paidStore();
      salesService.completeSale.mockRejectedValue(
        Object.assign(new Error("Conflict"), {
          response: {
            status: 409,
            data: {
              message: "IMEI already exists in inventory",
              imei: "354789102345678",
              payment_id: "pay-ti",
              existing_unit: { id: "unit-9", status: "IN_STOCK" },
            },
          },
        }),
      );

      await store.dispatch(completeSale());

      expect(selectCompleteError(store.getState())).toMatchObject({
        kind: "trade_in_imei_in_stock",
        imei: "354789102345678",
        payment_id: "pay-ti",
      });
      expect(store.getState().posTerminal.status).toBe("ready");
    });

    it("E8: a missing NIC is its own kind; clearCompleteError dismisses it", async () => {
      const store = await paidStore();
      salesService.completeSale.mockRejectedValue(httpError(400, "A trade-in needs the customer's NIC"));

      await store.dispatch(completeSale());
      expect(selectCompleteError(store.getState()).kind).toBe("nic_required");

      store.dispatch(clearCompleteError());
      expect(selectCompleteError(store.getState())).toBeNull();
    });
  });

  describe("sale edits are refused while completing and after (no request, no 'gone')", () => {
    const mutations = [
      ["addLine (a scan)", () => addLine({ product: cableProduct }), () => salesService.addSaleLine],
      ["updateLineQty", () => updateLineQty({ lineId: "line-1", quantity: 2 }), () => salesService.updateSaleLine],
      [
        "updateLineWarranty",
        () => updateLineWarranty({ lineId: "line-1", warranty: "MONTH_12" }),
        () => salesService.updateSaleLine,
      ],
      [
        "updateLineDiscount",
        () => updateLineDiscount({ lineId: "line-1", discount_type: "PERCENT", discount_value: 10 }),
        () => salesService.updateSaleLine,
      ],
      ["removeLine", () => removeLine({ lineId: "line-1" }), () => salesService.removeSaleLine],
      [
        "addPayment",
        () => addPayment({ payment_method: "CASH", amount: 100, cash_received: 100 }),
        () => salesService.addSalePayment,
      ],
      ["removePayment", () => removePayment({ paymentId: "pay-cash" }), () => salesService.removeSalePayment],
      ["attachCustomer", () => attachCustomer({ customer: customer() }), () => salesService.updateSale],
      ["detachCustomer", () => detachCustomer(), () => salesService.updateSale],
      [
        "createAndAttachCustomer",
        () => createAndAttachCustomer({ name: "Nimal", phone: "0771112223" }),
        () => customersService.createCustomer,
      ],
      ["saveCustomerNic", () => saveCustomerNic({ nic: "199012345678" }), () => customersService.updateCustomer],
      ["discardDraftSale", () => discardDraftSale({ branchId: "branch-main" }), () => salesService.discardSale],
    ];

    const expectRefused = async (store, makeAction, request, expectedStatus) => {
      const before = store.getState().posTerminal;

      const result = await store.dispatch(makeAction());

      expect(result.meta.condition).toBe(true);
      expect(request()).not.toHaveBeenCalled();
      const after = store.getState().posTerminal;
      expect(after.status).toBe(expectedStatus);
      expect(after.status).not.toBe("gone");
      expect(after.pendingLines).toEqual(before.pendingLines);
      expect(after.pendingPayments).toEqual(before.pendingPayments);
      expect(after.lineError).toBeNull();
      expect(after.paymentError).toBeNull();
      expect(after.customerError).toBeNull();
    };

    it.each(mutations)("%s while completing", async (_, makeAction, request) => {
      const store = await paidStore(paidSale({ customer: customer() }));
      const completing = deferred();
      salesService.completeSale.mockReturnValue(completing.promise);
      const run = store.dispatch(completeSale());

      await expectRefused(store, makeAction, request, "completing");

      completing.resolve(completedSale());
      await run;
      expect(store.getState().posTerminal.status).toBe("completed");
    });

    it.each(mutations)("%s after completed (before the next draft)", async (_, makeAction, request) => {
      const store = await paidStore(paidSale({ customer: customer() }));
      salesService.completeSale.mockResolvedValue(completedSale());
      await store.dispatch(completeSale());

      await expectRefused(store, makeAction, request, "completed");
      expect(selectLastCompletedSale(store.getState()).id).toBe("sale-1");
    });

    it("edits work again once the next sale starts", async () => {
      const store = await paidStore();
      salesService.completeSale.mockResolvedValue(completedSale());
      salesService.createSale.mockResolvedValue(draftSale({ id: "sale-2" }));
      await store.dispatch(completeSale());
      await expect(store.dispatch(startNextSale())).resolves.toBe(true);
      salesService.addSaleLine.mockResolvedValue(draftSale({ id: "sale-2", lines: [saleLine()] }));

      await store.dispatch(addLine({ product: cableProduct }));

      expect(salesService.addSaleLine).toHaveBeenCalledWith("sale-2", {
        product_id: cableProduct.id,
        quantity: 1,
      });
      expect(store.getState().posTerminal.status).toBe("ready");
    });
  });

  describe("next sale (P5-10)", () => {
    const completedStore = async () => {
      const store = await paidStore();
      salesService.completeSale.mockResolvedValue(completedSale());
      return store;
    };

    it("startNextSale waits for the background draft, then returns to 'ready' on it", async () => {
      const store = await completedStore();
      const nextDraft = deferred();
      salesService.createSale.mockReturnValue(nextDraft.promise);
      await store.dispatch(completeSale());

      const starting = store.dispatch(startNextSale());
      await Promise.resolve();
      expect(store.getState().posTerminal.status).toBe("completed");

      nextDraft.resolve(draftSale({ id: "sale-2" }));
      await expect(starting).resolves.toBe(true);

      const { posTerminal } = store.getState();
      expect(posTerminal.status).toBe("ready");
      expect(posTerminal.draftSaleId).toBe("sale-2");
      expect(selectNextDraft(store.getState()).status).toBe("idle");
      expect(salesService.createSale).toHaveBeenCalledTimes(2); // the first draft, then the next one
      // Still there for "Reprint last receipt"
      expect(selectLastCompletedSale(store.getState()).id).toBe("sale-1");
    });

    it("concurrent starts (a scan and Enter) share one attempt", async () => {
      const store = await completedStore();
      const nextDraft = deferred();
      salesService.createSale.mockReturnValue(nextDraft.promise);
      await store.dispatch(completeSale());

      const a = store.dispatch(startNextSale());
      const b = store.dispatch(startNextSale());
      nextDraft.resolve(draftSale({ id: "sale-2" }));

      await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
      expect(salesService.createSale).toHaveBeenCalledTimes(2);
    });

    it("a failed background create shows on the panel, and starting retries it", async () => {
      const store = await completedStore();
      salesService.createSale.mockRejectedValueOnce(new Error("Network Error"));
      await store.dispatch(completeSale());
      await vi.waitFor(() => expect(selectNextDraft(store.getState()).status).toBe("failed"));
      expect(selectNextDraft(store.getState()).error).toMatchObject({ message: "Network Error" });
      expect(store.getState().posTerminal.status).toBe("completed");

      salesService.createSale.mockResolvedValueOnce(draftSale({ id: "sale-2" }));
      await expect(store.dispatch(startNextSale())).resolves.toBe(true);

      expect(store.getState().posTerminal.status).toBe("ready");
      expect(store.getState().posTerminal.draftSaleId).toBe("sale-2");
    });

    it("if the retry fails too, the panel stays with the error", async () => {
      const store = await completedStore();
      salesService.createSale.mockRejectedValue(httpError(500, "Internal server error"));
      await store.dispatch(completeSale());

      await expect(store.dispatch(startNextSale())).resolves.toBe(false);

      expect(store.getState().posTerminal.status).toBe("completed");
      expect(selectNextDraft(store.getState())).toEqual({
        status: "failed",
        error: expect.objectContaining({ message: "Internal server error" }),
      });
    });

    it("on an open draft startNextSale just says yes, without a request", async () => {
      const store = await paidStore();
      salesService.createSale.mockClear();

      await expect(store.dispatch(startNextSale())).resolves.toBe(true);
      expect(salesService.createSale).not.toHaveBeenCalled();
    });

    it("a next draft that arrives after a logout reset is ignored", async () => {
      const store = await completedStore();
      const nextDraft = deferred();
      salesService.createSale.mockReturnValue(nextDraft.promise);
      await store.dispatch(completeSale());

      store.dispatch(clearPosTerminal());
      nextDraft.resolve(draftSale({ id: "sale-2" }));
      await Promise.resolve();
      await Promise.resolve();

      expect(store.getState().posTerminal.draftSale).toBeNull();
      expect(store.getState().posTerminal.status).toBe("idle");
    });
  });

  describe("complete issues (P5-8)", () => {
    const failWith = async (store, data, status = 409) => {
      salesService.completeSale.mockRejectedValueOnce(
        Object.assign(new Error("failed"), { response: { status, data } }),
      );
      await store.dispatch(completeSale());
    };

    it("out of stock points at the line from sale_line_id", async () => {
      const store = await paidStore(
        paidSale({ lines: [saleLine(), saleLine({ id: "line-2", product_id: "p-glass" })] }),
      );

      await failWith(store, {
        message: 'Insufficient stock for "Tempered Glass": requested 1, available 0',
        product_id: "p-glass",
        sale_line_id: "line-2",
      });

      expect(selectCompleteIssue(store.getState())).toEqual({
        lineIds: ["line-2"],
        paymentIds: [],
        label: "Not enough stock",
      });
    });

    it("out of stock without sale_line_id points at every line of that product", async () => {
      const store = await paidStore(
        paidSale({ lines: [saleLine(), saleLine({ id: "line-2" }), saleLine({ id: "line-3", product_id: "p-glass" })] }),
      );

      await failWith(store, {
        message: 'Insufficient stock for "USB-C Cable 1m": requested 2, available 1',
        product_id: "p-cable",
      });

      expect(selectCompleteIssue(store.getState()).lineIds).toEqual(["line-1", "line-2"]);
    });

    it("a phone sold elsewhere points at the line selling it", async () => {
      const store = await paidStore(
        paidSale({ lines: [saleLine(), saleLine({ id: "line-2", product_unit_id: "unit-7", imei_snapshot: "354789102345678" })] }),
      );

      await failWith(store, {
        message: "Cannot sell IMEI '354789102345678': status is SOLD, expected IN_STOCK.",
        existing_unit: { id: "unit-7", status: "SOLD" },
      });

      expect(selectCompleteIssue(store.getState())).toEqual({
        lineIds: ["line-2"],
        paymentIds: [],
        label: "Sold on another sale",
      });
    });

    it("a trade-in IMEI in stock points at the payment from payment_id, or by IMEI", async () => {
      const second = tradeInPayment({ id: "pay-ti-2", trade_in_imei: "490154203237518" });
      const store = await paidStore(paidSale({ payments: [cashPayment(), tradeInPayment(), second] }));

      await failWith(store, {
        message: "IMEI already exists in inventory",
        imei: "490154203237518",
        payment_id: "pay-ti-2",
        existing_unit: null,
      });
      expect(selectCompleteIssue(store.getState())).toEqual({
        lineIds: [],
        paymentIds: ["pay-ti-2"],
        label: "Already in stock",
      });

      // Without payment_id (older server): matched by IMEI
      await failWith(store, { message: "IMEI already exists in inventory", imei: "354789102345678", existing_unit: null });
      expect(selectCompleteIssue(store.getState()).paymentIds).toEqual(["pay-ti"]);
    });

    it("an inactive trade-in product points at the trade-ins on that product", async () => {
      const store = await paidStore(
        paidSale({
          payments: [
            tradeInPayment({ trade_in_product: { id: "p-a", name: "Used iPhone 12" } }),
            tradeInPayment({ id: "pay-ti-2", trade_in_product: { id: "p-b", name: "Used Galaxy S21" } }),
          ],
        }),
      );

      await failWith(store, { message: 'Product "Used Galaxy S21" is inactive' }, 400);

      expect(selectCompleteIssue(store.getState())).toEqual({
        lineIds: [],
        paymentIds: ["pay-ti-2"],
        label: "Product inactive",
      });
    });

    it("errors that aren't about a row point at nothing", async () => {
      const store = await paidStore();

      await failWith(store, { message: "A trade-in needs the customer's NIC" }, 400);

      expect(selectCompleteError(store.getState()).kind).toBe("nic_required");
      expect(selectCompleteIssue(store.getState())).toEqual({ lineIds: [], paymentIds: [], label: null });
    });

    it("the issue stands until the cashier changes the sale", async () => {
      const store = await paidStore();
      await failWith(store, {
        message: 'Insufficient stock for "USB-C Cable 1m": requested 1, available 0',
        product_id: "p-cable",
        sale_line_id: "line-1",
      });
      salesService.updateSaleLine.mockRejectedValueOnce(httpError(400, "Quantity must be at least 1"));

      // A failed edit doesn't clear it
      await store.dispatch(updateLineQty({ lineId: "line-1", quantity: 2 }));
      expect(selectCompleteIssue(store.getState()).lineIds).toEqual(["line-1"]);

      // A successful one does
      salesService.removeSaleLine.mockResolvedValue();
      salesService.getSale.mockResolvedValue(paidSale({ lines: [] }));
      await store.dispatch(removeLine({ lineId: "line-1" }));
      expect(selectCompleteError(store.getState())).toBeNull();
      expect(selectCompleteIssue(store.getState()).lineIds).toEqual([]);
    });

    it("changing a line's warranty counts as changing the sale (P5-18)", async () => {
      const store = await paidStore();
      await failWith(store, {
        message: 'Insufficient stock for "USB-C Cable 1m": requested 1, available 0',
        product_id: "p-cable",
        sale_line_id: "line-1",
      });
      salesService.updateSaleLine.mockResolvedValue(paidSale({ lines: [saleLine({ warranty: "WEEK_1" })] }));

      await store.dispatch(updateLineWarranty({ lineId: "line-1", warranty: "WEEK_1" }));

      expect(selectCompleteError(store.getState())).toBeNull();
    });

    it("changing a line's discount counts as changing the sale (P5-20)", async () => {
      const store = await paidStore();
      await failWith(store, {
        message: 'Insufficient stock for "USB-C Cable 1m": requested 1, available 0',
        product_id: "p-cable",
        sale_line_id: "line-1",
      });
      salesService.updateSaleLine.mockResolvedValue(paidSale());

      await store.dispatch(updateLineDiscount({ lineId: "line-1", discount_type: "PERCENT", discount_value: 10 }));

      expect(selectCompleteError(store.getState())).toBeNull();
    });

    it("saving the customer's NIC clears a missing-NIC error", async () => {
      const store = await paidStore(paidSale({ customer: customer() }));
      await failWith(store, { message: "A trade-in needs the customer's NIC" }, 400);
      customersService.updateCustomer.mockResolvedValue(customer());

      await store.dispatch(saveCustomerNic({ nic: "199012345678" }));

      expect(selectCompleteError(store.getState())).toBeNull();
    });

    it("a fresh draft starts without a complete error", async () => {
      const store = await paidStore();
      await failWith(store, { message: "A trade-in needs the customer's NIC" }, 400);
      salesService.discardSale.mockResolvedValue();
      salesService.createSale.mockResolvedValue(draftSale({ id: "sale-2" }));

      await store.dispatch(discardDraftSale({ branchId: "branch-main" }));

      expect(selectCompleteError(store.getState())).toBeNull();
    });

    it("reloadDraftSale re-reads the draft and keeps the error on screen", async () => {
      const store = await paidStore();
      await failWith(
        store,
        { message: "Cannot complete sale: amount_paid 1500.00 does not equal total 3000.00" },
        400,
      );
      const serverSale = paidSale({ total: "3000.00", subtotal: "3000.00" });
      salesService.getSale.mockResolvedValue(serverSale);

      await store.dispatch(reloadDraftSale());

      expect(salesService.getSale).toHaveBeenCalledWith("sale-1");
      expect(store.getState().posTerminal.draftSale.total).toBe("3000.00");
      expect(selectCompleteError(store.getState()).kind).toBe("unpaid");
    });

    it("reloadDraftSale is refused while completing", async () => {
      const store = await paidStore();
      salesService.completeSale.mockReturnValue(new Promise(() => {}));
      store.dispatch(completeSale());

      const result = await store.dispatch(reloadDraftSale());

      expect(result.meta.condition).toBe(true);
      expect(salesService.getSale).not.toHaveBeenCalled();
    });
  });

  describe("Reprint last receipt pointer (P5-12)", () => {
    it("survives discarding the next draft, and is replaced by the next completion", async () => {
      const store = await paidStore();
      salesService.completeSale.mockResolvedValueOnce(completedSale());
      salesService.createSale.mockResolvedValue(draftSale({ id: "sale-2" }));
      await store.dispatch(completeSale());
      await store.dispatch(startNextSale());

      salesService.discardSale.mockResolvedValue();
      salesService.createSale.mockResolvedValue(draftSale({ id: "sale-3" }));
      await store.dispatch(discardDraftSale({ branchId: "branch-main" }));

      expect(useTerminalSessionStore.getState().draftSaleId).toBe("sale-3");
      expect(useTerminalSessionStore.getState().lastCompletedSaleId).toBe("sale-1");
      // The completed sale stays available while the next draft opens
      expect(selectLastCompletedSale(store.getState()).id).toBe("sale-1");
    });

    it("is dropped on logout (store clear) with the draft pointer", () => {
      useTerminalSessionStore.getState().setDraftSaleId("sale-2");
      useTerminalSessionStore.getState().setLastCompletedSaleId("sale-1");

      useTerminalSessionStore.getState().clear();

      expect(useTerminalSessionStore.getState().draftSaleId).toBeNull();
      expect(useTerminalSessionStore.getState().lastCompletedSaleId).toBeNull();
    });

    it("clearPosTerminal (logout) drops lastCompletedSale and completeError", async () => {
      const store = await paidStore();
      salesService.completeSale.mockResolvedValue(completedSale());
      await store.dispatch(completeSale());

      store.dispatch(clearPosTerminal());

      expect(selectLastCompletedSale(store.getState())).toBeNull();
      expect(selectCompleteError(store.getState())).toBeNull();
    });
  });

  describe("selectCanComplete", () => {
    const stateWith = (posTerminal) => ({
      posTerminal: {
        status: "ready",
        draftSale: paidSale(),
        pendingLines: [],
        busyLineIds: [],
        pendingPayments: [],
        removingPaymentIds: [],
        ...posTerminal,
      },
    });

    it.each([
      ["a fully paid open draft", {}, true],
      ["a balance left", { draftSale: paidSale({ amount_paid: "1000.00" }) }, false],
      ["an empty cart", { draftSale: paidSale({ lines: [] }) }, false],
      ["a payment in flight", { pendingPayments: [cashPayment({ id: "pending-1" })] }, false],
      ["a line being edited", { busyLineIds: ["line-1"] }, false],
      ["completing", { status: "completing" }, false],
      ["a gone draft", { status: "gone" }, false],
    ])("with %s → %s", (_, posTerminal, expected) => {
      expect(selectCanComplete(stateWith(posTerminal))).toBe(expected);
    });
  });
});

describe("posTerminal stock shortfall before payment", () => {
  const glassLine = (overrides = {}) =>
    saleLine({
      id: "line-glass",
      line_number: 2,
      product_id: "p-glass",
      product_name_snapshot: "TEST Tempered Glass",
      unit_price: "990.00",
      ...overrides,
    });
  const tracked = (quantity) => ({ quantity, manage_stock: true });
  // A ready draft with a balance left and nothing in flight: only stock decides selectCanPay.
  const stateWith = (lines, stockByProduct) => ({
    posTerminal: {
      status: "ready",
      draftSale: draftSale({ lines, subtotal: "1500.00", total: "1500.00", amount_paid: "0.00" }),
      stockByProduct,
      pendingLines: [],
      busyLineIds: [],
      pendingPayments: [],
      removingPaymentIds: [],
    },
  });

  it("one short product: listed with what the sale needs and what the branch has, and Pay blocked", () => {
    const state = stateWith([glassLine({ quantity: 26 })], { "p-glass": tracked(25) });

    expect(selectStockShortfall(state)).toEqual([
      { product_id: "p-glass", name: "TEST Tempered Glass", required: 26, available: 25 },
    ]);
    expect(selectCanPay(state)).toBe(false);
  });

  it("several short products: each listed, in cart order", () => {
    const state = stateWith([saleLine({ quantity: 3 }), glassLine({ quantity: 2 })], {
      [cableProduct.id]: tracked(1),
      "p-glass": tracked(0),
    });

    expect(selectStockShortfall(state)).toEqual([
      { product_id: cableProduct.id, name: cableProduct.name, required: 3, available: 1 },
      { product_id: "p-glass", name: "TEST Tempered Glass", required: 2, available: 0 },
    ]);
    expect(selectCanPay(state)).toBe(false);
  });

  it("adds up several lines of one product, and lists it once", () => {
    const state = stateWith(
      [glassLine({ quantity: 15 }), glassLine({ id: "line-glass-2", line_number: 3, quantity: 11 })],
      { "p-glass": tracked(25) },
    );

    expect(selectStockWarnings(state)).toEqual({
      "line-glass": { available: 25, required: 26 },
      "line-glass-2": { available: 25, required: 26 },
    });
    expect(selectStockShortfall(state)).toEqual([
      { product_id: "p-glass", name: "TEST Tempered Glass", required: 26, available: 25 },
    ]);
  });

  it.each([
    ["another shop's line (no stock is taken for it)", [glassLine({ quantity: 30, external_supplier_id: "sup-1" })], { "p-glass": tracked(25) }],
    [
      "another shop's line beside an in-house one that fits",
      [glassLine({ quantity: 20 }), glassLine({ id: "line-ext", line_number: 3, quantity: 10, external_supplier_id: "sup-1" })],
      { "p-glass": tracked(25) },
    ],
    ["an untracked product", [glassLine({ quantity: 26 })], { "p-glass": { quantity: 0, manage_stock: false } }],
    ["unknown stock (never read, or the read failed)", [glassLine({ quantity: 26 })], {}],
    ["no stock read at all yet", [glassLine({ quantity: 26 })], undefined],
  ])("%s is never short and doesn't block Pay", (_, lines, stockByProduct) => {
    const state = stateWith(lines, stockByProduct);

    expect(selectStockShortfall(state)).toEqual([]);
    expect(selectCanPay(state)).toBe(true);
  });

  it("Pay comes back once the quantity is reduced to what is in stock", () => {
    expect(selectCanPay(stateWith([glassLine({ quantity: 26 })], { "p-glass": tracked(25) }))).toBe(false);
    expect(selectCanPay(stateWith([glassLine({ quantity: 25 })], { "p-glass": tracked(25) }))).toBe(true);
  });

  it("Pay comes back once refreshed stock covers the sale", async () => {
    stockService.listStock.mockResolvedValue([
      { product_id: "p-glass", branch_id: "branch-main", quantity: 30, manage_stock: true },
    ]);
    const store = createTestStore({
      posTerminal: posTerminalState({
        draftSale: draftSale({ lines: [glassLine({ quantity: 26 })], subtotal: "25740.00", total: "25740.00" }),
        stockByProduct: { "p-glass": tracked(25) },
      }),
    });
    expect(selectCanPay(store.getState())).toBe(false);

    await store.dispatch(refreshCartStock({ branchId: "branch-main", productIds: ["p-glass"] }));

    expect(selectStockShortfall(store.getState())).toEqual([]);
    expect(selectCanPay(store.getState())).toBe(true);
  });
});
