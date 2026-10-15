import {
  createSlice,
  createAsyncThunk,
  createSelector,
} from "@reduxjs/toolkit";
import {
  addSaleLine,
  createSale,
  discardSale,
  getSale,
  removeSaleLine,
  updateSaleLine,
} from "../../services/salesService";
import {
  getProductByBarcode,
  listProducts,
} from "../../services/productsService";
import { listStock } from "../../services/stockService";
import useTerminalSessionStore from "../zustand/terminalSessionStore";

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
 * ORDERING:
 * Line mutations run one at a time through `enqueue`, so fast consecutive
 * scans reach the server in order and an older response can never
 * overwrite a newer sale (planning doc §6, scan queue).
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

const lineMutation = (fallback, run, stockProductId) => async (arg, { dispatch, getState, rejectWithValue }) => {
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
  lineMutation("Couldn't add the item", (saleId, { product, quantity = 1, imei }) =>
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
  lineMutation(
    "Couldn't change the quantity",
    (saleId, { lineId, quantity }) => updateSaleLine(saleId, lineId, { quantity }),
    ({ lineId }, sale) => sale.lines.find((l) => l.id === lineId)?.product_id,
  ),
);

/** arg: { lineId } — DELETE is 204, so re-fetch the sale. */
export const removeLine = createAsyncThunk(
  "posTerminal/removeLine",
  lineMutation("Couldn't remove the item", async (saleId, { lineId }) => {
    await removeSaleLine(saleId, lineId);
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
};

const markBusy = (state, lineId) => {
  if (!state.busyLineIds.includes(lineId)) state.busyLineIds.push(lineId);
};

const unmarkBusy = (state, lineId) => {
  state.busyLineIds = state.busyLineIds.filter((id) => id !== lineId);
};

const applyRejection = (state, payload, fallback) => {
  state.lineError = payload || { message: fallback };
  if (payload?.gone) {
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
        state.draftSale = action.payload;
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
        state.draftSale = action.payload;
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
        state.draftSale = action.payload;
      })
      .addCase(removeLine.rejected, (state, action) => {
        unmarkBusy(state, action.meta.arg.lineId);
        applyRejection(state, action.payload, "Couldn't remove the item");
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

export const { clearPosTerminal, clearLineError, clearScan } =
  posTerminalSlice.actions;

// Selectors
export const selectDraftSale = (state) => state.posTerminal.draftSale;
export const selectPosStatus = (state) => state.posTerminal.status;
export const selectPosError = (state) => state.posTerminal.error;
export const selectLineError = (state) => state.posTerminal.lineError;
export const selectScanState = (state) => state.posTerminal.scanState;
export const selectScanResults = (state) => state.posTerminal.scanResults;
export const selectScanQuery = (state) => state.posTerminal.scanQuery;
export const selectScanError = (state) => state.posTerminal.scanError;
const selectPendingLines = (state) => state.posTerminal.pendingLines;
const selectBusyLineIds = (state) => state.posTerminal.busyLineIds;

/** True while a line mutation is in flight — server totals are about to change. */
export const selectCartSyncing = (state) =>
  state.posTerminal.pendingLines.length > 0 ||
  state.posTerminal.busyLineIds.length > 0;

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

export default posTerminalSlice.reducer;
