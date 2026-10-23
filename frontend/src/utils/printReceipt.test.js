import { vi } from "vitest";
import { act } from "@testing-library/react";
import { printReceipt, printReturnSlip, receiptPageHeightMm } from "./printReceipt";
import { completedSaleForReceipt } from "../test/posFixtures";
import { saleWithReturnsEntity } from "../test/returnEntities";

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

  describe("printReturnSlip (P7-17)", () => {
    // jsdom has no layout: give the slip a height by its copy, so each
    // copy's page size can be told apart.
    let rect;
    beforeEach(() => {
      rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
        const shop = this.getAttribute?.("data-testid") === "return-slip-shop";
        return { height: shop ? 800 : 600, width: 0, top: 0, left: 0, right: 0, bottom: 0 };
      });
    });
    afterEach(() => rect.mockRestore());

    it("prints the customer copy, then the shop copy: two jobs, each sized to itself", async () => {
      const seen = [];
      print.mockImplementation(() => {
        seen.push({ copy: root().querySelector('[data-testid^="return-slip-"]').dataset.testid, page: pageRule() });
      });
      let heights;
      await act(async () => {
        heights = await printReturnSlip(saleWithReturnsEntity(), "ret-1");
      });

      // 600px = 158.75mm → 160; 800px = 211.67mm → 213
      expect(heights).toEqual([160, 213]);
      expect(seen).toEqual([
        { copy: "return-slip-customer", page: "@page { size: 72mm 160mm; margin: 0; }" },
        { copy: "return-slip-shop", page: "@page { size: 72mm 213mm; margin: 0; }" },
      ]);
    });

    it("renders and measures the shop copy only after the customer copy's print has returned", async () => {
      const events = [];
      rect.mockImplementation(function () {
        events.push(`measure ${this.getAttribute?.("data-testid")}`);
        return { height: 600, width: 0, top: 0, left: 0, right: 0, bottom: 0 };
      });
      print.mockImplementation(() => {
        events.push("print start");
        events.push("print returned");
      });
      await act(async () => {
        await printReturnSlip(saleWithReturnsEntity(), "ret-1");
      });

      expect(events).toEqual([
        "measure return-slip-customer",
        "print start",
        "print returned",
        "measure return-slip-shop",
        "print start",
        "print returned",
      ]);
    });

    it("a return that isn't on the sale prints nothing", async () => {
      await expect(printReturnSlip(saleWithReturnsEntity(), "ret-x")).rejects.toThrow("Return ret-x is not on sale sale-7");
      expect(print).not.toHaveBeenCalled();
    });

    it("the receipt still prints alone, one job", async () => {
      await act(async () => {
        await printReceipt(completedSaleForReceipt());
      });
      expect(print).toHaveBeenCalledTimes(1);
      expect(root().querySelector('[data-testid="receipt"]')).not.toBeNull();
    });
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
