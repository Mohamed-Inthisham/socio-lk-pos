import {
  createSlice,
  createAsyncThunk,
  createSelector,
  isAnyOf,
} from "@reduxjs/toolkit";
import {
  addSaleLine,
  addSalePayment,
  completeSale as completeSaleRequest,
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
  updateCustomer,
} from "../../services/customersService";
import {
  getProductByBarcode,
  listProducts,
} from "../../services/productsService";
import { listStock } from "../../services/stockService";
import useTerminalSessionStore from "../zustand/terminalSessionStore";
import { fromCents, toCents } from "../../utils/money";
import { COMPLETE_ERROR, classifyCompleteError } from "../../utils/completeErrors";

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
 * while the sale has a TRADE_IN payment, recorded or pending (Q19,
 * P4-11 — the backend rejects it, #22). saveCustomerNic adds the NIC a
 * trade-in needs (P4-13) to the attached customer.
 *
 * PAYMENTS (P3):
 * addPayment shows a pending row (pendingPayments) at once; the server's
 * sale replaces it, or it is removed on failure. removePayment hides the
 * row at once (removingPaymentIds) and restores it if the DELETE fails —
 * no confirm (planning doc P3-2). Paid and balance come from the server's
 * total / amount_paid, subtracted in integer cents. No payment edit (P3-1).
 * A pending TRADE_IN row carries its trade_in_* fields and the picked
 * product (P4), so it reads like the server's row.
 *
 * COMPLETE (P5):
 * completeSale moves "ready" → "completing" → "completed" (or back to
 * "ready" with completeError, or "gone"). It runs at most once at a time
 * and resolves a lost answer by re-fetching the sale (planning doc P5-7);
 * failures are classified into kinds (utils/completeErrors.js, P5-8). On
 * success the draft pointer is cleared and the sale is kept as
 * lastCompletedSale, its id persisted for "Reprint last receipt" (P5-12).
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

/** Tests only: drop the queue so a request one test leaves unsettled can't stall the next. */
export const resetMutationQueue = () => {
  mutationQueue = Promise.resolve();
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

// While the sale is being completed, and after it is (until the next
// draft opens), no edit may reach it: a request against a COMPLETED sale
// would come back "Only DRAFT sales are mutable" and drop the terminal
// into "gone". Every sale mutation thunk uses this as its `condition`, so
// the dispatch is refused at once — no request, no pending row, no
// rejected action. (P5 step A review)
const SALE_LOCKED = ["completing", "completed"];
const saleOpen = (_, { getState }) =>
  !SALE_LOCKED.includes(getState().posTerminal.status);

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
        session().clearDraftSaleId();
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
      session().clearDraftSaleId();
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
      !["loading", "discarding", ...SALE_LOCKED].includes(getState().posTerminal.status),
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
    if (err.gone) session().clearDraftSaleId();
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
  { condition: saleOpen },
);

/** arg: { lineId, quantity } */
export const updateLineQty = createAsyncThunk(
  "posTerminal/updateLineQty",
  saleMutation(
    "Couldn't change the quantity",
    (saleId, { lineId, quantity }) => updateSaleLine(saleId, lineId, { quantity }),
    ({ lineId }, sale) => sale.lines.find((l) => l.id === lineId)?.product_id,
  ),
  { condition: saleOpen },
);

/** arg: { lineId } — DELETE is 204, so re-fetch the sale. */
export const removeLine = createAsyncThunk(
  "posTerminal/removeLine",
  saleMutation("Couldn't remove the item", async (saleId, { lineId }) => {
    await removeSaleLine(saleId, lineId);
    return getSale(saleId);
  }),
  { condition: saleOpen },
);

// ---------------------------------------------------------------------------
// Thunks — customer
// ---------------------------------------------------------------------------

const isTradeIn = (payment) => payment.payment_method === "TRADE_IN";

// Recorded or still in flight (P4-11): a pending trade-in needs the
// customer as much as a recorded one.
const hasTradeInPayment = (posTerminal) =>
  (posTerminal.draftSale?.payments ?? []).some(isTradeIn) ||
  posTerminal.pendingPayments.some(isTradeIn);

/**
 * arg: { customer } — the picked customer row; the card shows it before
 * the PATCH lands.
 */
export const attachCustomer = createAsyncThunk(
  "posTerminal/attachCustomer",
  saleMutation("Couldn't attach the customer", (saleId, { customer }) =>
    updateSale(saleId, { customer_id: customer.id }),
  ),
  { condition: saleOpen },
);

/**
 * No arg. Refused (no request, no state change) while a TRADE_IN payment
 * exists, recorded or pending.
 */
export const detachCustomer = createAsyncThunk(
  "posTerminal/detachCustomer",
  saleMutation("Couldn't remove the customer", (saleId) =>
    updateSale(saleId, { customer_id: null }),
  ),
  {
    condition: (arg, api) =>
      saleOpen(arg, api) && !hasTradeInPayment(api.getState().posTerminal),
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
  // Refused before the customer is created, not just before the attach.
  { condition: saleOpen },
);

/**
 * arg: { nic } — PATCH the attached customer's NIC (P4-13: a trade-in
 * needs it). Queued like the sale mutations, so an older sale response
 * can't land after it with the NIC-less customer. Fulfils with the
 * updated customer; on a NIC clash (409) the rejection carries
 * `existing_customer_id`. The caller shows errors (nothing is kept in
 * customerError).
 */
export const saveCustomerNic = createAsyncThunk(
  "posTerminal/saveCustomerNic",
  async ({ nic }, { getState, rejectWithValue }) => {
    const customerId = getState().posTerminal.draftSale?.customer?.id;
    try {
      return await enqueue(() => updateCustomer(customerId, { nic }));
    } catch (error) {
      return rejectWithValue({
        ...toError(error, "Couldn't save the NIC"),
        existing_customer_id: error?.response?.data?.existing_customer_id ?? null,
      });
    }
  },
  { condition: saleOpen },
);

// ---------------------------------------------------------------------------
// Thunks — payments
// ---------------------------------------------------------------------------

/**
 * Record one tender. arg: the AddPaymentDto body —
 * { payment_method, amount, cash_received? (CASH), reference_number?,
 * trade_in_* (TRADE_IN) } — plus, for TRADE_IN, `trade_in_product`: the
 * picked catalog row. It only names the pending row (as the hydrated
 * sale's `trade_in_product` does) and is not sent.
 */
export const addPayment = createAsyncThunk(
  "posTerminal/addPayment",
  saleMutation("Couldn't record the payment", (saleId, payload) => {
    const body = { ...payload };
    delete body.trade_in_product;
    return addSalePayment(saleId, body);
  }),
  { condition: saleOpen },
);

/** arg: { paymentId } — DELETE is 204, so re-fetch the sale. */
export const removePayment = createAsyncThunk(
  "posTerminal/removePayment",
  saleMutation("Couldn't remove the payment", async (saleId, { paymentId }) => {
    await removeSalePayment(saleId, paymentId);
    return getSale(saleId);
  }),
  { condition: saleOpen },
);

/**
 * Re-read the draft from the server (P5-8: a complete refused because the
 * sale no longer matches what the terminal shows — no lines, or paid ≠
 * total). Queued like any edit; refused while completing / completed.
 */
export const reloadDraftSale = createAsyncThunk(
  "posTerminal/reloadDraftSale",
  saleMutation("Couldn't reload the sale", (saleId) => getSale(saleId)),
  { condition: saleOpen },
);

// ---------------------------------------------------------------------------
// Thunks — complete (P5)
// ---------------------------------------------------------------------------

// E6 names the phone's unit; the line selling that unit is the one to point at.
const withLineForUnit = (err, sale) => {
  if (err.kind !== COMPLETE_ERROR.UNIT_SOLD || !err.existing_unit) return err;
  const line = sale?.lines?.find((l) => l.product_unit_id === err.existing_unit.id);
  return { ...err, sale_line_id: line?.id ?? null };
};

/**
 * Complete the draft (P5-7). No arg.
 *
 * Runs once at a time: the `condition` only lets it start from "ready",
 * so a second dispatch while "completing" (double click, F9 + Enter) is
 * refused without a request. It is queued behind any line / payment edit
 * still in flight, and the recovery below runs inside the same queued
 * task, so nothing can change the sale in between.
 *
 * The backend completes at most once, so a lost answer is resolved by
 * asking: on no response, a timeout, a 5xx or E2 ("Cannot complete a
 * COMPLETED sale") it re-fetches the sale —
 * - COMPLETED → fulfilled with that sale, as if the answer had arrived
 * - DRAFT → rejected with the error; completing again is safe
 * - VOIDED or 404 → rejected with `gone: true` (as for any vanished draft)
 * - the re-fetch fails too → rejected with `unconfirmed: true`; completing
 *   again is still safe (it either completes or gets E2 and recovers)
 *
 * Rejections carry the classified error (utils/completeErrors.js). On
 * success the draft pointer is cleared and the sale becomes
 * `lastCompletedSale` (its id persisted for "Reprint last receipt");
 * opening the next draft is the terminal's job (P5-10).
 */
export const completeSale = createAsyncThunk(
  "posTerminal/completeSale",
  async (_, { getState, rejectWithValue }) => {
    const saleId = getState().posTerminal.draftSaleId;
    const outcome = await enqueue(async () => {
      try {
        return { sale: await completeSaleRequest(saleId) };
      } catch (error) {
        const err = withLineForUnit(
          classifyCompleteError(error),
          getState().posTerminal.draftSale,
        );
        if (err.kind === COMPLETE_ERROR.NOT_FOUND) return { error: { ...err, gone: true } };
        if (!err.reconcile) return { error: err };
        try {
          const sale = await getSale(saleId);
          if (sale.status === "COMPLETED") return { sale };
          if (sale.status === "DRAFT") return { error: err };
          return { error: { ...err, gone: true } };
        } catch (fetchError) {
          if (fetchError?.response?.status === 404) return { error: { ...err, gone: true } };
          return { error: { ...err, unconfirmed: true } };
        }
      }
    });

    if (outcome.error) {
      if (outcome.error.gone) session().clearDraftSaleId();
      return rejectWithValue(outcome.error);
    }
    session().clearDraftSaleId();
    session().setLastCompletedSaleId(outcome.sale.id);
    return outcome.sale;
  },
  {
    condition: (_, { getState }) => {
      const { status, draftSaleId } = getState().posTerminal;
      return status === "ready" && !!draftSaleId;
    },
  },
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
  // Draft lifecycle: idle | loading | ready | discarding | completing |
  // completed | error | gone
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
  // The sale this terminal last completed (P5-9, P5-12)
  lastCompletedSale: null,
  // Last complete failure, classified (utils/completeErrors.js) | null
  completeError: null,
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

// The trade_in_* fields of a pending TRADE_IN row, shaped like the
// hydrated sale's (money as "40000.00" strings, product as { id, name }).
const pendingTradeIn = ({
  trade_in_product,
  trade_in_product_id,
  trade_in_imei,
  trade_in_buying_price,
  trade_in_selling_price,
  trade_in_notes,
}) => ({
  trade_in_product_id,
  trade_in_product: trade_in_product
    ? { id: trade_in_product.id, name: trade_in_product.name }
    : null,
  trade_in_imei,
  trade_in_buying_price: fromCents(toCents(trade_in_buying_price)),
  trade_in_selling_price:
    trade_in_selling_price === undefined ? null : fromCents(toCents(trade_in_selling_price)),
  trade_in_notes: trade_in_notes ?? null,
});

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
    clearCompleteError: (state) => {
      state.completeError = null;
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
      state.completeError = null;
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
      .addCase(saveCustomerNic.fulfilled, (state, action) => {
        const customer = state.draftSale?.customer;
        if (customer?.id === action.payload.id) Object.assign(customer, action.payload);
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
          ...(payment_method === "TRADE_IN" ? pendingTradeIn(action.meta.arg) : {}),
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

      // Complete (P5-7) — the cart stays on screen while "completing"
      .addCase(completeSale.pending, (state) => {
        state.status = "completing";
        state.completeError = null;
      })
      .addCase(completeSale.fulfilled, (state, action) => {
        state.status = "completed";
        state.lastCompletedSale = action.payload;
        state.draftSale = null;
        state.draftSaleId = null;
        state.pendingLines = [];
        state.busyLineIds = [];
        state.lineError = null;
        state.pendingPayments = [];
        state.removingPaymentIds = [];
        state.paymentError = null;
      })
      .addCase(completeSale.rejected, (state, action) => {
        state.completeError = action.payload || {
          kind: COMPLETE_ERROR.REJECTED,
          message: "Couldn't complete the sale",
          status: null,
          reconcile: false,
        };
        state.status = "ready";
        markGone(state, action.payload);
      })

      .addCase(reloadDraftSale.fulfilled, (state, action) => {
        replaceSale(state, action.payload);
      })
      .addCase(reloadDraftSale.rejected, (state, action) => {
        applyRejection(state, action.payload, "Couldn't reload the sale");
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
      })

      // P5-8: a complete error (and the line / payment it highlights)
      // stands until the cashier changes the sale.
      .addMatcher(
        isAnyOf(
          addLine.fulfilled,
          updateLineQty.fulfilled,
          removeLine.fulfilled,
          addPayment.fulfilled,
          removePayment.fulfilled,
          attachCustomer.fulfilled,
          detachCustomer.fulfilled,
          saveCustomerNic.fulfilled,
        ),
        (state) => {
          state.completeError = null;
        },
      );
  },
});

export const {
  clearPosTerminal,
  clearLineError,
  clearCustomerError,
  clearPaymentError,
  clearCompleteError,
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
/**
 * Q19 / P4-11: a TRADE_IN payment (recorded or pending) needs the
 * customer — detach and change are blocked.
 */
export const selectHasTradeInPayment = (state) =>
  hasTradeInPayment(state.posTerminal);
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

/**
 * IMEIs on this sale's trade-ins, recorded and pending (P4-7: a second
 * trade-in can't reuse one). One being removed is left out: its DELETE
 * is queued ahead of any new payment.
 */
export const selectTradeInImeis = createSelector([selectPayments], (payments) =>
  payments.filter(isTradeIn).map((p) => p.trade_in_imei),
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

/**
 * The Pay button and F4 share this: an open draft with lines, a balance
 * left, and no line / payment mutation in flight (the balance would be
 * stale or about to change).
 */
export const selectCanPay = (state) =>
  state.posTerminal.status === "ready" &&
  (state.posTerminal.draftSale?.lines?.length ?? 0) > 0 &&
  selectBalanceDueCents(state) > 0 &&
  !selectCartSyncing(state);

/**
 * Fully paid per the last confirmed server sale. Deliberately ignores
 * in-flight mutations: the Totals panel dims it instead of swapping it
 * for a disabled "Pay LKR 0.00".
 */
export const selectReadyToComplete = (state) =>
  state.posTerminal.status === "ready" && selectIsFullyPaid(state);

/**
 * The Complete sale button and F9 (P5-3, P5-4): fully paid per the
 * server, and no line / payment mutation in flight (the totals are about
 * to change).
 */
export const selectCanComplete = (state) =>
  selectReadyToComplete(state) && !selectCartSyncing(state);

export const selectIsCompleting = (state) =>
  state.posTerminal.status === "completing";

/** Classified complete failure (utils/completeErrors.js), or null. */
export const selectCompleteError = (state) => state.posTerminal.completeError;

const ISSUE_LABELS = {
  [COMPLETE_ERROR.OUT_OF_STOCK]: "Not enough stock",
  [COMPLETE_ERROR.UNIT_SOLD]: "Sold on another sale",
  [COMPLETE_ERROR.TRADE_IN_IMEI_IN_STOCK]: "Already in stock",
  [COMPLETE_ERROR.TRADE_IN_PRODUCT_INACTIVE]: "Product inactive",
};

const NO_ISSUE = { lineIds: [], paymentIds: [], label: null };

/**
 * What the last complete error points at (P5-8): the cart lines and
 * payments to highlight, and a short label for them. Empty when there is
 * no complete error, or it isn't about a particular line or payment.
 *
 * - out of stock: the line from #32's sale_line_id (or every line of the
 *   product, from an older server without it)
 * - a line's phone sold elsewhere: the line selling that unit
 * - trade-in IMEI in stock: the payment from payment_id (or the trade-in
 *   with that IMEI)
 * - inactive trade-in product: the trade-ins on that product (the 400
 *   names the product, not the payment)
 */
export const selectCompleteIssue = createSelector(
  [selectCompleteError, selectDraftSale],
  (err, sale) => {
    if (!err || !sale) return NO_ISSUE;
    const lines = sale.lines ?? [];
    const tradeIns = (sale.payments ?? []).filter(isTradeIn);
    let lineIds = [];
    let paymentIds = [];
    switch (err.kind) {
      case COMPLETE_ERROR.OUT_OF_STOCK:
        lineIds = lines
          .filter((l) => (err.sale_line_id ? l.id === err.sale_line_id : l.product_id === err.product_id))
          .map((l) => l.id);
        break;
      case COMPLETE_ERROR.UNIT_SOLD:
        lineIds = err.sale_line_id ? [err.sale_line_id] : [];
        break;
      case COMPLETE_ERROR.TRADE_IN_IMEI_IN_STOCK:
        paymentIds = tradeIns
          .filter((p) => (err.payment_id ? p.id === err.payment_id : p.trade_in_imei === err.imei))
          .map((p) => p.id);
        break;
      case COMPLETE_ERROR.TRADE_IN_PRODUCT_INACTIVE:
        paymentIds = tradeIns
          .filter((p) => !err.product_name || p.trade_in_product?.name === err.product_name)
          .map((p) => p.id);
        break;
      default:
        return NO_ISSUE;
    }
    if (!lineIds.length && !paymentIds.length) return NO_ISSUE;
    return { lineIds, paymentIds, label: ISSUE_LABELS[err.kind] };
  },
);

/** The sale this terminal last completed (hydrated), or null. */
export const selectLastCompletedSale = (state) =>
  state.posTerminal.lastCompletedSale;

export default posTerminalSlice.reducer;
