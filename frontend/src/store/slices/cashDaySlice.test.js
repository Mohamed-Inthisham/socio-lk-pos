import { vi } from "vitest";
import { createTestStore } from "../../test/renderWithProviders";
import {
  GATE,
  PAST_DAYS_LIMIT,
  beginCloseDay,
  beginOpenDay,
  clearCashDay,
  clearCloseError,
  closeDay,
  endCloseDay,
  fetchCloseSummary,
  fetchCurrentCashDay,
  fetchPastDays,
  openDay,
  recheckCashDay,
} from "./cashDaySlice";
import * as service from "../../services/cashDaysService";
import { CASH_DAY_ERROR, CASH_DAY_OP } from "../../utils/cashDayErrors";
import {
  BRANCH_ID,
  cashDayNetworkError,
  cashDayServerError,
  cashDaySummaryEntity,
  cashDayTimeoutError,
  cashDayWrongBranchError,
  closedCashDayEntity,
  currentCashDayResponse,
  dayAlreadyClosedError,
  dayAlreadyOpenError,
  earlierDayNotClosedError,
  expectedChangedError,
  openCashDayEntity,
  pastDaysResponse,
  reasonRequiredError,
} from "../../test/cashDayEntities";

vi.mock("../../services/cashDaysService");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const cashDay = (store) => store.getState().cashDay;

const noDay = () => currentCashDayResponse();
const todayOpen = () => currentCashDayResponse({ today: openCashDayEntity() });
const todayClosed = () => currentCashDayResponse({ today: closedCashDayEntity() });

/** A store whose gate has read `current` once. */
const storeWithGate = async (current = noDay()) => {
  const store = createTestStore();
  service.getCurrentCashDay.mockResolvedValueOnce(current);
  await store.dispatch(fetchCurrentCashDay({ branchId: BRANCH_ID }));
  return store;
};

/** A store with today open and the close dialog showing its figures. */
const storeWithCloseDialog = async (summary = cashDaySummaryEntity()) => {
  const store = await storeWithGate(todayOpen());
  store.dispatch(beginCloseDay("day-1020"));
  service.getCashDaySummary.mockResolvedValueOnce(summary);
  await store.dispatch(fetchCloseSummary({ dayId: "day-1020" }));
  return store;
};

const openRequestIds = () => service.openCashDay.mock.calls.map(([payload]) => payload.client_request_id);
const closeBodies = () => service.closeCashDay.mock.calls.map(([, body]) => body);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("cashDaySlice recheckCashDay (after DAY_NOT_OPEN / DAY_CLOSED, P9-9)", () => {
  it("re-reads current for the slice's branch, and settles once the gate has the answer", async () => {
    const store = await storeWithGate(todayOpen());
    service.getCurrentCashDay.mockResolvedValueOnce(todayClosed());

    await store.dispatch(recheckCashDay());

    expect(service.getCurrentCashDay).toHaveBeenCalledTimes(2);
    expect(service.getCurrentCashDay).toHaveBeenLastCalledWith(BRANCH_ID);
    expect(cashDay(store).current.status).toBe(GATE.CLOSED);
  });

  it("reads nothing before any branch was read", async () => {
    const store = createTestStore();

    await store.dispatch(recheckCashDay());

    expect(service.getCurrentCashDay).not.toHaveBeenCalled();
    expect(cashDay(store).current.status).toBe(GATE.IDLE);
  });
});

describe("cashDaySlice fetchCurrentCashDay (the day gate, P9-7)", () => {
  it("no day: nothing opened today and no earlier day open, with the last closed day", async () => {
    const store = await storeWithGate(noDay());

    expect(service.getCurrentCashDay).toHaveBeenCalledWith(BRANCH_ID);
    expect(cashDay(store).branchId).toBe(BRANCH_ID);
    expect(cashDay(store).current).toMatchObject({
      status: GATE.NO_DAY,
      reading: false,
      businessDate: "2026-10-20",
      today: null,
      earlierOpen: null,
      lastClosed: { business_date: "2026-10-18", counted_balance: "4800.00" },
      error: null,
    });
  });

  it("open: today has a record that isn't closed", async () => {
    const store = await storeWithGate(todayOpen());
    expect(cashDay(store).current.status).toBe(GATE.OPEN);
    expect(cashDay(store).current.today).toEqual(openCashDayEntity());
  });

  it("closed: today's record is closed", async () => {
    const store = await storeWithGate(todayClosed());
    expect(cashDay(store).current.status).toBe(GATE.CLOSED);
  });

  it("earlier day open: an earlier day still open, nothing today", async () => {
    const store = await storeWithGate(
      currentCashDayResponse({ earlier_open: { id: "day-1019", business_date: "2026-10-19" } }),
    );
    expect(cashDay(store).current.status).toBe(GATE.EARLIER_OPEN);
    expect(cashDay(store).current.earlierOpen).toEqual({ id: "day-1019", business_date: "2026-10-19" });
  });

  it("loading on the first read; a re-read keeps the gate's status until it answers", async () => {
    const store = createTestStore();
    const first = deferred();
    service.getCurrentCashDay.mockReturnValueOnce(first.promise);
    const reading = store.dispatch(fetchCurrentCashDay({ branchId: BRANCH_ID }));
    expect(cashDay(store).current).toMatchObject({ status: GATE.LOADING, reading: true });
    first.resolve(todayOpen());
    await reading;

    const second = deferred();
    service.getCurrentCashDay.mockReturnValueOnce(second.promise);
    const rereading = store.dispatch(fetchCurrentCashDay({ branchId: BRANCH_ID }));
    expect(cashDay(store).current).toMatchObject({ status: GATE.OPEN, reading: true });
    second.resolve(todayClosed());
    await rereading;
    expect(cashDay(store).current).toMatchObject({ status: GATE.CLOSED, reading: false });
  });

  it("a failed read is an error with the classified cause; Try again reads again", async () => {
    const store = createTestStore();
    service.getCurrentCashDay.mockRejectedValueOnce(cashDayTimeoutError());
    await store.dispatch(fetchCurrentCashDay({ branchId: BRANCH_ID }));
    expect(cashDay(store).current.status).toBe(GATE.ERROR);
    expect(cashDay(store).current.error).toMatchObject({
      kind: CASH_DAY_ERROR.TIMEOUT,
      op: CASH_DAY_OP.CURRENT,
      reconcile: false,
    });

    const retry = deferred();
    service.getCurrentCashDay.mockReturnValueOnce(retry.promise);
    const reading = store.dispatch(fetchCurrentCashDay({ branchId: BRANCH_ID }));
    expect(cashDay(store).current.status).toBe(GATE.LOADING);
    retry.resolve(todayOpen());
    await reading;
    expect(cashDay(store).current).toMatchObject({ status: GATE.OPEN, error: null });
  });

  it("ignores a late answer from an older read", async () => {
    const store = createTestStore();
    const older = deferred();
    service.getCurrentCashDay.mockReturnValueOnce(older.promise).mockResolvedValueOnce(todayClosed());
    const olderRead = store.dispatch(fetchCurrentCashDay({ branchId: BRANCH_ID }));
    await store.dispatch(fetchCurrentCashDay({ branchId: BRANCH_ID }));
    older.resolve(noDay());
    await olderRead;

    expect(cashDay(store).current.status).toBe(GATE.CLOSED);
  });

  it("a read for another branch starts from a clean state", async () => {
    const store = await storeWithGate(todayOpen());
    store.dispatch(beginCloseDay("day-1020"));

    const other = deferred();
    service.getCurrentCashDay.mockReturnValueOnce(other.promise);
    const reading = store.dispatch(fetchCurrentCashDay({ branchId: "branch-other" }));
    expect(cashDay(store)).toMatchObject({
      branchId: "branch-other",
      current: { status: GATE.LOADING, today: null },
      close: { dayId: null, clientRequestId: null },
    });
    other.resolve(noDay());
    await reading;
    expect(cashDay(store).current.status).toBe(GATE.NO_DAY);
  });

  it("clearCashDay (logout) drops everything, and a late answer doesn't bring it back", async () => {
    const store = createTestStore();
    const late = deferred();
    service.getCurrentCashDay.mockReturnValueOnce(late.promise);
    const reading = store.dispatch(fetchCurrentCashDay({ branchId: BRANCH_ID }));
    store.dispatch(clearCashDay());
    late.resolve(todayOpen());
    await reading;

    expect(cashDay(store)).toEqual(createTestStore().getState().cashDay);
  });
});

describe("cashDaySlice openDay (P9-7, P9-18)", () => {
  it("sends the branch, the opening balance as a number and the dialog's request id, then re-reads current", async () => {
    const store = await storeWithGate(noDay());
    store.dispatch(beginOpenDay());
    const id = cashDay(store).open.clientRequestId;
    expect(id).toMatch(UUID);
    service.openCashDay.mockResolvedValueOnce(openCashDayEntity({ opening_balance: "5000.50" }));
    service.getCurrentCashDay.mockResolvedValueOnce(todayOpen());

    const result = await store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 500050 }));

    expect(openDay.fulfilled.match(result)).toBe(true);
    expect(service.openCashDay).toHaveBeenCalledWith({
      branch_id: BRANCH_ID,
      opening_balance: 5000.5,
      client_request_id: id,
    });
    expect(service.getCurrentCashDay).toHaveBeenCalledTimes(2);
    expect(cashDay(store).open).toMatchObject({ status: "idle", error: null });
    expect(cashDay(store).current.status).toBe(GATE.OPEN);
  });

  it("an opening of 0 goes out as 0", async () => {
    const store = await storeWithGate(noDay());
    store.dispatch(beginOpenDay());
    service.openCashDay.mockResolvedValueOnce(openCashDayEntity({ opening_balance: "0.00" }));
    service.getCurrentCashDay.mockResolvedValueOnce(todayOpen());

    await store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 0 }));
    expect(service.openCashDay.mock.calls[0][0].opening_balance).toBe(0);
  });

  it("the gate follows current, not the returned day: a resend after midnight that returns yesterday's day", async () => {
    const store = await storeWithGate(noDay());
    store.dispatch(beginOpenDay());
    // The 200 resend answers with the day recorded for this id: 20 Oct's.
    service.openCashDay.mockResolvedValueOnce(openCashDayEntity({ business_date: "2026-10-20" }));
    // Current says it is already 21 Oct, with nothing opened.
    service.getCurrentCashDay.mockResolvedValueOnce(
      currentCashDayResponse({
        business_date: "2026-10-21",
        earlier_open: { id: "day-1020", business_date: "2026-10-20" },
      }),
    );

    await store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 500000 }));

    expect(cashDay(store).current).toMatchObject({
      status: GATE.EARLIER_OPEN,
      businessDate: "2026-10-21",
      today: null,
      earlierOpen: { id: "day-1020", business_date: "2026-10-20" },
    });
  });

  it("sends nothing without beginOpenDay, or while an opening is being sent", async () => {
    const store = await storeWithGate(noDay());
    await store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 100 }));
    expect(service.openCashDay).not.toHaveBeenCalled();

    store.dispatch(beginOpenDay());
    const pending = deferred();
    service.openCashDay.mockReturnValueOnce(pending.promise);
    service.getCurrentCashDay.mockResolvedValue(todayOpen());
    const first = store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 100 }));
    await store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 100 }));
    expect(service.openCashDay).toHaveBeenCalledTimes(1);
    pending.resolve(openCashDayEntity());
    await first;
  });

  it("EARLIER_DAY_NOT_CLOSED: refused, and the gate re-reads into the earlier day", async () => {
    const store = await storeWithGate(noDay());
    store.dispatch(beginOpenDay());
    service.openCashDay.mockRejectedValueOnce(earlierDayNotClosedError());
    service.getCurrentCashDay.mockResolvedValueOnce(
      currentCashDayResponse({ earlier_open: { id: "day-1019", business_date: "2026-10-19" } }),
    );

    const result = await store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 500000 }));
    await vi.waitFor(() => expect(cashDay(store).current.status).toBe(GATE.EARLIER_OPEN));

    expect(result.payload).toMatchObject({ kind: CASH_DAY_ERROR.EARLIER_NOT_CLOSED, business_date: "2026-10-19" });
    expect(cashDay(store).open).toMatchObject({ status: "error", error: { kind: CASH_DAY_ERROR.EARLIER_NOT_CLOSED } });
  });

  it("DAY_ALREADY_OPEN: refused, and the gate re-reads into the open day", async () => {
    const store = await storeWithGate(noDay());
    store.dispatch(beginOpenDay());
    service.openCashDay.mockRejectedValueOnce(dayAlreadyOpenError());
    service.getCurrentCashDay.mockResolvedValueOnce(todayOpen());

    await store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 500000 }));
    await vi.waitFor(() => expect(cashDay(store).current.status).toBe(GATE.OPEN));
    expect(cashDay(store).open.error.kind).toBe(CASH_DAY_ERROR.ALREADY_OPEN);
  });

  it("a 403 is refused and blocks, with no re-read", async () => {
    const store = await storeWithGate(noDay());
    store.dispatch(beginOpenDay());
    service.openCashDay.mockRejectedValueOnce(cashDayWrongBranchError());

    await store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 500000 }));

    expect(cashDay(store).open.error).toMatchObject({ kind: CASH_DAY_ERROR.WRONG_BRANCH, blocks: true });
    expect(service.getCurrentCashDay).toHaveBeenCalledTimes(1);
  });

  it("a lost answer, and the re-read finds today open: fulfilled, nothing resent", async () => {
    const store = await storeWithGate(noDay());
    store.dispatch(beginOpenDay());
    service.openCashDay.mockRejectedValueOnce(cashDayTimeoutError());
    service.getCurrentCashDay.mockResolvedValueOnce(todayOpen());

    const result = await store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 500000 }));

    expect(openDay.fulfilled.match(result)).toBe(true);
    expect(result.payload).toEqual(openCashDayEntity());
    expect(service.openCashDay).toHaveBeenCalledTimes(1);
    expect(cashDay(store).open).toMatchObject({ status: "idle", error: null });
    expect(cashDay(store).current.status).toBe(GATE.OPEN);
  });

  it("a lost answer, and today isn't there: refused; Try again resends the same id", async () => {
    const store = await storeWithGate(noDay());
    store.dispatch(beginOpenDay());
    service.openCashDay.mockRejectedValueOnce(cashDayServerError());
    service.getCurrentCashDay.mockResolvedValueOnce(noDay());

    await store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 500000 }));
    expect(cashDay(store).open.error).toMatchObject({
      kind: CASH_DAY_ERROR.SERVER,
      reconcile: true,
      rereadFailed: false,
    });
    expect(cashDay(store).current.status).toBe(GATE.NO_DAY);

    service.openCashDay.mockResolvedValueOnce(openCashDayEntity());
    service.getCurrentCashDay.mockResolvedValueOnce(todayOpen());
    await store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 500000 }));
    const [first, second] = openRequestIds();
    expect(second).toBe(first);
    expect(cashDay(store).current.status).toBe(GATE.OPEN);
  });

  it("a lost answer, and the re-read fails too: refused as unconfirmed, the gate in error", async () => {
    const store = await storeWithGate(noDay());
    store.dispatch(beginOpenDay());
    service.openCashDay.mockRejectedValueOnce(cashDayNetworkError());
    service.getCurrentCashDay.mockRejectedValueOnce(cashDayNetworkError());

    await store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 500000 }));

    expect(cashDay(store).open.error).toMatchObject({ kind: CASH_DAY_ERROR.NETWORK, rereadFailed: true });
    expect(cashDay(store).current.status).toBe(GATE.ERROR);
  });

  it("one request id per dialog: the same on every send from it, a new one on the next beginOpenDay", async () => {
    const store = await storeWithGate(noDay());
    store.dispatch(beginOpenDay());
    service.getCurrentCashDay.mockResolvedValue(noDay());
    service.openCashDay
      .mockRejectedValueOnce(cashDayTimeoutError())
      .mockRejectedValueOnce(cashDayServerError())
      .mockRejectedValueOnce(cashDayNetworkError());
    for (let i = 0; i < 3; i += 1) {
      await store.dispatch(openDay({ branchId: BRANCH_ID, openingCents: 500000 }));
    }
    const ids = openRequestIds();
    expect(new Set(ids).size).toBe(1);

    store.dispatch(beginOpenDay());
    expect(cashDay(store).open).toMatchObject({ status: "idle", error: null });
    expect(cashDay(store).open.clientRequestId).toMatch(UUID);
    expect(cashDay(store).open.clientRequestId).not.toBe(ids[0]);
  });
});

describe("cashDaySlice close (P9-11, P9-18)", () => {
  it("beginCloseDay makes the dialog's request id; fetchCloseSummary loads the figures", async () => {
    const store = await storeWithGate(todayOpen());
    store.dispatch(beginCloseDay("day-1020"));
    expect(cashDay(store).close).toMatchObject({ dayId: "day-1020", summaryStatus: "idle", unconfirmed: false });
    expect(cashDay(store).close.clientRequestId).toMatch(UUID);

    service.getCashDaySummary.mockResolvedValueOnce(cashDaySummaryEntity());
    await store.dispatch(fetchCloseSummary({ dayId: "day-1020" }));
    expect(service.getCashDaySummary).toHaveBeenCalledWith("day-1020");
    expect(cashDay(store).close).toMatchObject({ summaryStatus: "ready", summary: cashDaySummaryEntity() });
  });

  it("a failed figures read is the summary's error; a read for another day is ignored", async () => {
    const store = await storeWithGate(todayOpen());
    store.dispatch(beginCloseDay("day-1020"));
    service.getCashDaySummary.mockRejectedValueOnce(cashDayTimeoutError());
    await store.dispatch(fetchCloseSummary({ dayId: "day-1020" }));
    expect(cashDay(store).close).toMatchObject({
      summaryStatus: "error",
      summaryError: { kind: CASH_DAY_ERROR.TIMEOUT, op: CASH_DAY_OP.SUMMARY },
    });

    service.getCashDaySummary.mockResolvedValueOnce(cashDaySummaryEntity({ cash_day_id: "day-1019" }));
    await store.dispatch(fetchCloseSummary({ dayId: "day-1019" }));
    expect(cashDay(store).close.summary).toBeNull();
  });

  it("sends the counted cash and expected_seen as numbers, the reason from 1.00, then re-reads current", async () => {
    const store = await storeWithCloseDialog();
    const id = cashDay(store).close.clientRequestId;
    service.closeCashDay.mockResolvedValueOnce(closedCashDayEntity());
    service.getCurrentCashDay.mockResolvedValueOnce(todayClosed());

    const result = await store.dispatch(closeDay({ countedCents: 1540000, reason: "Coins short at count" }));

    expect(closeDay.fulfilled.match(result)).toBe(true);
    expect(service.closeCashDay).toHaveBeenCalledWith("day-1020", {
      counted_balance: 15400,
      expected_seen: 15500,
      difference_reason: "Coins short at count",
      client_request_id: id,
    });
    expect(cashDay(store).close).toMatchObject({
      status: "closed",
      closedDay: closedCashDayEntity(),
      unconfirmed: false,
      error: null,
    });
    await vi.waitFor(() => expect(cashDay(store).current.status).toBe(GATE.CLOSED));
  });

  it("the rounding rule: under 1.00 either way no reason is sent, whatever was typed", async () => {
    const store = await storeWithCloseDialog();
    service.closeCashDay.mockResolvedValueOnce(closedCashDayEntity({ counted_balance: "15499.50", difference: "-0.50" }));
    service.getCurrentCashDay.mockResolvedValue(todayClosed());

    await store.dispatch(closeDay({ countedCents: 1549950, reason: "Coins" }));

    expect(closeBodies()[0]).not.toHaveProperty("difference_reason");
    expect(closeBodies()[0].counted_balance).toBe(15499.5);
  });

  it("a negative expected goes out as expected_seen as it is", async () => {
    const store = await storeWithCloseDialog(cashDaySummaryEntity({ expected_balance: "-25.00" }));
    service.closeCashDay.mockResolvedValueOnce(closedCashDayEntity());
    service.getCurrentCashDay.mockResolvedValue(todayClosed());

    await store.dispatch(closeDay({ countedCents: 0, reason: "Refund paid from the float" }));

    expect(closeBodies()[0]).toMatchObject({
      counted_balance: 0,
      expected_seen: -25,
      difference_reason: "Refund paid from the float",
    });
  });

  it("keeps the returned day, not the form: an accepted resend answers with what was recorded", async () => {
    const store = await storeWithCloseDialog();
    const recorded = closedCashDayEntity({ counted_balance: "15500.00", difference: "0.00", difference_reason: null });
    service.closeCashDay.mockResolvedValueOnce(recorded);
    service.getCurrentCashDay.mockResolvedValue(todayClosed());

    await store.dispatch(closeDay({ countedCents: 1540000, reason: "Coins short at count" }));

    expect(cashDay(store).close.closedDay).toEqual(recorded);
  });

  it("sends nothing without the figures, without a counted amount, or while a close is being sent", async () => {
    const store = await storeWithGate(todayOpen());
    store.dispatch(beginCloseDay("day-1020"));
    await store.dispatch(closeDay({ countedCents: 1550000 }));
    expect(service.closeCashDay).not.toHaveBeenCalled();

    service.getCashDaySummary.mockResolvedValueOnce(cashDaySummaryEntity());
    await store.dispatch(fetchCloseSummary({ dayId: "day-1020" }));
    await store.dispatch(closeDay({ countedCents: NaN }));
    expect(service.closeCashDay).not.toHaveBeenCalled();

    const pending = deferred();
    service.closeCashDay.mockReturnValueOnce(pending.promise);
    service.getCurrentCashDay.mockResolvedValue(todayClosed());
    const first = store.dispatch(closeDay({ countedCents: 1550000 }));
    await store.dispatch(closeDay({ countedCents: 1550000 }));
    expect(service.closeCashDay).toHaveBeenCalledTimes(1);
    pending.resolve(closedCashDayEntity());
    await first;

    await store.dispatch(closeDay({ countedCents: 1550000 }));
    expect(service.closeCashDay).toHaveBeenCalledTimes(1);
  });

  it("EXPECTED_CHANGED replaces the figures with the fresh ones and resends nothing; the next confirm sends the new expected with the same id", async () => {
    const store = await storeWithCloseDialog();
    const id = cashDay(store).close.clientRequestId;
    service.closeCashDay.mockRejectedValueOnce(expectedChangedError());

    await store.dispatch(closeDay({ countedCents: 1550000 }));

    expect(service.closeCashDay).toHaveBeenCalledTimes(1);
    expect(cashDay(store).close).toMatchObject({
      status: "error",
      error: { kind: CASH_DAY_ERROR.EXPECTED_CHANGED },
      summary: expectedChangedError().response.data.summary,
      unconfirmed: false,
      sentBody: null,
    });

    service.closeCashDay.mockResolvedValueOnce(closedCashDayEntity());
    service.getCurrentCashDay.mockResolvedValue(todayClosed());
    await store.dispatch(closeDay({ countedCents: 1750000 }));
    expect(closeBodies()[1]).toEqual({ counted_balance: 17500, expected_seen: 17500, client_request_id: id });
  });

  it("REASON_REQUIRED: beside the reason box, with the server's difference; not unconfirmed", async () => {
    const store = await storeWithCloseDialog();
    service.closeCashDay.mockRejectedValueOnce(reasonRequiredError("-1500.00"));

    await store.dispatch(closeDay({ countedCents: 1400000, reason: "" }));

    expect(closeBodies()[0].difference_reason).toBe("");
    expect(cashDay(store).close).toMatchObject({
      status: "error",
      unconfirmed: false,
      error: { kind: CASH_DAY_ERROR.REASON_REQUIRED, field: "reason", difference_cents: -150000 },
    });
  });

  it("DAY_ALREADY_CLOSED: refused, and the gate re-reads into the closed day", async () => {
    const store = await storeWithCloseDialog();
    service.closeCashDay.mockRejectedValueOnce(dayAlreadyClosedError());
    service.getCurrentCashDay.mockResolvedValueOnce(todayClosed());

    await store.dispatch(closeDay({ countedCents: 1550000 }));

    expect(cashDay(store).close.error).toMatchObject({ kind: CASH_DAY_ERROR.ALREADY_CLOSED, blocks: true });
    await vi.waitFor(() => expect(cashDay(store).current.status).toBe(GATE.CLOSED));
  });

  it("a lost answer, and GET /cash-days/:id shows it closed: fulfilled with that day, nothing resent", async () => {
    const store = await storeWithCloseDialog();
    service.closeCashDay.mockRejectedValueOnce(cashDayTimeoutError());
    service.getCashDay.mockResolvedValueOnce(closedCashDayEntity());
    service.getCurrentCashDay.mockResolvedValueOnce(todayClosed());

    const result = await store.dispatch(closeDay({ countedCents: 1540000, reason: "Coins short at count" }));

    expect(closeDay.fulfilled.match(result)).toBe(true);
    expect(service.getCashDay).toHaveBeenCalledWith("day-1020");
    expect(service.closeCashDay).toHaveBeenCalledTimes(1);
    expect(cashDay(store).close).toMatchObject({ status: "closed", closedDay: closedCashDayEntity(), unconfirmed: false });
    await vi.waitFor(() => expect(cashDay(store).current.status).toBe(GATE.CLOSED));
  });

  it("a lost answer, and the day is still open: unconfirmed", async () => {
    const store = await storeWithCloseDialog();
    service.closeCashDay.mockRejectedValueOnce(cashDayServerError());
    service.getCashDay.mockResolvedValueOnce(openCashDayEntity());

    await store.dispatch(closeDay({ countedCents: 1540000, reason: "Coins short at count" }));

    expect(cashDay(store).close).toMatchObject({
      status: "error",
      unconfirmed: true,
      error: { kind: CASH_DAY_ERROR.SERVER, reconcile: true, rereadFailed: false },
    });
  });

  it("while unconfirmed the resend carries the first send's body and id, whatever the dialog passes", async () => {
    const store = await storeWithCloseDialog();
    service.closeCashDay.mockRejectedValueOnce(cashDayNetworkError());
    service.getCashDay.mockRejectedValueOnce(cashDayNetworkError());

    await store.dispatch(closeDay({ countedCents: 1540000, reason: "Coins short at count" }));
    expect(cashDay(store).close).toMatchObject({
      unconfirmed: true,
      error: { kind: CASH_DAY_ERROR.NETWORK, rereadFailed: true },
    });
    const firstBody = cashDay(store).close.sentBody;

    service.closeCashDay.mockResolvedValueOnce(closedCashDayEntity());
    service.getCurrentCashDay.mockResolvedValue(todayClosed());
    await store.dispatch(closeDay({ countedCents: 1550000, reason: "Something else" }));

    expect(closeBodies()[1]).toEqual(firstBody);
    expect(closeBodies()[1]).toMatchObject({ counted_balance: 15400, difference_reason: "Coins short at count" });
    expect(cashDay(store).close).toMatchObject({ status: "closed", unconfirmed: false });
  });

  it("a definite answer to a resend ends unconfirmed; clearCloseError doesn't", async () => {
    const store = await storeWithCloseDialog();
    service.closeCashDay.mockRejectedValueOnce(cashDayTimeoutError());
    service.getCashDay.mockResolvedValueOnce(openCashDayEntity());
    await store.dispatch(closeDay({ countedCents: 1540000, reason: "Coins short at count" }));

    store.dispatch(clearCloseError());
    expect(cashDay(store).close).toMatchObject({ status: "idle", error: null, unconfirmed: true });

    service.closeCashDay.mockRejectedValueOnce(expectedChangedError());
    await store.dispatch(closeDay());
    expect(cashDay(store).close).toMatchObject({ unconfirmed: false, sentBody: null });
  });

  it("endCloseDay ends the dialog, and a late answer to its send is ignored", async () => {
    const store = await storeWithCloseDialog();
    const pending = deferred();
    service.closeCashDay.mockReturnValueOnce(pending.promise);
    service.getCurrentCashDay.mockResolvedValue(todayClosed());
    const sending = store.dispatch(closeDay({ countedCents: 1550000 }));

    store.dispatch(endCloseDay());
    expect(cashDay(store).close).toMatchObject({ dayId: null, clientRequestId: null, summary: null, status: "idle" });
    pending.resolve(closedCashDayEntity());
    await sending;

    expect(cashDay(store).close).toMatchObject({ dayId: null, status: "idle", closedDay: null });
  });

  it("a new beginCloseDay makes a new id and ends unconfirmed", async () => {
    const store = await storeWithCloseDialog();
    const firstId = cashDay(store).close.clientRequestId;
    service.closeCashDay.mockRejectedValueOnce(cashDayTimeoutError());
    service.getCashDay.mockResolvedValueOnce(openCashDayEntity());
    await store.dispatch(closeDay({ countedCents: 1540000, reason: "Coins short at count" }));
    expect(cashDay(store).close.unconfirmed).toBe(true);

    store.dispatch(beginCloseDay("day-1020"));
    expect(cashDay(store).close).toMatchObject({ unconfirmed: false, sentBody: null, summary: null, status: "idle" });
    expect(cashDay(store).close.clientRequestId).toMatch(UUID);
    expect(cashDay(store).close.clientRequestId).not.toBe(firstId);
  });
});

describe("cashDaySlice fetchPastDays (P9-16)", () => {
  it("page 1 replaces the list, a later page appends", async () => {
    const store = await storeWithGate(todayOpen());
    service.listCashDays.mockResolvedValueOnce(pastDaysResponse());
    await store.dispatch(fetchPastDays({ branchId: BRANCH_ID }));
    expect(service.listCashDays).toHaveBeenCalledWith({ branchId: BRANCH_ID, page: 1, limit: PAST_DAYS_LIMIT });
    expect(cashDay(store).pastDays).toMatchObject({ status: "ready", meta: { total: 2, page: 1 } });
    expect(cashDay(store).pastDays.items.map((d) => d.id)).toEqual(["day-1020", "day-1019"]);

    const older = closedCashDayEntity({ id: "day-1018", business_date: "2026-10-18" });
    service.listCashDays.mockResolvedValueOnce({
      data: [older],
      meta: { total: 3, page: 2, limit: 2, totalPages: 2, hasNext: false, hasPrev: true },
    });
    await store.dispatch(fetchPastDays({ branchId: BRANCH_ID, page: 2 }));
    expect(cashDay(store).pastDays.items.map((d) => d.id)).toEqual(["day-1020", "day-1019", "day-1018"]);
    expect(cashDay(store).pastDays.meta).toMatchObject({ page: 2, hasPrev: true });

    service.listCashDays.mockResolvedValueOnce(pastDaysResponse());
    await store.dispatch(fetchPastDays({ branchId: BRANCH_ID, page: 1 }));
    expect(cashDay(store).pastDays.items).toHaveLength(2);
  });

  it("a failed page is the list's error", async () => {
    const store = await storeWithGate(todayOpen());
    service.listCashDays.mockRejectedValueOnce(cashDayServerError());
    await store.dispatch(fetchPastDays({ branchId: BRANCH_ID }));
    expect(cashDay(store).pastDays).toMatchObject({
      status: "error",
      error: { kind: CASH_DAY_ERROR.SERVER, op: CASH_DAY_OP.LIST, reconcile: false },
    });
  });
});
