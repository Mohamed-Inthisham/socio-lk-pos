import {
  createSlice,
  createAsyncThunk,
  createSelector,
} from "@reduxjs/toolkit";
import {
  addSaleLine,
  addSalePayment,
  createSale,
  discardSale,
  getSale,
  removeSaleLine,
  removeSalePayment,
  updateSale,
  updateSaleLine,
} from "../../services/salesService";
import {
  createCustomer,
  getCustomer,
} from "../../services/customersService";
import {
  getProductByBarcode,
  listProducts,
} from "../../services/productsService";
import { listStock } from "../../services/stockService";
import useTerminalSessionStore from "../zustand/terminalSessionStore";
import { fromCents, toCents } from "../../utils/money";

/**
 * POS Terminal Slice
 *
 * Owns the terminal's in-flight DRAFT sale. The server is the source of
 * truth: every line mutation returns the hydrated sale and the reducer
 * replaces `draftSale` wholesale — totals are never recomputed here.
 *
 * DRAFT LIFECYCLE (planning doc Q8):
 * - ensureDraftSale: on terminal open, resume the persisted draft
 *   (terminalSessionStore) if it is still a DRAFT on this branch,
 *   otherwise POST /sales for a fresh one.
 * - discardDraftSale: DELETE the current draft and open a fresh one
 *   ("New sale", Q18 a).
 * - A mutation that comes back 404 / "Only DRAFT sales are mutable" means
 *   the sale was completed or discarded elsewhere: status becomes "gone"
 *   and the terminal offers a new sale.
 *
 * OPTIMISTIC ADD:
 * addLine shows a pending row (pendingLines) the moment it is dispatched;
 * success replaces it with the server's sale, failure removes it. Qty edits
 * and removals are not optimistic — the row is marked busy until the
 * server answers.
 *
 * SCANNING:
 * scanBarcode resolves an exact barcode (GET /products/by-barcode) and
 * searchProducts runs the debounced name search (GET /products?search=,
 * scoped to the branch, 20 results). Neither preloads the catalog
 * (hybrid loading, planning doc §5). The ScanBar decides what to do with
 * the resolved product: addLine, or the IMEI prompt for serialized items.
 *
 * STOCK WARNING (Q1 b):
 * addLine does not check stock; the 409 at complete is the real guard.
 * After each add / qty change (and for every product on a resumed draft)
 * refreshStock fetches the branch stock row, and selectStockWarnings
 * flags lines whose product needs more units than the branch has. It
 * warns only — it never blocks a line.
 *
 * CUSTOMER (P2):
 * attachCustomer / detachCustomer PATCH /sales/:id { customer_id }. They
 * are optimistic: the card shows the new customer (or walk-in) at once
 * and reverts if the PATCH fails. createAndAttachCustomer POSTs the
 * customer first; a NIC clash (409) rejects with the existing customer so
 * the dialog can offer to attach that one instead. Detach is refused
 * while the sale has a TRADE_IN payment (Q19 — the backend would only
 * fail later, at complete).
 *
 * PAYMENTS (P3):
 * addPayment shows a pending row (pendingPayments) at once; the server's
 * sale replaces it, or it is removed on failure. removePayment hides the
 * row at once (removingPaymentIds) and restores it if the DELETE fails —
 * no confirm (planning doc P3-2). Paid and balance come from the server's
 * total / amount_paid, subtracted in integer cents. No payment edit (P3-1).
 *
 * ORDERING:
 * Line, customer and payment mutations run one at a time through
 * `enqueue`, so fast consecutive scans reach the server in order and an
 * older response can never overwrite a newer sale (planning doc §6, scan
 * queue).
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let mutationQueue = Promise.resolve();

const enqueue = (task) => {
  const run = mutationQueue.then(task, task);
  mutationQueue = run.catch(() => {});
  return run;
};

const toError = (error, fallback) => {
  const data = error?.response?.data;
  const raw = data?.message;
  const message =
    (Array.isArray(raw) ? raw[0] : raw) || error?.message || fallback;
  const status = error?.response?.status ?? null;
  return {
    message,
    status,
    existing_unit: data?.existing_unit ?? null,
    // The draft was completed / discarded / deleted somewhere else.
    gone:
      status === 404 ||
      (status === 400 && /only draft sales are mutable/i.test(message)),
  };
};

// POST /sales returns the bare row; give it the hydrated collections.
const hydrate = (sale) => ({ lines: [], payments: [], ...sale });

const session = () => useTerminalSessionStore.getState();

// ---------------------------------------------------------------------------
// Thunks — draft lifecycle
// ---------------------------------------------------------------------------

const createDraft = async (branchId) => {
  const sale = hydrate(await createSale({ branch_id: branchId }));
  session().setDraftSaleId(sale.id);
  return sale;
};

export const ensureDraftSale = createAsyncThunk(
  "posTerminal/ensureDraftSale",
  async ({ branchId }, { dispatch, rejectWithValue }) => {
    try {
      const storedId = session().draftSaleId;
      if (storedId) {
        try {
          const sale = await getSale(storedId);
          if (sale.status === "DRAFT" && sale.branch_id === branchId) {
            if (sale.lines.length) {
              dispatch(refreshCartStock({
                branchId,
                productIds: [...new Set(sale.lines.map((l) => l.product_id))],
              }));
            }
            return sale;
          }
        } catch (error) {
          // 404 = discarded; anything else (network, 5xx) must not
          // silently start a second draft.
          if (error?.response?.status !== 404) throw error;
        }
        session().clear();
      }
      return await createDraft(branchId);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't open a sale"));
    }
  },
  {
    // StrictMode double-mount / re-renders must not create two drafts.
    condition: (_, { getState }) =>
      !["loading", "discarding"].includes(getState().posTerminal.status),
  },
);

export const discardDraftSale = createAsyncThunk(
  "posTerminal/discardDraftSale",
  async ({ branchId }, { getState, rejectWithValue }) => {
    const saleId = getState().posTerminal.draftSaleId;
    try {
      await enqueue(async () => {
        if (!saleId) return;
        try {
          await discardSale(saleId);
        } catch (error) {
          // Already gone / no longer a draft — nothing left to discard.
          if (!toError(error).gone) throw error;
        }
      });
    } catch (error) {
      // The old draft is untouched; the terminal keeps showing it.
      return rejectWithValue({
        ...toError(error, "Couldn't discard the sale"),
        stage: "discard",
      });
    }
    try {
      session().clear();
      return await createDraft(branchId);
    } catch (error) {
      return rejectWithValue({
        ...toError(error, "Couldn't start a new sale"),
        stage: "create",
      });
    }
  },
  {
    condition: (_, { getState }) =>
      !["loading", "discarding"].includes(getState().posTerminal.status),
  },
);

// ---------------------------------------------------------------------------
// Thunks — stock
// ---------------------------------------------------------------------------

/** arg: { productId, branchId } — failures leave the product unknown (no badge). */
export const refreshStock = createAsyncThunk(
  "posTerminal/refreshStock",
  async ({ productId, branchId }, { rejectWithValue }) => {
    try {
      const [row] = await listStock({ productId, branchId });
      return row
        ? { quantity: row.quantity, manage_stock: row.manage_stock }
        : null;
    } catch (error) {
      return rejectWithValue(toError(error, "Stock lookup failed"));
    }
  },
);

/**
 * Resume path: ONE branch-wide GET /stock?branchId= instead of a lookup
 * per cart product. The API is throttled at 10 req/s per IP, and a
 * per-product burst on reload pushed carts with ~7+ distinct products
 * over it (429s → silently missing badges).
 * arg: { branchId, productIds } → { [productId]: stock | null }
 */
export const refreshCartStock = createAsyncThunk(
  "posTerminal/refreshCartStock",
  async ({ branchId, productIds }, { rejectWithValue }) => {
    try {
      const rows = await listStock({ branchId });
      const byProduct = Object.fromEntries(rows.map((r) => [r.product_id, r]));
      return Object.fromEntries(
        productIds.map((id) => [
          id,
          byProduct[id]
            ? { quantity: byProduct[id].quantity, manage_stock: byProduct[id].manage_stock }
            : null,
        ]),
      );
    } catch (error) {
      return rejectWithValue(toError(error, "Stock lookup failed"));
    }
  },
);

const refreshStockFor = (dispatch, sale, productIds) => {
  for (const productId of new Set(productIds)) {
    dispatch(refreshStock({ productId, branchId: sale.branch_id }));
  }
};

// ---------------------------------------------------------------------------
// Thunks — line mutations
// ---------------------------------------------------------------------------

const saleMutation = (fallback, run, stockProductId) => async (arg, { dispatch, getState, rejectWithValue }) => {
  const saleId = getState().posTerminal.draftSaleId;
  try {
    const sale = await enqueue(() => run(saleId, arg));
    const productId = stockProductId?.(arg, sale);
    if (productId) refreshStockFor(dispatch, sale, [productId]);
    return sale;
  } catch (error) {
    const err = toError(error, fallback);
    if (err.gone) session().clear();
    return rejectWithValue(err);
  }
};

/**
 * Add a product to the draft.
 * arg: { product, quantity = 1, imei? } — `product` is the catalog row
 * (from by-barcode or search); its name and price feed the pending row.
 */
export const addLine = createAsyncThunk(
  "posTerminal/addLine",
  saleMutation("Couldn't add the item", (saleId, { product, quantity = 1, imei }) =>
    addSaleLine(saleId, {
      product_id: product.id,
      quantity,
      ...(imei ? { imei_snapshot: imei } : {}),
    }),
    ({ product }) => product.id,
  ),
);

/** arg: { lineId, quantity } */
export const updateLineQty = createAsyncThunk(
  "posTerminal/updateLineQty",
  saleMutation(
    "Couldn't change the quantity",
    (saleId, { lineId, quantity }) => updateSaleLine(saleId, lineId, { quantity }),
    ({ lineId }, sale) => sale.lines.find((l) => l.id === lineId)?.product_id,
  ),
);

/** arg: { lineId } — DELETE is 204, so re-fetch the sale. */
export const removeLine = createAsyncThunk(
  "posTerminal/removeLine",
  saleMutation("Couldn't remove the item", async (saleId, { lineId }) => {
    await removeSaleLine(saleId, lineId);
    return getSale(saleId);
  }),
);

// ---------------------------------------------------------------------------
// Thunks — customer
// ---------------------------------------------------------------------------

const hasTradeInPayment = (sale) =>
  (sale?.payments ?? []).some((p) => p.payment_method === "TRADE_IN");

/**
 * arg: { customer } — the picked customer row; the card shows it before
 * the PATCH lands.
 */
export const attachCustomer = createAsyncThunk(
  "posTerminal/attachCustomer",
  saleMutation("Couldn't attach the customer", (saleId, { customer }) =>
    updateSale(saleId, { customer_id: customer.id }),
  ),
);

/** No arg. Refused (no request, no state change) while a TRADE_IN payment exists. */
export const detachCustomer = createAsyncThunk(
  "posTerminal/detachCustomer",
  saleMutation("Couldn't remove the customer", (saleId) =>
    updateSale(saleId, { customer_id: null }),
  ),
  {
    condition: (_, { getState }) =>
      !hasTradeInPayment(getState().posTerminal.draftSale),
  },
);

/**
 * arg: { name, phone, nic? } — POST /customers, then attach.
 *
 * Rejections carry a `stage`:
 * - "create": nothing was saved. On a NIC clash (409) `existing_customer`
 *   is the customer who already has that NIC (or null if it couldn't be
 *   fetched; `existing_customer_id` is always set).
 * - "attach": the customer WAS created (`customer`), but the PATCH failed
 *   — retry with attachCustomer({ customer }) rather than creating again.
 */
export const createAndAttachCustomer = createAsyncThunk(
  "posTerminal/createAndAttachCustomer",
  async (dto, { dispatch, rejectWithValue }) => {
    let customer;
    try {
      customer = await createCustomer(dto);
    } catch (error) {
      const err = { ...toError(error, "Couldn't create the customer"), stage: "create" };
      const existingId = error?.response?.data?.existing_customer_id;
      if (err.status === 409 && existingId) {
        err.existing_customer_id = existingId;
        err.existing_customer = await getCustomer(existingId).catch(() => null);
      }
      return rejectWithValue(err);
    }
    const result = await dispatch(attachCustomer({ customer }));
    if (attachCustomer.rejected.match(result)) {
      return rejectWithValue({ ...result.payload, stage: "attach", customer });
    }
    return result.payload;
  },
);

// ---------------------------------------------------------------------------
// Thunks — payments
// ---------------------------------------------------------------------------

/**
 * Record one tender. arg: the AddPaymentDto body —
 * { payment_method, amount, cash_received? (CASH), reference_number? }.
 * Its method and amount feed the pending row.
 */
export const addPayment = createAsyncThunk(
  "posTerminal/addPayment",
  saleMutation("Couldn't record the payment", (saleId, payload) =>
    addSalePayment(saleId, payload),
  ),
);

/** arg: { paymentId } — DELETE is 204, so re-fetch the sale. */
export const removePayment = createAsyncThunk(
  "posTerminal/removePayment",
  saleMutation("Couldn't remove the payment", async (saleId, { paymentId }) => {
    await removeSalePayment(saleId, paymentId);
    return getSale(saleId);
  }),
);

// ---------------------------------------------------------------------------
// Thunks — scanning
// ---------------------------------------------------------------------------

// A 15-digit miss is most likely a phone's IMEI sticker (Q9: phones carry
// both labels; cashiers can't resolve IMEI → product yet).
const IMEI_SHAPE = /^\d{15}$/;

/** arg: { barcode } → resolves with the product */
export const scanBarcode = createAsyncThunk(
  "posTerminal/scanBarcode",
  async ({ barcode }, { rejectWithValue }) => {
    try {
      return await getProductByBarcode(barcode);
    } catch (error) {
      if (error?.response?.status === 404) {
        return rejectWithValue({
          message: IMEI_SHAPE.test(barcode)
            ? "That looks like an IMEI — scan the product label first."
            : `No product found for "${barcode}".`,
          status: 404,
        });
      }
      return rejectWithValue(toError(error, "Barcode lookup failed"));
    }
  },
);

export const SEARCH_LIMIT = 20;

/** arg: { query, branchId } → resolves with up to 20 products */
export const searchProducts = createAsyncThunk(
  "posTerminal/searchProducts",
  async ({ query, branchId }, { rejectWithValue }) => {
    try {
      const page = await listProducts({
        search: query,
        branchId,
        limit: SEARCH_LIMIT,
      });
      return page.data;
    } catch (error) {
      return rejectWithValue(toError(error, "Search failed"));
    }
  },
);

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const initialState = {
  draftSaleId: null,
  draftSale: null,
  // Draft lifecycle: idle | loading | ready | discarding | error | gone
  status: "idle",
  // Draft lifecycle error: { message, status } | null
  error: null,
  // Optimistic rows for in-flight addLine calls
  pendingLines: [],
  // Line ids with an in-flight qty edit / removal
  busyLineIds: [],
  // Last cart mutation error: { message, status, existing_unit } | null
  lineError: null,
  // Scan bar: idle | searching (name search) | loading (barcode lookup)
  scanState: "idle",
  scanResults: [],
  // The query scanResults belong to (Enter must not pick stale results)
  scanQuery: null,
  scanError: null,
  // Latest search request — older responses are dropped
  searchRequestId: null,
  // Branch stock per product: { [productId]: { quantity, manage_stock } }
  stockByProduct: {},
  // Products whose last stock lookup failed: { [productId]: true }
  stockErrors: {},
  // Latest customer request (attach / detach / create) — only it may
  // clear `customerSaving` or roll back
  customerRequestId: null,
  customerSaving: false,
  // Customer before the optimistic change: { customer, customer_id }
  customerRollback: null,
  // Last customer mutation error: { message, status } | null
  customerError: null,
  // Optimistic rows for in-flight addPayment calls
  pendingPayments: [],
  // Payment ids hidden while their DELETE is in flight
  removingPaymentIds: [],
  // Last payment mutation error: { message, status } | null
  paymentError: null,
};

const markBusy = (state, lineId) => {
  if (!state.busyLineIds.includes(lineId)) state.busyLineIds.push(lineId);
};

const unmarkBusy = (state, lineId) => {
  state.busyLineIds = state.busyLineIds.filter((id) => id !== lineId);
};

const markGone = (state, payload) => {
  if (payload?.gone) {
    state.status = "gone";
    state.draftSaleId = null;
  }
};

const applyRejection = (state, payload, fallback) => {
  state.lineError = payload || { message: fallback };
  markGone(state, payload);
};

const applyPaymentRejection = (state, payload, fallback) => {
  state.paymentError = payload || { message: fallback };
  markGone(state, payload);
};

const dropPendingPayment = (state, action) => {
  state.pendingPayments = state.pendingPayments.filter(
    (p) => p.id !== `pending-${action.meta.requestId}`,
  );
};

const unhidePayment = (state, action) => {
  state.removingPaymentIds = state.removingPaymentIds.filter(
    (id) => id !== action.meta.arg.paymentId,
  );
};

const customerPending = (state, action, customer) => {
  state.customerRequestId = action.meta.requestId;
  state.customerSaving = true;
  state.customerError = null;
  if (!state.draftSale || customer === undefined) return;
  state.customerRollback = {
    customer: state.draftSale.customer ?? null,
    customer_id: state.draftSale.customer_id ?? null,
  };
  state.draftSale.customer = customer;
  state.draftSale.customer_id = customer?.id ?? null;
};

// A line response queued before an in-flight customer PATCH still carries
// the old customer — keep the optimistic one on screen until it settles.
const replaceSale = (state, sale) => {
  const optimistic = state.customerRollback && state.draftSale;
  const { customer, customer_id } = state.draftSale ?? {};
  state.draftSale = sale;
  if (optimistic) Object.assign(state.draftSale, { customer, customer_id });
};

const isLatestCustomerRequest = (state, action) =>
  action.meta.requestId === state.customerRequestId;

const customerSettled = (state) => {
  state.customerSaving = false;
  state.customerRollback = null;
};

const customerFulfilled = (state, action) => {
  if (isLatestCustomerRequest(state, action)) {
    customerSettled(state);
    state.draftSale = action.payload;
  } else {
    // A newer customer request is still in flight — keep its optimistic value.
    replaceSale(state, action.payload);
  }
};

const customerRejected = (state, action, fallback) => {
  if (!isLatestCustomerRequest(state, action)) return;
  if (state.customerRollback && state.draftSale) {
    Object.assign(state.draftSale, state.customerRollback);
  }
  customerSettled(state);
  state.customerError = action.payload || { message: fallback };
  if (action.payload?.gone) {
    state.status = "gone";
    state.draftSaleId = null;
  }
};

const posTerminalSlice = createSlice({
  name: "posTerminal",
  initialState,
  reducers: {
    clearPosTerminal: () => initialState,
    clearLineError: (state) => {
      state.lineError = null;
    },
    clearCustomerError: (state) => {
      state.customerError = null;
    },
    clearPaymentError: (state) => {
      state.paymentError = null;
    },
    clearScan: (state) => {
      state.scanState = "idle";
      state.scanResults = [];
      state.scanQuery = null;
      state.scanError = null;
      state.searchRequestId = null;
    },
  },
  extraReducers: (builder) => {
    const lifecyclePending = (state) => {
      state.status = "loading";
      state.error = null;
      state.lineError = null;
    };
    const lifecycleFulfilled = (state, action) => {
      state.status = "ready";
      state.draftSale = action.payload;
      state.draftSaleId = action.payload.id;
      state.pendingLines = [];
      state.busyLineIds = [];
      state.customerRequestId = null;
      customerSettled(state);
      state.customerError = null;
      state.pendingPayments = [];
      state.removingPaymentIds = [];
      state.paymentError = null;
    };
    const lifecycleRejected = (state, action) => {
      state.status = "error";
      state.error = action.payload || { message: "Couldn't open a sale" };
    };

    builder
      .addCase(ensureDraftSale.pending, lifecyclePending)
      .addCase(ensureDraftSale.fulfilled, lifecycleFulfilled)
      .addCase(ensureDraftSale.rejected, lifecycleRejected)
      // Discard keeps the cart on screen ("discarding") so the confirm
      // dialog can show a failed DELETE without losing the sale.
      .addCase(discardDraftSale.pending, (state) => {
        state.status = "discarding";
        state.lineError = null;
      })
      .addCase(discardDraftSale.fulfilled, lifecycleFulfilled)
      .addCase(discardDraftSale.rejected, (state, action) => {
        if (action.payload?.stage === "discard") {
          state.status = "ready";
        } else {
          lifecycleRejected(state, action);
        }
      })

      // addLine — optimistic pending row
      .addCase(addLine.pending, (state, action) => {
        const { product, quantity = 1, imei } = action.meta.arg;
        state.lineError = null;
        state.pendingLines.push({
          id: `pending-${action.meta.requestId}`,
          product_id: product.id,
          product_name_snapshot: product.name,
          product_sku_snapshot: product.sku ?? null,
          unit_price: product.selling_price ?? null,
          quantity,
          imei_snapshot: imei ?? null,
          line_total: null,
        });
      })
      .addCase(addLine.fulfilled, (state, action) => {
        state.pendingLines = state.pendingLines.filter(
          (l) => l.id !== `pending-${action.meta.requestId}`,
        );
        replaceSale(state, action.payload);
      })
      .addCase(addLine.rejected, (state, action) => {
        state.pendingLines = state.pendingLines.filter(
          (l) => l.id !== `pending-${action.meta.requestId}`,
        );
        applyRejection(state, action.payload, "Couldn't add the item");
      })

      // updateLineQty / removeLine — busy row until the server answers
      .addCase(updateLineQty.pending, (state, action) => {
        state.lineError = null;
        markBusy(state, action.meta.arg.lineId);
      })
      .addCase(updateLineQty.fulfilled, (state, action) => {
        unmarkBusy(state, action.meta.arg.lineId);
        replaceSale(state, action.payload);
      })
      .addCase(updateLineQty.rejected, (state, action) => {
        unmarkBusy(state, action.meta.arg.lineId);
        applyRejection(state, action.payload, "Couldn't change the quantity");
      })
      .addCase(removeLine.pending, (state, action) => {
        state.lineError = null;
        markBusy(state, action.meta.arg.lineId);
      })
      .addCase(removeLine.fulfilled, (state, action) => {
        unmarkBusy(state, action.meta.arg.lineId);
        replaceSale(state, action.payload);
      })
      .addCase(removeLine.rejected, (state, action) => {
        unmarkBusy(state, action.meta.arg.lineId);
        applyRejection(state, action.payload, "Couldn't remove the item");
      })

      // Customer — optimistic card, rolled back on failure
      .addCase(attachCustomer.pending, (state, action) => {
        customerPending(state, action, action.meta.arg.customer);
      })
      .addCase(detachCustomer.pending, (state, action) => {
        customerPending(state, action, null);
      })
      .addCase(createAndAttachCustomer.pending, (state, action) => {
        // Nothing to show until the customer exists; attachCustomer
        // (dispatched by this thunk) does the optimistic update.
        customerPending(state, action, undefined);
      })
      .addCase(attachCustomer.fulfilled, customerFulfilled)
      .addCase(detachCustomer.fulfilled, customerFulfilled)
      .addCase(attachCustomer.rejected, (state, action) => {
        customerRejected(state, action, "Couldn't attach the customer");
      })
      .addCase(detachCustomer.rejected, (state, action) => {
        customerRejected(state, action, "Couldn't remove the customer");
      })
      .addCase(createAndAttachCustomer.rejected, (state, action) => {
        customerRejected(state, action, "Couldn't create the customer");
      })

      // Payments — pending row on add, hide-then-restore on remove
      .addCase(addPayment.pending, (state, action) => {
        const { payment_method, amount, cash_received, reference_number } =
          action.meta.arg;
        state.paymentError = null;
        state.pendingPayments.push({
          id: `pending-${action.meta.requestId}`,
          payment_method,
          amount: fromCents(toCents(amount)),
          cash_received:
            cash_received === undefined ? null : fromCents(toCents(cash_received)),
          reference_number: reference_number ?? null,
        });
      })
      .addCase(addPayment.fulfilled, (state, action) => {
        dropPendingPayment(state, action);
        replaceSale(state, action.payload);
      })
      .addCase(addPayment.rejected, (state, action) => {
        dropPendingPayment(state, action);
        applyPaymentRejection(state, action.payload, "Couldn't record the payment");
      })
      .addCase(removePayment.pending, (state, action) => {
        state.paymentError = null;
        state.removingPaymentIds.push(action.meta.arg.paymentId);
      })
      .addCase(removePayment.fulfilled, (state, action) => {
        unhidePayment(state, action);
        replaceSale(state, action.payload);
      })
      .addCase(removePayment.rejected, (state, action) => {
        unhidePayment(state, action);
        applyPaymentRejection(state, action.payload, "Couldn't remove the payment");
      })

      // Stock
      .addCase(refreshStock.fulfilled, (state, action) => {
        const { productId } = action.meta.arg;
        delete state.stockErrors[productId];
        if (action.payload) state.stockByProduct[productId] = action.payload;
        else delete state.stockByProduct[productId];
      })
      .addCase(refreshStock.rejected, (state, action) => {
        state.stockErrors[action.meta.arg.productId] = true;
      })
      .addCase(refreshCartStock.fulfilled, (state, action) => {
        for (const [productId, stock] of Object.entries(action.payload)) {
          delete state.stockErrors[productId];
          if (stock) state.stockByProduct[productId] = stock;
          else delete state.stockByProduct[productId];
        }
      })
      .addCase(refreshCartStock.rejected, (state, action) => {
        for (const productId of action.meta.arg.productIds) {
          state.stockErrors[productId] = true;
        }
      })

      // Scanning
      .addCase(scanBarcode.pending, (state) => {
        state.scanState = "loading";
        state.scanError = null;
        state.scanResults = [];
        state.searchRequestId = null;
      })
      .addCase(scanBarcode.fulfilled, (state) => {
        state.scanState = "idle";
      })
      .addCase(scanBarcode.rejected, (state, action) => {
        state.scanState = "idle";
        state.scanError = action.payload || { message: "Barcode lookup failed" };
      })
      .addCase(searchProducts.pending, (state, action) => {
        state.scanState = "searching";
        state.scanError = null;
        state.searchRequestId = action.meta.requestId;
      })
      .addCase(searchProducts.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.searchRequestId) return;
        state.scanState = "idle";
        state.scanResults = action.payload;
        state.scanQuery = action.meta.arg.query;
      })
      .addCase(searchProducts.rejected, (state, action) => {
        if (action.meta.requestId !== state.searchRequestId) return;
        state.scanState = "idle";
        state.scanResults = [];
        state.scanError = action.payload || { message: "Search failed" };
      });
  },
});

export const {
  clearPosTerminal,
  clearLineError,
  clearCustomerError,
  clearPaymentError,
  clearScan,
} = posTerminalSlice.actions;

// Selectors
export const selectDraftSale = (state) => state.posTerminal.draftSale;
export const selectPosStatus = (state) => state.posTerminal.status;
export const selectPosError = (state) => state.posTerminal.error;
export const selectLineError = (state) => state.posTerminal.lineError;
export const selectScanState = (state) => state.posTerminal.scanState;
export const selectScanResults = (state) => state.posTerminal.scanResults;
export const selectScanQuery = (state) => state.posTerminal.scanQuery;
export const selectScanError = (state) => state.posTerminal.scanError;
export const selectAttachedCustomer = (state) =>
  state.posTerminal.draftSale?.customer ?? null;
/** Q19: a TRADE_IN payment needs the customer — detach is blocked. */
export const selectHasTradeInPayment = (state) =>
  hasTradeInPayment(state.posTerminal.draftSale);
export const selectCustomerSaving = (state) => state.posTerminal.customerSaving;
export const selectCustomerError = (state) => state.posTerminal.customerError;
const selectPendingLines = (state) => state.posTerminal.pendingLines;
const selectBusyLineIds = (state) => state.posTerminal.busyLineIds;

/**
 * True while a line or payment mutation is in flight — server totals
 * (total, paid, balance) are about to change.
 */
export const selectCartSyncing = (state) =>
  state.posTerminal.pendingLines.length > 0 ||
  state.posTerminal.busyLineIds.length > 0 ||
  state.posTerminal.pendingPayments.length > 0 ||
  state.posTerminal.removingPaymentIds.length > 0;

const selectStockByProduct = (state) => state.posTerminal.stockByProduct;

/**
 * Lines whose product needs more units than the branch has in stock:
 * { [lineId]: { available, required } }. `required` sums every line of
 * that product. Untracked (manage_stock=false) or unknown stock never
 * warns.
 */
export const selectStockWarnings = createSelector(
  [selectDraftSale, selectStockByProduct],
  (sale, stockByProduct) => {
    const lines = sale?.lines ?? [];
    const required = {};
    for (const line of lines) {
      required[line.product_id] = (required[line.product_id] ?? 0) + line.quantity;
    }
    const warnings = {};
    for (const line of lines) {
      const stock = stockByProduct[line.product_id];
      if (!stock || !stock.manage_stock) continue;
      if (stock.quantity < required[line.product_id]) {
        warnings[line.id] = {
          available: stock.quantity,
          required: required[line.product_id],
        };
      }
    }
    return warnings;
  },
);

/** Product ids whose stock lookup failed (no retry yet — see FOLLOWUPS). */
export const selectStockErrors = (state) => state.posTerminal.stockErrors;

/** Server lines (flagged busy while mutating) followed by pending rows. */
export const selectCartLines = createSelector(
  [selectDraftSale, selectPendingLines, selectBusyLineIds],
  (sale, pendingLines, busyLineIds) => [
    ...(sale?.lines ?? []).map((line) => ({
      ...line,
      pending: false,
      busy: busyLineIds.includes(line.id),
    })),
    ...pendingLines.map((line) => ({ ...line, pending: true, busy: true })),
  ],
);

export const selectPaymentError = (state) => state.posTerminal.paymentError;
const selectPendingPayments = (state) => state.posTerminal.pendingPayments;
const selectRemovingPaymentIds = (state) => state.posTerminal.removingPaymentIds;

/** Server payments (minus those being removed) followed by pending rows. */
export const selectPayments = createSelector(
  [selectDraftSale, selectPendingPayments, selectRemovingPaymentIds],
  (sale, pendingPayments, removingIds) => [
    ...(sale?.payments ?? [])
      .filter((p) => !removingIds.includes(p.id))
      .map((p) => ({ ...p, pending: false })),
    ...pendingPayments.map((p) => ({ ...p, pending: true })),
  ],
);

/** Server amount_paid ("1500.00"); "0.00" before a sale is loaded. */
export const selectPaidTotal = (state) =>
  state.posTerminal.draftSale?.amount_paid ?? "0.00";

const selectBalanceDueCents = (state) => {
  const sale = state.posTerminal.draftSale;
  if (!sale) return 0;
  return toCents(sale.total) - toCents(sale.amount_paid ?? "0.00");
};

/** Server total − amount_paid, subtracted in integer cents → "1234.50". */
export const selectBalanceDue = (state) => fromCents(selectBalanceDueCents(state));

/** The cart has lines and the server says nothing is left to pay. */
export const selectIsFullyPaid = (state) =>
  (state.posTerminal.draftSale?.lines?.length ?? 0) > 0 &&
  selectBalanceDueCents(state) === 0;

export default posTerminalSlice.reducer;
