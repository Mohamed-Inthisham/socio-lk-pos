/**
 * Label layouts for the visual designer: where each item sits on the label
 * (in mm from the label's top-left corner), its width, rotation and text
 * style. Plain functions (no React), shared by the designer, the preview
 * and the printed sheet, so what is designed is what prints.
 *
 * One layout per label size and kind (a product label has no IMEI line).
 * Layouts only place items: the label's printed size never comes from here.
 */

/** The items each kind of label holds, top to bottom in the default layout. */
export const KIND_ITEMS = {
  PRODUCT: ["brand", "name", "barcode", "code", "price"],
  UNIT: ["brand", "name", "barcode", "code", "identifier", "price"],
};

/** What each item is called, and whether it may be hidden. */
export const ITEM_INFO = {
  brand: { label: "SOCIO.LK brand", hideable: false },
  name: { label: "Name", hideable: true },
  barcode: { label: "Barcode", hideable: false },
  code: { label: "Code text", hideable: true },
  // Phone labels must show the IMEI, serial labels the serial number.
  identifier: { label: "IMEI / serial", hideable: false },
  price: { label: "Selling price", hideable: true },
};

export const LABEL_MM = {
  "50x25": { widthMm: 50, heightMm: 25 },
  "40x20": { widthMm: 40, heightMm: 20 },
  "30x20": { widthMm: 30, heightMm: 20 },
};

export const ROTATIONS = [0, 90, 180, 270];
export const ALIGNMENTS = ["left", "center", "right"];
export const MIN_FONT_PT = 4;
export const MAX_FONT_PT = 16;
export const FONT_STEP_PT = 0.5;
export const MIN_BARCODE_MM = 5;
export const MAX_BARCODE_MM = 20;
export const MIN_WIDTH_MM = 5;
export const POSITION_STEP_MM = 0.5;
/** The text line height, as the labels set it (line-height: 1.15). */
export const LINE_HEIGHT = 1.15;
const PT_TO_MM = 25.4 / 72;
const MARGIN_MM = 1.5;
const GAP_MM = 0.3;

const DEFAULT_TEXT = {
  brand: { sizePt: 6, bold: true },
  name: { sizePt: 7, bold: true },
  code: { sizePt: 6, bold: false },
  identifier: { sizePt: 6, bold: false },
  price: { sizePt: 8, bold: true },
};

const round = (value, step = POSITION_STEP_MM) => Math.round(value / step) * step;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** A text item's height in mm, from its font size. */
export const textHeightMm = (sizePt) => sizePt * PT_TO_MM * LINE_HEIGHT;

/** An item's unrotated height in mm. */
export const itemHeightMm = (id, item) => (id === "barcode" ? item.heightMm : textHeightMm(item.sizePt));

/**
 * The layout the labels had before the designer: every item full width
 * (inside a 1.5 mm margin), centred, stacked top to bottom, with the
 * barcode taking the room left (5–12 mm).
 */
export const defaultLayout = (size, kind) => {
  const { widthMm, heightMm } = LABEL_MM[size];
  const ids = KIND_ITEMS[kind];
  const textIds = ids.filter((id) => id !== "barcode");
  const textTotal = textIds.reduce((sum, id) => sum + textHeightMm(DEFAULT_TEXT[id].sizePt), 0);
  const gaps = GAP_MM * (ids.length - 1);
  // Rounded down to the 0.5 mm step the designer's controls use.
  const barcodeHeight = clamp(Math.floor((heightMm - 2 * MARGIN_MM - textTotal - gaps) * 2) / 2, MIN_BARCODE_MM, 12);
  const total = textTotal + gaps + barcodeHeight;
  let y = Math.max(0, (heightMm - total) / 2);
  const items = {};
  for (const id of ids) {
    const base = { x: MARGIN_MM, y: round(y, 0.1), widthMm: widthMm - 2 * MARGIN_MM, rotation: 0, show: true };
    if (id === "barcode") {
      items[id] = { ...base, heightMm: barcodeHeight };
      y += barcodeHeight + GAP_MM;
    } else {
      items[id] = { ...base, ...DEFAULT_TEXT[id], italic: false, align: "center" };
      y += textHeightMm(DEFAULT_TEXT[id].sizePt) + GAP_MM;
    }
  }
  return items;
};

/** A font size rounded to the step and kept within bounds; null if unreadable. */
export const clampFont = (value) => {
  const number = Number(value);
  if (value === "" || !Number.isFinite(number)) return null;
  return clamp(round(number, FONT_STEP_PT), MIN_FONT_PT, MAX_FONT_PT);
};

/** A barcode height in mm (0.5 steps), within bounds; null if unreadable. */
export const clampBarcodeHeight = (value) => {
  const number = Number(value);
  if (value === "" || !Number.isFinite(number)) return null;
  return clamp(round(number), MIN_BARCODE_MM, MAX_BARCODE_MM);
};

/** An item width in mm (0.5 steps), from 5 mm to the label's width. */
export const clampWidth = (value, size) => {
  const number = Number(value);
  if (value === "" || !Number.isFinite(number)) return null;
  return clamp(round(number), MIN_WIDTH_MM, LABEL_MM[size].widthMm);
};

/** Whether an item is turned a quarter (standing upright). */
export const isQuarterTurn = (item) => item.rotation % 180 !== 0;

/**
 * Where an item's top-left may go along one axis so that what is seen,
 * the turned box, stays on the label. An item turns about its centre, so
 * its box (`boxMm` long on this axis) and what is seen (`seenMm`) share a
 * centre. If what is seen is longer than the label, the centre may go
 * anywhere on the label (the fit check flags it).
 */
const axisRange = (labelMm, boxMm, seenMm) => {
  const half = seenMm / 2;
  const [low, high] = seenMm <= labelMm ? [half, labelMm - half] : [0, labelMm];
  return [low - boxMm / 2, high - boxMm / 2];
};

const clampAxis = (value, [low, high], snap) => {
  // + 0 turns -0 into 0.
  if (!snap) return clamp(value, low, high) + 0;
  // Snap to 0.5 mm, inside the range when a 0.5 mm step fits in it.
  const lowStep = Math.ceil(low / POSITION_STEP_MM - 1e-9) * POSITION_STEP_MM;
  const highStep = Math.floor(high / POSITION_STEP_MM + 1e-9) * POSITION_STEP_MM;
  return (lowStep <= highStep ? clamp(round(value), lowStep, highStep) : clamp(value, low, high)) + 0;
};

/**
 * A position kept on the label, judged by what is seen: a turned item may
 * go wherever its turned box fits, even with its unturned box past the
 * edge. A move snaps to 0.5 mm; a stored position (`snap` false) is kept
 * as is, so nothing shifts on reload.
 */
export const clampPosition = (size, id, item, x, y, { snap = true } = {}) => {
  const { widthMm, heightMm } = LABEL_MM[size];
  const boxW = item.widthMm;
  const boxH = itemHeightMm(id, item);
  const [seenW, seenH] = isQuarterTurn(item) ? [boxH, boxW] : [boxW, boxH];
  return {
    x: clampAxis(x, axisRange(widthMm, boxW, seenW), snap),
    y: clampAxis(y, axisRange(heightMm, boxH, seenH), snap),
  };
};

/**
 * The longest an item may be: the label's width, or, standing upright,
 * the label's height. Leaves the 1.5 mm margin when that still allows 5 mm.
 */
export const maxWidthMm = (size, item) => {
  const { widthMm, heightMm } = LABEL_MM[size];
  return isQuarterTurn(item) ? Math.max(MIN_WIDTH_MM, heightMm - 2 * MARGIN_MM) : widthMm;
};

/**
 * Turn an item a quarter, about its centre. Standing upright, a long item
 * is shortened to the label's height, so it fits instead of crossing the
 * whole label; it then stays where it was, kept on the label.
 */
export const rotateItem = (size, id, item) => {
  const turned = { ...item, rotation: nextRotation(item.rotation) };
  const longest = maxWidthMm(size, turned);
  if (turned.widthMm > longest) {
    const shorten = turned.widthMm - longest;
    turned.widthMm = Math.floor(longest / POSITION_STEP_MM) * POSITION_STEP_MM;
    turned.x = item.x + shorten / 2;
  }
  return { ...turned, ...clampPosition(size, id, turned, turned.x, turned.y) };
};

/**
 * Apply a change to an item and keep it on the label: a wider, taller or
 * larger item is moved back if it now reaches past the edge.
 */
export const resizeItem = (size, id, item, changes) => {
  const next = { ...item, ...changes };
  return { ...next, ...clampPosition(size, id, next, next.x, next.y, { snap: false }) };
};

/** The next quarter turn. */
export const nextRotation = (rotation) => (rotation + 90) % 360;

/** Change some of one item's settings. */
export const updateItem = (layout, id, changes) => ({ ...layout, [id]: { ...layout[id], ...changes } });

const number = (value, fallback) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * A stored layout made safe against the default for its size and kind:
 * unknown or broken values fall back, positions stay on the label, and an
 * item that must print is shown.
 */
export const normalizeLayout = (stored, size, kind) => {
  const base = defaultLayout(size, kind);
  if (!stored || typeof stored !== "object") return base;
  const items = {};
  for (const id of KIND_ITEMS[kind]) {
    const saved = stored[id] && typeof stored[id] === "object" ? stored[id] : {};
    const fallback = base[id];
    const item = {
      ...fallback,
      widthMm: clampWidth(number(saved.widthMm, fallback.widthMm), size),
      rotation: ROTATIONS.includes(saved.rotation) ? saved.rotation : fallback.rotation,
      show: ITEM_INFO[id].hideable ? saved.show !== false : true,
    };
    if (id === "barcode") {
      item.heightMm = clampBarcodeHeight(number(saved.heightMm, fallback.heightMm));
    } else {
      item.sizePt = clampFont(number(saved.sizePt, fallback.sizePt));
      item.bold = typeof saved.bold === "boolean" ? saved.bold : fallback.bold;
      item.italic = typeof saved.italic === "boolean" ? saved.italic : fallback.italic;
      item.align = ALIGNMENTS.includes(saved.align) ? saved.align : fallback.align;
    }
    Object.assign(
      item,
      clampPosition(size, id, item, number(saved.x, fallback.x), number(saved.y, fallback.y), { snap: false }),
    );
    items[id] = item;
  }
  return items;
};

const STORAGE_KEY = "socio-lk-barcode-label-layouts-v2";

/** The layouts edited in this browser: { [size]: { [kind]: layout } }. */
export const loadLayouts = () => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    const layouts = {};
    for (const size of Object.keys(LABEL_MM)) {
      for (const kind of Object.keys(KIND_ITEMS)) {
        if (stored?.[size]?.[kind]) {
          layouts[size] = { ...layouts[size], [kind]: normalizeLayout(stored[size][kind], size, kind) };
        }
      }
    }
    return layouts;
  } catch {
    return {};
  }
};

/** Remember the edited layouts; storage failures are ignored. */
export const saveLayouts = (layouts) => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // Private windows or blocked storage: the layout just isn't remembered.
  }
};

/** The layout in use for a size and kind: the edited one, or the default. */
export const layoutFor = (layouts, size, kind) => layouts[size]?.[kind] ?? defaultLayout(size, kind);

/** Inline styles that place an item, in mm, turned about its centre. */
export const itemPlacement = (id, item) => ({
  left: `${item.x}mm`,
  top: `${item.y}mm`,
  width: `${item.widthMm}mm`,
  ...(id === "barcode" ? { height: `${item.heightMm}mm` } : {}),
  transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
});

/** Inline styles for a text item's text. */
export const textStyle = (item) => ({
  fontSize: `${item.sizePt}pt`,
  fontWeight: item.bold ? 700 : 400,
  fontStyle: item.italic ? "italic" : "normal",
  textAlign: item.align,
});
