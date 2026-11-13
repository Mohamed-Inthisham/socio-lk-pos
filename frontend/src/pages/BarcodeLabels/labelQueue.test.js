import {
  MAX_LABELS,
  addEntry,
  clampCopies,
  countLabels,
  describeResolveError,
  expandLabels,
  previewEntries,
  productEntry,
  queueSignature,
  toResolveItems,
  unitEntry,
} from "./labelQueue";

const productRow = {
  kind: "PRODUCT",
  product_id: "p-1",
  name: "USB-C Charger",
  model: null,
  sku: "SKU-1",
  barcode: "SLP-000001",
  barcode_type: "CODE_128",
  selling_price: "4500.00",
};
const imeiRow = {
  kind: "UNIT",
  unit_id: "u-1",
  unit_code: "SLU00000001",
  product_id: "p-phone",
  name: "iPhone 13",
  tracking_method: "IMEI",
  identifier_type: "IMEI",
  identifier: "356938035643809",
  selling_price: "185000.00",
  branch: { id: "b-1", name: "Main Shop" },
};
const serialRow = {
  ...imeiRow,
  unit_id: "u-2",
  unit_code: "SLU00000002",
  tracking_method: "SERIAL_NUMBER",
  identifier_type: "SERIAL_NUMBER",
  identifier: "SN-ABC",
  selling_price: null,
};

describe("labelQueue", () => {
  it("adds entries in order and never twice", () => {
    let queue = [];
    queue = addEntry(queue, unitEntry(imeiRow));
    queue = addEntry(queue, productEntry(productRow));
    queue = addEntry(queue, unitEntry(serialRow));
    const again = addEntry(queue, productEntry(productRow));

    expect(again).toBe(queue);
    expect(queue.map((item) => item.key)).toEqual(["UNIT:u-1", "PRODUCT:p-1", "UNIT:u-2"]);
  });

  it("keeps different units of the same product as separate entries", () => {
    const queue = addEntry([unitEntry(imeiRow)], unitEntry({ ...imeiRow, unit_id: "u-9", unit_code: "SLU00000009" }));
    expect(queue).toHaveLength(2);
  });

  it("builds resolve items with exactly each type's fields, in order", () => {
    const queue = [unitEntry(imeiRow), { ...productEntry(productRow), quantity: 3 }];

    expect(toResolveItems(queue)).toEqual([
      { type: "UNIT", unitId: "u-1" },
      { type: "PRODUCT", productId: "p-1", quantity: 3 },
    ]);
    expect(queueSignature(queue)).not.toBe(queueSignature([...queue].reverse()));
  });

  it("counts product copies plus one per unit", () => {
    expect(countLabels([{ ...productEntry(productRow), quantity: 4 }, unitEntry(imeiRow)])).toBe(5);
    expect(MAX_LABELS).toBe(500);
  });

  it.each([
    ["3", 3],
    ["0", 1],
    ["-5", 1],
    ["", 1],
    ["abc", 1],
    ["2.7", 2],
    ["900", 500],
  ])("clamps copies %p to %p", (value, expected) => {
    expect(clampCopies(value)).toBe(expected);
  });

  it("expands a product row into its copies, encoding the product barcode", () => {
    const labels = expandLabels([{ ...productRow, quantity: 2 }]);

    expect(labels).toEqual([
      { key: "0-p-1-0", kind: "PRODUCT", name: "USB-C Charger", code: "SLP-000001", identifier: null, price: "4500.00" },
      { key: "0-p-1-1", kind: "PRODUCT", name: "USB-C Charger", code: "SLP-000001", identifier: null, price: "4500.00" },
    ]);
  });

  it("encodes unit_code for a unit, with the IMEI or serial number as text only", () => {
    const [imei, serial] = expandLabels([imeiRow, serialRow]);

    expect(imei.code).toBe("SLU00000001");
    expect(imei.identifier).toEqual({ label: "IMEI", value: "356938035643809" });
    expect(serial.code).toBe("SLU00000002");
    expect(serial.identifier).toEqual({ label: "S/N", value: "SN-ABC" });
    expect(serial.price).toBeNull();
  });

  it("carries no cost field into a label, even if a row had one", () => {
    const [label] = expandLabels([{ ...productRow, quantity: 1, buying_price: "999.00" }]);
    expect(Object.keys(label).sort()).toEqual(["code", "identifier", "key", "kind", "name", "price"]);
    expect(JSON.stringify(label)).not.toContain("999.00");
  });

  it("gives one preview entry per resolved row, numbering the sheet's labels", () => {
    const entries = previewEntries([imeiRow, { ...productRow, quantity: 3 }, serialRow]);

    expect(entries.map(({ kind, copies, first, last }) => ({ kind, copies, first, last }))).toEqual([
      { kind: "UNIT", copies: 1, first: 1, last: 1 },
      { kind: "PRODUCT", copies: 3, first: 2, last: 4 },
      { kind: "UNIT", copies: 1, first: 5, last: 5 },
    ]);
    expect(entries[0].label.code).toBe("SLU00000001");
    expect(entries[1].label.code).toBe("SLP-000001");
    expect(entries[2].label.identifier).toEqual({ label: "S/N", value: "SN-ABC" });
  });

  describe("describeResolveError", () => {
    const sent = [productEntry(productRow), unitEntry(imeiRow), unitEntry(serialRow)];

    it("maps INVALID_LABEL_ITEMS errors to the entries sent, by index", () => {
      const result = describeResolveError(
        {
          response: {
            data: {
              code: "INVALID_LABEL_ITEMS",
              errors: [
                { index: 1, reason: "UNIT_NOT_IN_STOCK", message: "This unit is not in stock." },
                { index: 2, reason: "UNIT_NOT_FOUND", message: "No unit with that id at this branch." },
              ],
            },
          },
        },
        sent,
      );

      expect(result.itemErrors).toEqual({
        "UNIT:u-1": "This unit is not in stock.",
        "UNIT:u-2": "No unit with that id at this branch.",
      });
      expect(result.message).toMatch(/2 items in the queue can't be printed/);
    });

    it("passes the limit message and validation messages through", () => {
      expect(
        describeResolveError(
          { response: { data: { code: "LABEL_LIMIT_EXCEEDED", message: "A label queue can hold at most 500 labels; this one has 501." } } },
          sent,
        ).message,
      ).toBe("A label queue can hold at most 500 labels; this one has 501.");
      expect(
        describeResolveError({ response: { data: { message: ["items.0.quantity must not be greater than 500"] } } }, sent)
          .message,
      ).toBe("items.0.quantity must not be greater than 500");
    });

    it("falls back to a generic message without a response", () => {
      expect(describeResolveError(new Error("Network Error"), sent)).toEqual({
        message: "Couldn't prepare the labels. Try again.",
        itemErrors: {},
      });
    });
  });
});
