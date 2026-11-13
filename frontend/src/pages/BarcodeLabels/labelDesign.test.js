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
  maxWidthMm,
  nextRotation,
  resizeItem,
  rotateItem,
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

  it("shortens a long item turned upright to the label's height, and keeps its centre", () => {
    const brand = defaultLayout("30x20", "PRODUCT").brand; // 27 mm wide
    const turned = rotateItem("30x20", "brand", brand);

    expect(turned.rotation).toBe(90);
    expect(turned.widthMm).toBe(17); // 20 mm high label, less 1.5 mm each side
    expect(turned.x + turned.widthMm / 2).toBeCloseTo(brand.x + brand.widthMm / 2, 0);
    expect(rotateItem("30x20", "brand", turned).widthMm).toBe(17); // 180°: stays shortened
  });

  it("lets a turned item go anywhere it fits, judged by what is seen", () => {
    const turned = rotateItem("30x20", "brand", defaultLayout("30x20", "PRODUCT").brand);
    const h = itemHeightMm("brand", turned);

    // Right to the left edge: its unturned box starts left of the label.
    const left = clampPosition("30x20", "brand", turned, -50, 0);
    expect(left.x + turned.widthMm / 2 - h / 2).toBeGreaterThanOrEqual(-0.01);
    expect(left.x).toBeLessThan(0);
    // And right to the right edge.
    const right = clampPosition("30x20", "brand", turned, 99, 0);
    expect(right.x + turned.widthMm / 2 + h / 2).toBeLessThanOrEqual(30.01);
    expect(right.x + turned.widthMm / 2).toBeGreaterThan(28);
    // Upright, it spans 17 mm of the 20 mm height: its centre moves between
    // 8.5 and 11.5 mm (it turns about its centre).
    expect(clampPosition("30x20", "brand", turned, 0, -50).y + h / 2).toBeCloseTo(8.5, 0);
    expect(clampPosition("30x20", "brand", turned, 0, 99).y + h / 2).toBeCloseTo(11.5, 0);
  });

  it("caps an upright item's width at the label's height, and keeps a resized item on the label", () => {
    const turned = { ...defaultLayout("50x25", "UNIT").price, rotation: 90 };
    expect(maxWidthMm("50x25", turned)).toBe(22);
    expect(maxWidthMm("50x25", { ...turned, rotation: 0 })).toBe(50);

    const nearEdge = { ...defaultLayout("50x25", "UNIT").price, x: 30, widthMm: 15 };
    const wider = resizeItem("50x25", "price", nearEdge, { widthMm: 30 });
    expect(wider.widthMm).toBe(30);
    expect(wider.x + wider.widthMm).toBeLessThanOrEqual(50);
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
