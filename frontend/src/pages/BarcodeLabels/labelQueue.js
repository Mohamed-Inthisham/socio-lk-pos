/**
 * The Barcode Labels queue, as plain functions (no React): what the page
 * keeps, what it sends to POST /barcode-labels/resolve, and how it reads the
 * answer. The server is authoritative; these only keep the page honest
 * about what it will ask for.
 */

/** The server's limit on one resolved queue (MAX_LABELS_PER_QUEUE). */
export const MAX_LABELS = 500;

/** One product's copies: the quantity field's bounds. */
export const MIN_COPIES = 1;
export const MAX_COPIES = MAX_LABELS;

/** A queue entry's identity: a product, or one physical unit. */
export const entryKey = (kind, id) => `${kind}:${id}`;

/** A queue entry for a product search row: one copy to start with. */
export const productEntry = (row) => ({
  kind: "PRODUCT",
  key: entryKey("PRODUCT", row.product_id),
  productId: row.product_id,
  name: row.name,
  sku: row.sku,
  selling_price: row.selling_price,
  quantity: 1,
});

/** A queue entry for a unit search row: always one label. */
export const unitEntry = (row) => ({
  kind: "UNIT",
  key: entryKey("UNIT", row.unit_id),
  unitId: row.unit_id,
  unit_code: row.unit_code,
  name: row.name,
  identifier: row.identifier,
  identifier_type: row.identifier_type,
  branch: row.branch,
});

/**
 * Add an entry at the end, unless it is already queued: a product's copies
 * are its quantity, and a unit is one physical item. Returns the same array
 * when nothing changes.
 */
export const addEntry = (queue, entry) =>
  queue.some((item) => item.key === entry.key) ? queue : [...queue, entry];

/** A typed copies value as a whole number within bounds (1 when unreadable). */
export const clampCopies = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return MIN_COPIES;
  return Math.max(MIN_COPIES, Math.min(MAX_COPIES, parsed));
};

/** Labels the queue would print: each product's copies, plus one per unit. */
export const countLabels = (queue) =>
  queue.reduce((sum, item) => sum + (item.kind === "PRODUCT" ? item.quantity : 1), 0);

/** The resolve request items, in queue order, with only their type's fields. */
export const toResolveItems = (queue) =>
  queue.map((item) =>
    item.kind === "PRODUCT"
      ? { type: "PRODUCT", productId: item.productId, quantity: item.quantity }
      : { type: "UNIT", unitId: item.unitId },
  );

/** Identifies one exact request, to tell whether a preview is still current. */
export const queueSignature = (queue) => JSON.stringify(toResolveItems(queue));

/** The readable label for a unit's real identifier. */
export const identifierLabel = (type) => (type === "SERIAL_NUMBER" ? "S/N" : "IMEI");

/**
 * The printable labels of a resolved queue, in order: a PRODUCT row its
 * `quantity` times, encoding the product's barcode; a UNIT row once,
 * encoding its unit_code, with the IMEI or serial number as text only.
 * Only server fields are used, and no cost field exists on them.
 */
export const expandLabels = (rows) =>
  rows.flatMap((row, rowIndex) => {
    if (row.kind === "PRODUCT") {
      return Array.from({ length: row.quantity }, (_, copy) => ({
        key: `${rowIndex}-${row.product_id}-${copy}`,
        kind: "PRODUCT",
        name: row.name,
        code: row.barcode,
        identifier: null,
        price: row.selling_price,
      }));
    }
    return [
      {
        key: `${rowIndex}-${row.unit_id}`,
        kind: "UNIT",
        name: row.name,
        code: row.unit_code,
        identifier: { label: identifierLabel(row.identifier_type), value: row.identifier },
        price: row.selling_price,
      },
    ];
  });

/**
 * The screen preview's rows: one per resolved row, in order. A product's
 * copies are identical, so it is shown once with its copy count (the print
 * sheet still prints every copy, from expandLabels). `first` and `last` are
 * the row's label numbers on the sheet, counting from 1.
 */
export const previewEntries = (rows) => {
  let next = 1;
  return rows.map((row, rowIndex) => {
    const copies = row.kind === "PRODUCT" ? row.quantity : 1;
    const [label] = expandLabels([row]);
    const entry = {
      key: `${rowIndex}-${row.kind === "PRODUCT" ? row.product_id : row.unit_id}`,
      kind: row.kind,
      label,
      copies,
      first: next,
      last: next + copies - 1,
    };
    next += copies;
    return entry;
  });
};

const GENERIC_ERROR = "Couldn't prepare the labels. Try again.";

/**
 * Read a failed resolve. `sent` is the queue as it was sent, so an error's
 * `index` names the entry it is about.
 *
 * @returns {{ message: string, itemErrors: Record<string, string> }}
 */
export const describeResolveError = (error, sent) => {
  const body = error?.response?.data;
  if (!body) return { message: GENERIC_ERROR, itemErrors: {} };

  if (body.code === "INVALID_LABEL_ITEMS" && Array.isArray(body.errors)) {
    const itemErrors = {};
    for (const problem of body.errors) {
      const entry = sent[problem.index];
      if (!entry) continue;
      itemErrors[entry.key] = itemErrors[entry.key]
        ? `${itemErrors[entry.key]} ${problem.message}`
        : problem.message;
    }
    const count = body.errors.length;
    return {
      message: `${count} ${count === 1 ? "item" : "items"} in the queue can't be printed. Remove or change ${count === 1 ? "it" : "them"}, then preview again. Nothing will print until every item is valid.`,
      itemErrors,
    };
  }

  const message = Array.isArray(body.message) ? body.message.join("; ") : body.message;
  return { message: message || GENERIC_ERROR, itemErrors: {} };
};
