import { vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import useInspectionCount, { announceInspectionChange } from "./useInspectionCount";
import * as saleReturnsService from "../services/saleReturnsService";
import { inspectionRow } from "../test/returnEntities";

vi.mock("../services/saleReturnsService");

const rows = (n) => Array.from({ length: n }, (_, i) => inspectionRow({ product_unit: { id: `u-${i}`, imei: `35000000000000${i}`, product_name: "Phone" } }));

describe("useInspectionCount (P7-7)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reads the branch's phones to check when it mounts", async () => {
    saleReturnsService.listInspection.mockResolvedValue(rows(3));
    const { result } = renderHook(() => useInspectionCount("branch-main", true));
    await waitFor(() => expect(result.current).toBe(3));
    expect(saleReturnsService.listInspection).toHaveBeenCalledWith("branch-main");
  });

  it("reads nothing for a cashier", async () => {
    const { result } = renderHook(() => useInspectionCount("branch-main", false));
    expect(result.current).toBeNull();
    expect(saleReturnsService.listInspection).not.toHaveBeenCalled();
  });

  it("a failed read gives no count", async () => {
    saleReturnsService.listInspection.mockRejectedValue(new Error("Network Error"));
    const { result } = renderHook(() => useInspectionCount("branch-main", true));
    await waitFor(() => expect(saleReturnsService.listInspection).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("a change with a count takes it as is; without one, reads again", async () => {
    saleReturnsService.listInspection.mockResolvedValueOnce(rows(3)).mockResolvedValueOnce(rows(4));
    const { result } = renderHook(() => useInspectionCount("branch-main", true));
    await waitFor(() => expect(result.current).toBe(3));

    act(() => announceInspectionChange(2));
    expect(result.current).toBe(2);
    expect(saleReturnsService.listInspection).toHaveBeenCalledTimes(1);

    act(() => announceInspectionChange());
    await waitFor(() => expect(result.current).toBe(4));
    expect(saleReturnsService.listInspection).toHaveBeenCalledTimes(2);
  });

  it("reads again when the tab becomes visible", async () => {
    saleReturnsService.listInspection.mockResolvedValueOnce(rows(1)).mockResolvedValueOnce(rows(5));
    const { result } = renderHook(() => useInspectionCount("branch-main", true));
    await waitFor(() => expect(result.current).toBe(1));

    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(result.current).toBe(5));
  });
});
