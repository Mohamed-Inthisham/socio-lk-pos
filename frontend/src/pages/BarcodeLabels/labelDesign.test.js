import {
  KIND_ITEMS,
  LABEL_MM,
  clampBarcodeHeight,
  clampFont,
  clampPosition,
  clampWidth,
  defaultLayout,
  itemHeightMm,
  itemPlacement,
  layoutFor,
  loadLayouts,
  nextRotation,
  normalizeLayout,
  saveLayouts,
  textStyle,
  updateItem,
} from "./labelDesign";

describe("labelDesign", () => {
  beforeEach(() => localStorage.clear());

  it.each(Object.keys(LABEL_MM).flatMap((size) => ["PRODUCT", "UNIT"].map((kind) => [size, kind])))(
    "lays out a %s %s label top to bottom, every item inside the label",
    (size, kind) => {
      const layout = defaultLayout(size, kind);
      const { widthMm, heightMm } = LABEL_MM[size];
      expect(Object.keys(layout)).toEqual(KIND_ITEMS[kind]);
      let previousBottom = -Infinity;
      for (const id of KIND_ITEMS[kind]) {
        const item = layout[id];
        expect(item.x).toBeGreaterThanOrEqual(0);
        expect(item.x + item.widthMm).toBeLessThanOrEqual(widthMm);
        expect(item.y).toBeGreaterThanOrEqual(previousBottom - 0.05);
        previousBottom = item.y + itemHeightMm(id, item);
        expect(previousBottom).toBeLessThanOrEqual(heightMm + 0.05);
        expect(item.rotation).toBe(0);
      }
      expect(layout.barcode.heightMm).toBeGreaterThanOrEqual(5);
    },
  );

  it("has no IMEI item on a product label", () => {
    expect(defaultLayout("50x25", "PRODUCT").identifier).toBeUndefined();
    expect(defaultLayout("50x25", "UNIT").identifier).toMatchObject({ show: true });
  });

  it("keeps the old look by default: centred text, bold brand, name and price", () => {
    const layout = defaultLayout("50x25", "UNIT");
    expect(layout.brand).toMatchObject({ sizePt: 6, bold: true, align: "center" });
    expect(layout.name).toMatchObject({ sizePt: 7, bold: true });
    expect(layout.price).toMatchObject({ sizePt: 8, bold: true });
    expect(layout.identifier).toMatchObject({ sizePt: 6, bold: false, italic: false });
  });

  it("keeps a moved item on the label, in 0.5 mm steps", () => {
    const layout = defaultLayout("50x25", "PRODUCT");
    expect(clampPosition("50x25", "price", layout.price, 3.26, 4.8)).toEqual({ x: 3, y: 5 });
    expect(clampPosition("50x25", "price", { ...layout.price, widthMm: 20 }, 99, 99).x).toBe(30);
    expect(clampPosition("50x25", "barcode", { ...layout.barcode, heightMm: 10 }, -5, 99)).toEqual({ x: 0, y: 15 });
  });

  it("clamps sizes, widths and heights, and refuses unreadable input", () => {
    expect(clampFont("7.3")).toBe(7.5);
    expect(clampFont(40)).toBe(16);
    expect(clampFont("")).toBeNull();
    expect(clampBarcodeHeight(3)).toBe(5);
    expect(clampBarcodeHeight(12.3)).toBe(12.5);
    expect(clampWidth(2, "30x20")).toBe(5);
    expect(clampWidth(80, "30x20")).toBe(30);
    expect(clampWidth("x", "30x20")).toBeNull();
  });

  it("turns a quarter at a time, back to 0", () => {
    expect([0, 90, 180, 270].map(nextRotation)).toEqual([90, 180, 270, 0]);
  });

  it("places an item in mm, turned about its centre", () => {
    expect(itemPlacement("price", { x: 2, y: 3.5, widthMm: 20, rotation: 90 })).toEqual({
      left: "2mm",
      top: "3.5mm",
      width: "20mm",
      transform: "rotate(90deg)",
    });
    expect(itemPlacement("barcode", { x: 0, y: 0, widthMm: 40, heightMm: 10, rotation: 0 })).toMatchObject({
      height: "10mm",
      transform: undefined,
    });
    expect(textStyle({ sizePt: 9, bold: false, italic: true, align: "right" })).toEqual({
      fontSize: "9pt",
      fontWeight: 400,
      fontStyle: "italic",
      textAlign: "right",
    });
  });

  it("changes one item without touching the others", () => {
    const layout = defaultLayout("50x25", "UNIT");
    const next = updateItem(layout, "price", { italic: true });
    expect(next.price.italic).toBe(true);
    expect(next.name).toBe(layout.name);
  });

  it("repairs a stored layout: bad values fall back, required items show, positions stay on the label", () => {
    const repaired = normalizeLayout(
      {
        price: { x: 999, y: -4, widthMm: 20, sizePt: 50, bold: "yes", align: "justify", rotation: 45, show: false },
        identifier: { show: false },
        brand: { show: false },
        barcode: { heightMm: "tall" },
      },
      "50x25",
      "UNIT",
    );
    const base = defaultLayout("50x25", "UNIT");

    expect(repaired.price).toMatchObject({ x: 30, y: 0, widthMm: 20, sizePt: 16, bold: true, align: "center", rotation: 0, show: false });
    expect(repaired.identifier.show).toBe(true);
    expect(repaired.brand.show).toBe(true);
    expect(repaired.barcode.heightMm).toBe(base.barcode.heightMm);
    expect(normalizeLayout(null, "50x25", "UNIT")).toEqual(base);
  });

  it("remembers edited layouts per size and kind, and survives broken storage", () => {
    const edited = updateItem(defaultLayout("40x20", "UNIT"), "price", { italic: true, x: 2 });
    saveLayouts({ "40x20": { UNIT: edited } });

    const loaded = loadLayouts();
    expect(loaded["40x20"].UNIT.price).toMatchObject({ italic: true, x: 2 });
    expect(layoutFor(loaded, "40x20", "PRODUCT")).toEqual(defaultLayout("40x20", "PRODUCT"));
    expect(layoutFor(loaded, "50x25", "UNIT")).toEqual(defaultLayout("50x25", "UNIT"));

    localStorage.setItem("socio-lk-barcode-label-layouts-v2", "{not json");
    expect(loadLayouts()).toEqual({});
  });
});
