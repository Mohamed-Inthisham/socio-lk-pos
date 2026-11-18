/**
 * Plain helpers for drawing labels (no React components), shared by the
 * designer, the preview and the printed sheet.
 */

export const money = (value) =>
  value === null || value === undefined || value === ""
    ? ""
    : new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 2 }).format(Number(value));

/** The text a label item holds, or null when that label has none. */
export const itemText = (id, label) => {
  if (id === "brand") return "SOCIO.LK";
  if (id === "name") return label.name;
  if (id === "code") return label.code;
  if (id === "identifier") return label.identifier ? `${label.identifier.label} ${label.identifier.value}` : null;
  if (id === "price") return label.price ? money(label.price) : null;
  return null;
};

/** The kind of a label: a unit label carries an IMEI or serial number. */
export const labelKind = (label) => label.kind ?? (label.identifier ? "UNIT" : "PRODUCT");

/** How far two boxes overlap, as the smaller of the two overlaps (px). */
const overlap = (a, b) =>
  Math.min(Math.min(a.right, b.right) - Math.max(a.left, b.left), Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * The items of a drawn label that don't fit: past the label's edge,
 * overlapping another item (both are flagged), or a text cut short with
 * "…". Boxes are measured on screen, so turns count. A long name is
 * shortened by design, so it never counts as cut short. Items the designer
 * shows faded (hidden from print) don't count.
 */
export const labelProblems = (article) => {
  const problems = new Set();
  const box = article.getBoundingClientRect();
  const placed = [];
  for (const element of article.querySelectorAll(".barcode-item:not(.designer-hidden)")) {
    const id = [...element.classList]
      .find((name) => name.startsWith("barcode-") && name !== "barcode-item")
      ?.replace("barcode-", "");
    const r = element.getBoundingClientRect();
    const outside =
      r.left < box.left - 0.5 || r.top < box.top - 0.5 || r.right > box.right + 0.5 || r.bottom > box.bottom + 0.5;
    const text = element.querySelector(".barcode-text");
    const cutShort = id !== "name" && text && text.scrollWidth > text.clientWidth + 1;
    if (outside || cutShort) problems.add(id);
    for (const other of placed) {
      if (overlap(r, other.r) > 1) {
        problems.add(id);
        problems.add(other.id);
      }
    }
    placed.push({ id, r });
  }
  return problems;
};

/** The CSS every drawn label needs, on screen and in print. */
export const LABEL_CSS = `
  .barcode-label { box-sizing:border-box; position:relative; overflow:hidden; background:#fff; color:#111827; }
  .barcode-item { position:absolute; transform-origin:center; }
  .barcode-text { width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:Arial,sans-serif; line-height:1.15; letter-spacing:.2px; }
  .barcode-brand .barcode-text { letter-spacing:.6px; }
  .barcode-svg { display:block; width:100%; height:100%; }
`;
