import {
  DEFAULT_DESIGN,
  LINE_IDS,
  clampBarcodeHeight,
  clampFont,
  contentBox,
  lineStyle,
  loadDesign,
  moveLine,
  normalizeDesign,
  saveDesign,
  updateLine,
} from "./labelDesign";

describe("labelDesign", () => {
  beforeEach(() => localStorage.clear());

  it("starts with the lines in the label's usual order and look", () => {
    expect(DEFAULT_DESIGN.order).toEqual(["brand", "name", "barcode", "code", "identifier", "price"]);
    expect(DEFAULT_DESIGN.rotation).toBe(0);
    expect(DEFAULT_DESIGN.lines.price).toMatchObject({ sizePt: 8, bold: true, align: "center" });
  });

  it("moves a line up or down, and not past either end", () => {
    const up = moveLine(DEFAULT_DESIGN, "price", -1);
    expect(up.order.slice(-2)).toEqual(["price", "identifier"]);
    expect(moveLine(DEFAULT_DESIGN, "brand", -1)).toBe(DEFAULT_DESIGN);
    expect(moveLine(DEFAULT_DESIGN, "price", 1)).toBe(DEFAULT_DESIGN);
    expect(DEFAULT_DESIGN.order).toEqual(LINE_IDS);
  });

  it("changes one line without touching the others", () => {
    const next = updateLine(DEFAULT_DESIGN, "name", { italic: true, sizePt: 9 });
    expect(next.lines.name).toMatchObject({ italic: true, sizePt: 9, bold: true });
    expect(next.lines.price).toBe(DEFAULT_DESIGN.lines.price);
  });

  it.each([
    ["7.3", 7.5],
    [2, 4],
    [40, 16],
    ["abc", null],
  ])("clamps a font size %p to %p", (value, expected) => {
    expect(clampFont(value)).toBe(expected);
  });

  it.each([
    [3, 5],
    [12.6, 13],
    [99, 20],
    ["", 5],
  ])("clamps a barcode height %p to %p", (value, expected) => {
    expect(clampBarcodeHeight(value)).toBe(expected);
  });

  it("turns styles into CSS", () => {
    expect(lineStyle({ sizePt: 9.5, bold: false, italic: true, align: "right" })).toEqual({
      fontSize: "9.5pt",
      fontWeight: 400,
      fontStyle: "italic",
      textAlign: "right",
    });
  });

  it("swaps the content box for a quarter turn, inside a 1.5 mm margin", () => {
    expect(contentBox(50, 25, 0)).toEqual({ widthMm: 47, heightMm: 22 });
    expect(contentBox(50, 25, 180)).toEqual({ widthMm: 47, heightMm: 22 });
    expect(contentBox(50, 25, 90)).toEqual({ widthMm: 22, heightMm: 47 });
    expect(contentBox(30, 20, 270)).toEqual({ widthMm: 17, heightMm: 27 });
  });

  it("repairs a stored design: bad values fall back, required lines show", () => {
    const repaired = normalizeDesign({
      rotation: 45,
      order: ["price", "brand"],
      barcodeHeightMm: "tall",
      lines: {
        price: { show: false, sizePt: 30, bold: "yes", align: "justify" },
        identifier: { show: false },
        brand: { show: false },
      },
    });

    expect(repaired.rotation).toBe(0);
    expect(repaired.order).toEqual(LINE_IDS);
    expect(repaired.barcodeHeightMm).toBe(12);
    expect(repaired.lines.price).toEqual({ show: false, sizePt: 16, bold: true, italic: false, align: "center" });
    expect(repaired.lines.identifier.show).toBe(true);
    expect(repaired.lines.brand.show).toBe(true);
    expect(normalizeDesign(null)).toBe(DEFAULT_DESIGN);
  });

  it("remembers a design in this browser, and survives broken storage", () => {
    const design = updateLine(moveLine(DEFAULT_DESIGN, "price", -1), "name", { italic: true });
    saveDesign({ ...design, rotation: 90 });
    expect(loadDesign()).toEqual({ ...design, rotation: 90 });

    localStorage.setItem("socio-lk-barcode-label-design-v1", "{not json");
    expect(loadDesign()).toBe(DEFAULT_DESIGN);
  });
});
