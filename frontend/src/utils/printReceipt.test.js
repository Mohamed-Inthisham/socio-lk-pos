import { vi } from "vitest";
import { act } from "@testing-library/react";
import { printReceipt, receiptPageHeightMm } from "./printReceipt";
import { completedSaleForReceipt } from "../test/posFixtures";

const root = () => document.getElementById("receipt-root");
const pageRule = () => document.getElementById("receipt-page-size")?.textContent;

describe("printReceipt (P5-12, P5-13)", () => {
  let print;

  beforeEach(() => {
    print = vi.spyOn(window, "print").mockImplementation(() => {});
  });

  afterEach(() => {
    print.mockRestore();
  });

  it("renders the receipt into #receipt-root, sizes the page, then prints", async () => {
    let height;
    await act(async () => {
      height = await printReceipt(completedSaleForReceipt());
    });

    expect(root()).not.toBeNull();
    expect(root().textContent).toContain("INV-20261021-0007");
    // jsdom has no layout (0px), so the 90mm minimum applies
    expect(height).toBe(90);
    expect(pageRule()).toBe("@page { size: 72mm 90mm; margin: 0; }");
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("a reprint replaces the receipt; there is only ever one receipt root", async () => {
    await act(async () => {
      await printReceipt(completedSaleForReceipt());
      await printReceipt(completedSaleForReceipt({ sale_number: "INV-20261021-0008" }));
    });

    expect(document.querySelectorAll("#receipt-root")).toHaveLength(1);
    expect(root().textContent).toContain("INV-20261021-0008");
    expect(root().textContent).not.toContain("INV-20261021-0007");
    expect(print).toHaveBeenCalledTimes(2);
  });

  describe("receiptPageHeightMm", () => {
    it("adds 1mm of slack to the measured height", () => {
      // 600px = 158.75mm → ceil 159 + 1
      expect(receiptPageHeightMm(600)).toBe(160);
    });

    it("never goes below 90mm, so a short receipt doesn't print sideways", () => {
      expect(receiptPageHeightMm(100)).toBe(90);
      expect(receiptPageHeightMm(0)).toBe(90);
    });
  });
});
