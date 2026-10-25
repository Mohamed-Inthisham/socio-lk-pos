import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import {
  closeCashDay,
  getCashDay,
  getCashDaySummary,
  getCurrentCashDay,
  listCashDays,
  openCashDay,
} from "../../services/cashDaysService";
import {
  CASH_DAY_ERROR,
  CASH_DAY_OP,
  classifyCashDayError,
} from "../../utils/cashDayErrors";
import { differenceCents, needsReason } from "../../utils/cashDayMath";
import { fromCents, toCents } from "../../utils/money";
import { newClientRequestId } from "../../utils/requestId";

/**
 * Cash Day Slice
 *
 * The terminal branch's daily opening and closing balance (planning doc
 * section 8 "P9 decision log"; contract docs/backend/cash-days.md). The
 * server is the source of truth: the gate's status is always worked out
 * from GET /cash-days/current, and every figure is the server's.
 *
 * CURRENT (P9-7, P9-8):
 * fetchCurrentCashDay reads today, the oldest earlier day still open and
 * the last closed day. `current.status` is the day gate's: idle, loading,
 * no_day, earlier_open, open, closed or error. A late answer (a newer
 * read, a logout, a branch change) is ignored by `readId`. A re-read
 * keeps the status it had until the answer arrives (`reading`), so the
 * gate doesn't flash a spinner over the till; a failed re-read becomes
 * "error" and keeps the last figures.
 *
 * BRANCH: every read is for one branch. A read for another branch (an
 * admin picking a different one) starts from a clean state, as logout
 * does (clearCashDay, authSlice logoutUser).
 *
 * OPEN AND CLOSE (P9-18):
 * Each dialog starts with beginOpenDay / beginCloseDay (the close dialog
 * is open while close.dayId is set; endCloseDay ends it), which make its
 * client_request_id (utils/requestId.js). Every attempt from that dialog
 * sends the same id: Try again, the attempt after EXPECTED_CHANGED or
 * REASON_REQUIRED, the resend after a lost answer. Only the next begin…
 * makes a new one.
 *
 * - openDay: on success (201, a 200 resend, or found by the re-read) it
 *   re-reads current and the gate follows that, never the returned day:
 *   a resend after Colombo midnight gets yesterday's recorded day back.
 *   On no answer, a timeout or a 5xx it re-reads current: today there →
 *   fulfilled; none → rejected (Try again resends the same id).
 * - closeDay: on no answer, a timeout or a 5xx it re-reads the day
 *   (GET /cash-days/:id; current can't see an earlier day once it is
 *   closed): closed → fulfilled with it; still open, or the re-read
 *   failed → rejected with `close.unconfirmed` set. While unconfirmed the
 *   first send's body (`close.sentBody`) is resent unchanged, whatever
 *   the dialog passes, and the dialog keeps counted and reason read-only
 *   with only Try again (P9 step A review). A definite answer clears it.
 *   The server ignores the body of an accepted resend, so the dialog
 *   shows `close.closedDay`'s figures, never the form's.
 * - EXPECTED_CHANGED replaces `close.summary` with the fresh one from the
 *   409 body; nothing is resent until the user confirms again.
 *
 * DAY REFUSALS (P9-9): after a complete, void or return refused
 * DAY_NOT_OPEN / DAY_CLOSED, the dialog dispatches recheckCashDay as it
 * closes; the gate follows that read.
 *
 * Errors are classified by status and `code` (utils/cashDayErrors.js);
 * `refresh` ones (DAY_ALREADY_OPEN, EARLIER_DAY_NOT_CLOSED,
 * DAY_ALREADY_CLOSED, a missing day) re-read current.
 *
 * PAST DAYS (P9-16): fetchPastDays pages GET /cash-days; page 1 replaces
 * the list, later pages append.
 */

export const PAST_DAYS_LIMIT = 20;

export const GATE = {
  IDLE: "idle",
  LOADING: "loading",
  NO_DAY: "no_day",
  EARLIER_OPEN: "earlier_open",
  OPEN: "open",
  CLOSED: "closed",
  ERROR: "error",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The gate's status from a GET /cash-days/current answer. today and
 * earlier_open are never both set: the server refuses an opening while
 * an earlier day is open.
 */
export const gateStatusOf = ({ today, earlier_open }) => {
  if (today?.closed_at) return GATE.CLOSED;
  if (today) return GATE.OPEN;
  if (earlier_open) return GATE.EARLIER_OPEN;
  return GATE.NO_DAY;
};

// Cents → the number the DTOs take (at most 2 decimals, exactly).
const toAmount = (cents) => Number(fromCents(cents));

/**
 * POST /cash-days/:id/close's body. expected_seen is the server's
 * expected_balance as shown; difference_reason goes only when the reason
 * box shows (1.00 or more either way, the rounding rule).
 */
const buildCloseBody = (close, countedCents, reason) => {
  const expected = close.summary.expected_balance;
  return {
    counted_balance: toAmount(countedCents),
    expected_seen: toAmount(toCents(expected)),
    ...(needsReason(differenceCents(countedCents, expected))
      ? { difference_reason: reason ?? "" }
      : {}),
    client_request_id: close.clientRequestId,
  };
};

// A thunk that threw instead of rejecting with a classified error.
const fallbackError = (action, op) =>
  action.payload ?? {
    kind: CASH_DAY_ERROR.REJECTED,
    op,
    message: action.error?.message || "The cash day request failed",
    status: null,
    reconcile: false,
    refresh: false,
    blocks: false,
    field: null,
  };

const initialCurrent = () => ({
  status: GATE.IDLE,
  reading: false,
  readId: null,
  businessDate: null,
  today: null,
  earlierOpen: null,
  lastClosed: null,
  error: null,
});

const initialOpen = () => ({
  clientRequestId: null,
  status: "idle", // idle | submitting | error
  sendId: null,
  error: null,
});

const initialClose = () => ({
  dayId: null,
  clientRequestId: null,
  summaryStatus: "idle", // idle | loading | ready | error
  summaryReadId: null,
  summary: null,
  summaryError: null,
  status: "idle", // idle | submitting | closed | error
  sendId: null,
  sentBody: null,
  unconfirmed: false,
  error: null,
  closedDay: null,
});

const initialPastDays = () => ({
  status: "idle", // idle | loading | ready | error
  readId: null,
  items: [],
  meta: null,
  error: null,
});

const freshState = () => ({
  branchId: null,
  current: initialCurrent(),
  open: initialOpen(),
  close: initialClose(),
  pastDays: initialPastDays(),
});

// A read for another branch starts from a clean state.
const switchBranch = (state, branchId) => {
  if (state.branchId === branchId) return;
  Object.assign(state, freshState(), { branchId });
};

// ---------------------------------------------------------------------------
// Thunks
// ---------------------------------------------------------------------------

/** GET /cash-days/current for the gate (P9-7). */
export const fetchCurrentCashDay = createAsyncThunk(
  "cashDay/fetchCurrent",
  async ({ branchId }, { rejectWithValue }) => {
    try {
      return await getCurrentCashDay(branchId);
    } catch (error) {
      return rejectWithValue(classifyCashDayError(error, CASH_DAY_OP.CURRENT));
    }
  },
);

/**
 * Re-read current for the slice's branch after a complete, void or return
 * was refused DAY_NOT_OPEN / DAY_CLOSED (P9-7, P9-9; utils/dayRefusal.js).
 * The refused dialog dispatches it when it closes, so the cashier reads
 * why before the gate moves the till on. Resolves once the read settles;
 * nothing is read before any branch was.
 */
export const recheckCashDay = createAsyncThunk("cashDay/recheck", async (_, { dispatch, getState }) => {
  const { branchId } = getState().cashDay;
  if (branchId) await dispatch(fetchCurrentCashDay({ branchId }));
});

/**
 * Open today with the opening balance, in cents (P9-7). Resolves with
 * the day the server answered; the gate follows the re-read of current.
 */
export const openDay = createAsyncThunk(
  "cashDay/openDay",
  async ({ branchId, openingCents }, { dispatch, getState, rejectWithValue }) => {
    const payload = {
      branch_id: branchId,
      opening_balance: toAmount(openingCents),
      client_request_id: getState().cashDay.open.clientRequestId,
    };
    let day;
    try {
      day = await openCashDay(payload);
    } catch (error) {
      const err = classifyCashDayError(error, CASH_DAY_OP.OPEN);
      if (!err.reconcile) {
        if (err.refresh) dispatch(fetchCurrentCashDay({ branchId }));
        return rejectWithValue(err);
      }
      // P9-18: the answer was lost. Did today open?
      const reread = await dispatch(fetchCurrentCashDay({ branchId }));
      if (fetchCurrentCashDay.rejected.match(reread)) {
        return rejectWithValue({ ...err, rereadFailed: true });
      }
      if (!reread.payload.today) {
        return rejectWithValue({ ...err, rereadFailed: false });
      }
      return reread.payload.today;
    }
    // The gate follows current, not `day`: a resend after midnight
    // answers with yesterday's recorded day.
    await dispatch(fetchCurrentCashDay({ branchId }));
    return day;
  },
  {
    condition: (_, { getState }) => {
      const { open } = getState().cashDay;
      return !!open.clientRequestId && open.status !== "submitting";
    },
  },
);

/** GET /cash-days/:id/summary for the close dialog (P9-11). */
export const fetchCloseSummary = createAsyncThunk(
  "cashDay/fetchCloseSummary",
  async ({ dayId }, { rejectWithValue }) => {
    try {
      return await getCashDaySummary(dayId);
    } catch (error) {
      return rejectWithValue(classifyCashDayError(error, CASH_DAY_OP.SUMMARY));
    }
  },
);

/**
 * Close the dialog's day with the counted cash, in cents, and the reason
 * typed (P9-11). The body is made once, before the request, in
 * getPendingMeta, and kept as `close.sentBody`; while the close is
 * unconfirmed the kept body is sent again and the arguments are ignored.
 */
export const closeDay = createAsyncThunk(
  "cashDay/closeDay",
  async (_, { dispatch, getState, rejectWithValue }) => {
    const { branchId, close } = getState().cashDay;
    const { dayId, sentBody } = close;
    const refreshCurrent = () => {
      if (branchId) dispatch(fetchCurrentCashDay({ branchId }));
    };
    try {
      const day = await closeCashDay(dayId, sentBody);
      refreshCurrent();
      return day;
    } catch (error) {
      const err = classifyCashDayError(error, CASH_DAY_OP.CLOSE);
      if (!err.reconcile) {
        if (err.refresh) refreshCurrent();
        return rejectWithValue(err);
      }
      // P9-18: the answer was lost. Did the day close?
      let day;
      try {
        day = await getCashDay(dayId);
      } catch {
        return rejectWithValue({ ...err, rereadFailed: true });
      }
      if (!day.closed_at) return rejectWithValue({ ...err, rereadFailed: false });
      refreshCurrent();
      return day;
    }
  },
  {
    condition: ({ countedCents } = {}, { getState }) => {
      const { close } = getState().cashDay;
      if (!close.dayId || !close.clientRequestId || !close.summary) return false;
      if (close.status === "submitting" || close.status === "closed") return false;
      return close.unconfirmed || Number.isInteger(countedCents);
    },
    getPendingMeta: ({ arg = {} }, { getState }) => {
      const { close } = getState().cashDay;
      return {
        body: close.unconfirmed
          ? close.sentBody
          : buildCloseBody(close, arg.countedCents, arg.reason),
      };
    },
  },
);

/** One page of GET /cash-days for Past days (P9-16). */
export const fetchPastDays = createAsyncThunk(
  "cashDay/fetchPastDays",
  async ({ branchId, page = 1 }, { rejectWithValue }) => {
    try {
      return await listCashDays({ branchId, page, limit: PAST_DAYS_LIMIT });
    } catch (error) {
      return rejectWithValue(classifyCashDayError(error, CASH_DAY_OP.LIST));
    }
  },
);

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const cashDaySlice = createSlice({
  name: "cashDay",
  initialState: freshState(),
  reducers: {
    clearCashDay: () => freshState(),
    beginOpenDay: {
      reducer: (state, action) => {
        state.open = { ...initialOpen(), clientRequestId: action.payload.clientRequestId };
      },
      prepare: () => ({ payload: { clientRequestId: newClientRequestId() } }),
    },
    beginCloseDay: {
      reducer: (state, action) => {
        state.close = {
          ...initialClose(),
          dayId: action.payload.dayId,
          clientRequestId: action.payload.clientRequestId,
        };
      },
      prepare: (dayId) => ({ payload: { dayId, clientRequestId: newClientRequestId() } }),
    },
    // The close dialog went away: Cancel, Esc or Done. A late answer to its
    // send or figures read is ignored (sendId / summaryReadId are cleared).
    endCloseDay: (state) => {
      state.close = initialClose();
    },
    clearOpenError: (state) => {
      state.open.error = null;
      if (state.open.status === "error") state.open.status = "idle";
    },
    // Leaves `unconfirmed` alone: only a definite answer clears it.
    clearCloseError: (state) => {
      state.close.error = null;
      if (state.close.status === "error") state.close.status = "idle";
    },
  },
  extraReducers: (builder) => {
    builder
      // Current (the gate)
      .addCase(fetchCurrentCashDay.pending, (state, action) => {
        switchBranch(state, action.meta.arg.branchId);
        const current = state.current;
        current.readId = action.meta.requestId;
        current.reading = true;
        if (current.status === GATE.IDLE || current.status === GATE.ERROR) {
          current.status = GATE.LOADING;
        }
      })
      .addCase(fetchCurrentCashDay.fulfilled, (state, action) => {
        const current = state.current;
        if (action.meta.requestId !== current.readId) return;
        const { business_date, today, earlier_open, last_closed } = action.payload;
        current.reading = false;
        current.businessDate = business_date;
        current.today = today;
        current.earlierOpen = earlier_open;
        current.lastClosed = last_closed;
        current.error = null;
        current.status = gateStatusOf(action.payload);
      })
      .addCase(fetchCurrentCashDay.rejected, (state, action) => {
        const current = state.current;
        if (action.meta.requestId !== current.readId) return;
        current.reading = false;
        current.status = GATE.ERROR;
        current.error = fallbackError(action, CASH_DAY_OP.CURRENT);
      })

      // Open
      .addCase(openDay.pending, (state, action) => {
        state.open.status = "submitting";
        state.open.sendId = action.meta.requestId;
        state.open.error = null;
      })
      .addCase(openDay.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.open.sendId) return;
        state.open.status = "idle";
      })
      .addCase(openDay.rejected, (state, action) => {
        if (action.meta.requestId !== state.open.sendId) return;
        state.open.status = "error";
        state.open.error = fallbackError(action, CASH_DAY_OP.OPEN);
      })

      // Close: the figures
      .addCase(fetchCloseSummary.pending, (state, action) => {
        if (action.meta.arg.dayId !== state.close.dayId) return;
        state.close.summaryStatus = "loading";
        state.close.summaryReadId = action.meta.requestId;
        state.close.summaryError = null;
      })
      .addCase(fetchCloseSummary.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.close.summaryReadId) return;
        state.close.summaryStatus = "ready";
        state.close.summary = action.payload;
      })
      .addCase(fetchCloseSummary.rejected, (state, action) => {
        if (action.meta.requestId !== state.close.summaryReadId) return;
        state.close.summaryStatus = "error";
        state.close.summaryError = fallbackError(action, CASH_DAY_OP.SUMMARY);
      })

      // Close: the send
      .addCase(closeDay.pending, (state, action) => {
        state.close.status = "submitting";
        state.close.sendId = action.meta.requestId;
        state.close.sentBody = action.meta.body;
        state.close.error = null;
      })
      .addCase(closeDay.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.close.sendId) return;
        state.close.status = "closed";
        state.close.closedDay = action.payload;
        state.close.unconfirmed = false;
        state.close.error = null;
      })
      .addCase(closeDay.rejected, (state, action) => {
        if (action.meta.requestId !== state.close.sendId) return;
        const error = fallbackError(action, CASH_DAY_OP.CLOSE);
        state.close.status = "error";
        state.close.error = error;
        state.close.unconfirmed = !!error.reconcile;
        if (!state.close.unconfirmed) state.close.sentBody = null;
        if (error.kind === CASH_DAY_ERROR.EXPECTED_CHANGED && error.summary) {
          state.close.summary = error.summary;
        }
      })

      // Past days
      .addCase(fetchPastDays.pending, (state, action) => {
        switchBranch(state, action.meta.arg.branchId);
        state.pastDays.status = "loading";
        state.pastDays.readId = action.meta.requestId;
        state.pastDays.error = null;
      })
      .addCase(fetchPastDays.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.pastDays.readId) return;
        const { data, meta } = action.payload;
        const firstPage = (action.meta.arg.page ?? 1) === 1;
        state.pastDays.status = "ready";
        state.pastDays.items = firstPage ? data : [...state.pastDays.items, ...data];
        state.pastDays.meta = meta;
      })
      .addCase(fetchPastDays.rejected, (state, action) => {
        if (action.meta.requestId !== state.pastDays.readId) return;
        state.pastDays.status = "error";
        state.pastDays.error = fallbackError(action, CASH_DAY_OP.LIST);
      });
  },
});

export const {
  clearCashDay,
  beginOpenDay,
  beginCloseDay,
  endCloseDay,
  clearOpenError,
  clearCloseError,
} = cashDaySlice.actions;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectCashDayCurrent = (state) => state.cashDay.current;
export const selectCashDayGate = (state) => state.cashDay.current.status;
export const selectOpenDay = (state) => state.cashDay.open;
export const selectCloseDay = (state) => state.cashDay.close;
export const selectCloseUnconfirmed = (state) => state.cashDay.close.unconfirmed;
export const selectPastDays = (state) => state.cashDay.pastDays;

export default cashDaySlice.reducer;
