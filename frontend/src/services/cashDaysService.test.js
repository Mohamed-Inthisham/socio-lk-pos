import { vi } from "vitest";
import api from "./api";
import {
  CASH_DAY_READ_TIMEOUT_MS,
  CASH_DAY_TIMEOUT_MS,
  closeCashDay,
  getCashDay,
  getCashDaySummary,
  getCurrentCashDay,
  listCashDays,
  openCashDay,
} from "./cashDaysService";
import {
  BRANCH_ID,
  CASH_DAY_REQUEST_ID,
  cashDaySummaryEntity,
  closedCashDayEntity,
  currentCashDayResponse,
  openCashDayEntity,
  pastDaysResponse,
} from "../test/cashDayEntities";

vi.mock("./api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

describe("cashDaysService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reads today's cash day for a branch, with the 15 s read timeout", async () => {
    const body = currentCashDayResponse();
    api.get.mockResolvedValue({ data: body });

    await expect(getCurrentCashDay(BRANCH_ID)).resolves.toEqual(body);
    expect(api.get).toHaveBeenCalledWith("/cash-days/current", {
      params: { branchId: BRANCH_ID },
      timeout: CASH_DAY_READ_TIMEOUT_MS,
    });
    expect(CASH_DAY_READ_TIMEOUT_MS).toBe(15000);
  });

  it("opens the day with branch_id, the opening balance as a number and the request id, with the 30 s timeout", async () => {
    const day = openCashDayEntity();
    api.post.mockResolvedValue({ status: 201, data: day });
    const payload = { branch_id: BRANCH_ID, opening_balance: 5000.5, client_request_id: CASH_DAY_REQUEST_ID };

    await expect(openCashDay(payload)).resolves.toEqual(day);
    expect(api.post).toHaveBeenCalledWith("/cash-days/open", payload, { timeout: CASH_DAY_TIMEOUT_MS });
    expect(CASH_DAY_TIMEOUT_MS).toBe(30000);
  });

  it("answers a 200 resend of the open with the recorded day, the same as a 201", async () => {
    const day = openCashDayEntity();
    api.post.mockResolvedValue({ status: 200, data: day });

    await expect(
      openCashDay({ branch_id: BRANCH_ID, opening_balance: 0, client_request_id: CASH_DAY_REQUEST_ID }),
    ).resolves.toEqual(day);
  });

  it("reads a day's figures", async () => {
    const summary = cashDaySummaryEntity();
    api.get.mockResolvedValue({ data: summary });

    await expect(getCashDaySummary("day-1020")).resolves.toEqual(summary);
    expect(api.get).toHaveBeenCalledWith("/cash-days/day-1020/summary");
  });

  it("closes a day with numbers for the money, the reason and the request id, with the 30 s timeout", async () => {
    const day = closedCashDayEntity();
    api.post.mockResolvedValue({ status: 200, data: day });
    const payload = {
      counted_balance: 15400,
      expected_seen: 15500,
      difference_reason: "Coins short at count",
      client_request_id: CASH_DAY_REQUEST_ID,
    };

    await expect(closeCashDay("day-1020", payload)).resolves.toEqual(day);
    expect(api.post).toHaveBeenCalledWith("/cash-days/day-1020/close", payload, { timeout: CASH_DAY_TIMEOUT_MS });
  });

  it("lists a branch's days with page and limit", async () => {
    const body = pastDaysResponse();
    api.get.mockResolvedValue({ data: body });

    await expect(listCashDays({ branchId: BRANCH_ID, page: 2, limit: 20 })).resolves.toEqual(body);
    expect(api.get).toHaveBeenCalledWith("/cash-days", { params: { branchId: BRANCH_ID, page: 2, limit: 20 } });
  });

  it("reads one day", async () => {
    const day = closedCashDayEntity();
    api.get.mockResolvedValue({ data: day });

    await expect(getCashDay("day-1020")).resolves.toEqual(day);
    expect(api.get).toHaveBeenCalledWith("/cash-days/day-1020");
  });

  it("passes a failure through unchanged, never resending", async () => {
    const error = new Error("Network Error");
    api.post.mockRejectedValue(error);

    await expect(
      closeCashDay("day-1020", { counted_balance: 1, expected_seen: 1, client_request_id: CASH_DAY_REQUEST_ID }),
    ).rejects.toBe(error);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
