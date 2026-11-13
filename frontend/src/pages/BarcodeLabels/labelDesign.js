/**
 * The label design: which line goes where on the label, and how each line's
 * text looks. Plain functions (no React), shared by the preview and the
 * printed sheet, so what is designed is what prints.
 *
 * The label's printed size never comes from here (LABEL_SIZES in index.jsx):
 * rotation turns the content inside the same label.
 */

/** Every line a label can hold, in its default order. */
export const LINE_IDS = ["brand", "name", "barcode", "code", "identifier", "price"];

/** What each line is called, and whether it may be hidden. */
export const LINE_INFO = {
  brand: { label: "SOCIO.LK brand", hideable: false },
  name: { label: "Name", hideable: true },
  barcode: { label: "Barcode", hideable: false },
  code: { label: "Code text", hideable: true },
  // Phone labels must show the IMEI, serial labels the serial number.
  identifier: { label: "IMEI / serial", hideable: false },
  price: { label: "Selling price", hideable: true },
};

export const ROTATIONS = [0, 90, 180, 270];
export const ALIGNMENTS = ["left", "center", "right"];
export const MIN_FONT_PT = 4;
export const MAX_FONT_PT = 16;
export const FONT_STEP_PT = 0.5;
export const MIN_BARCODE_MM = 5;
export const MAX_BARCODE_MM = 20;

/** The look the labels had before the design panel. */
export const DEFAULT_DESIGN = Object.freeze({
  rotation: 0,
  order: LINE_IDS,
  barcodeHeightMm: 12,
  lines: {
    brand: { show: true, sizePt: 6, bold: true, italic: false, align: "center" },
    name: { show: true, sizePt: 7, bold: true, italic: false, align: "center" },
    code: { show: true, sizePt: 6, bold: false, italic: false, align: "center" },
    identifier: { show: true, sizePt: 6, bold: false, italic: false, align: "center" },
    price: { show: true, sizePt: 8, bold: true, italic: false, align: "center" },
  },
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** A font size rounded to the step and kept within bounds. */
export const clampFont = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return clamp(Math.round(number / FONT_STEP_PT) * FONT_STEP_PT, MIN_FONT_PT, MAX_FONT_PT);
};

/** A barcode height in whole mm, within bounds. */
export const clampBarcodeHeight = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return clamp(Math.round(number), MIN_BARCODE_MM, MAX_BARCODE_MM);
};

/** Move a line one place up (-1) or down (+1); the same design at an end. */
export const moveLine = (design, id, step) => {
  const index = design.order.indexOf(id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= design.order.length) return design;
  const order = [...design.order];
  [order[index], order[target]] = [order[target], order[index]];
  return { ...design, order };
};

/** Change some of one text line's settings. */
export const updateLine = (design, id, changes) => ({
  ...design,
  lines: { ...design.lines, [id]: { ...design.lines[id], ...changes } },
});

/**
 * A stored design made safe: unknown or missing values fall back to the
 * defaults, so an old or edited value can't break the labels. A line that
 * must always show is forced back on.
 */
export const normalizeDesign = (stored) => {
  if (!stored || typeof stored !== "object") return DEFAULT_DESIGN;
  const order = Array.isArray(stored.order) &&
    stored.order.length === LINE_IDS.length &&
    LINE_IDS.every((id) => stored.order.includes(id))
    ? [...stored.order]
    : [...LINE_IDS];
  const lines = {};
  for (const [id, base] of Object.entries(DEFAULT_DESIGN.lines)) {
    const line = stored.lines?.[id] ?? {};
    lines[id] = {
      show: LINE_INFO[id].hideable ? line.show !== false : true,
      sizePt: clampFont(line.sizePt) ?? base.sizePt,
      bold: typeof line.bold === "boolean" ? line.bold : base.bold,
      italic: typeof line.italic === "boolean" ? line.italic : base.italic,
      align: ALIGNMENTS.includes(line.align) ? line.align : base.align,
    };
  }
  return {
    rotation: ROTATIONS.includes(stored.rotation) ? stored.rotation : 0,
    order,
    barcodeHeightMm: clampBarcodeHeight(stored.barcodeHeightMm) ?? DEFAULT_DESIGN.barcodeHeightMm,
    lines,
  };
};

const STORAGE_KEY = "socio-lk-barcode-label-design-v1";

/** The design last used in this browser, or the default. */
export const loadDesign = () => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? normalizeDesign(JSON.parse(raw)) : DEFAULT_DESIGN;
  } catch {
    return DEFAULT_DESIGN;
  }
};

/** Remember the design in this browser; storage failures are ignored. */
export const saveDesign = (design) => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(design));
  } catch {
    // Private windows or blocked storage: the design just isn't remembered.
  }
};

/** Inline styles for one text line. */
export const lineStyle = (line) => ({
  fontSize: `${line.sizePt}pt`,
  fontWeight: line.bold ? 700 : 400,
  fontStyle: line.italic ? "italic" : "normal",
  textAlign: line.align,
});

/**
 * The content box inside a label of `widthMm` × `heightMm`: the label less a
 * 1.5 mm margin (the printed label's padding) on each side, with width and
 * height swapped when the content is turned a quarter.
 */
export const CONTENT_INSET_MM = 1.5;
export const contentBox = (widthMm, heightMm, rotation) => {
  const quarter = rotation % 180 !== 0;
  const width = (quarter ? heightMm : widthMm) - 2 * CONTENT_INSET_MM;
  const height = (quarter ? widthMm : heightMm) - 2 * CONTENT_INSET_MM;
  return { widthMm: width, heightMm: height };
};
