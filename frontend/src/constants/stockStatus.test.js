import { describe, expect, it } from "vitest";
import { STOCK_STATUS_LABELS, STOCK_STATUS_OPTIONS } from "./stockStatus";

describe("stockStatus", () => {
  it.each([
    ["IN_STOCK", "In stock"],
    ["LOW_STOCK", "Low stock"],
    ["OUT_OF_STOCK", "Out of stock"],
    ["NOT_TRACKED", "Not tracked"],
  ])("labels %s as %s", (status, label) => {
    expect(STOCK_STATUS_LABELS[status]).toBe(label);
  });

  it("has the backend's four statuses and no others", () => {
    expect(Object.keys(STOCK_STATUS_LABELS)).toHaveLength(4);
  });

  it("offers All statuses first, then each status in order", () => {
    expect(STOCK_STATUS_OPTIONS).toEqual([
      { value: "", label: "All statuses" },
      { value: "IN_STOCK", label: "In stock" },
      { value: "LOW_STOCK", label: "Low stock" },
      { value: "OUT_OF_STOCK", label: "Out of stock" },
      { value: "NOT_TRACKED", label: "Not tracked" },
    ]);
  });
});
