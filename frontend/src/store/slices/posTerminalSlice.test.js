import { vi } from "vitest";
import { createTestStore } from "../../test/renderWithProviders";
import { draftSale, saleLine, cableProduct } from "../../test/posFixtures";
import useTerminalSessionStore from "../zustand/terminalSessionStore";
import * as salesService from "../../services/salesService";
import * as stockService from "../../services/stockService";
import {
  addLine,
  discardDraftSale,
  ensureDraftSale,
  removeLine,
  selectCartLines,
  selectStockWarnings,
  updateLineQty,
} from "./posTerminalSlice";

vi.mock("../../services/salesService");
vi.mock("../../services/stockService");

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

