import { describe, expect, it } from "vitest";
import { UNIT_STATUS_LABELS, UNIT_STATUS_OPTIONS } from "./unitStatus";

describe("unitStatus", () => {
  it.each([
    ["IN_STOCK", "In stock"],
    ["SOLD", "Sold"],
    ["INSPECTION", "Inspection"],
    ["RETURNED", "Back with customer"],
    ["WRITTEN_OFF", "Written off"],
  ])("labels %s as %s", (status, label) => {
    expect(UNIT_STATUS_LABELS[status]).toBe(label);
  });

  it("has the backend's five statuses and no others", () => {
    expect(Object.keys(UNIT_STATUS_LABELS)).toHaveLength(5);
  });

  it("offers All statuses first, then each status in order", () => {
    expect(UNIT_STATUS_OPTIONS).toEqual([
      { value: "", label: "All statuses" },
      { value: "IN_STOCK", label: "In stock" },
      { value: "SOLD", label: "Sold" },
      { value: "INSPECTION", label: "Inspection" },
      { value: "RETURNED", label: "Back with customer" },
      { value: "WRITTEN_OFF", label: "Written off" },
    ]);
  });
});
