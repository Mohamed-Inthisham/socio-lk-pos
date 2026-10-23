import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Receipt from "../components/pos/Receipt";
import ReturnSlip from "../components/pos/ReturnSlip";
import { RECEIPT_LAYOUT } from "../constants/receipt";

/**
 * Print a sale's receipt on the till's printer (planning doc P5-12, P5-13).
 *
 * Browser printing through the Windows driver: the receipt is rendered
 * into #receipt-root — a sibling of the app, laid out off-screen so it can
 * be measured, and the only thing @media print shows (index.css). Then:
 * 1. wait for the logo to load (an unloaded image prints blank);
 * 2. measure the receipt, add 1mm of slack, never less than 90mm (shorter
 *    pages print sideways), and set `@page { size: 72mm <h>mm; margin: 0 }`
 *    — one page, one cut, no blank paper fed after it;
 * 3. window.print(). With Chrome/Edge started with --kiosk-printing this
 *    prints straight to the default printer with the last-used print
 *    settings (till setup, step F); otherwise the print dialog opens.
 *
 * The receipt stays rendered (hidden) until the next print; nothing reads
 * it, and it lets a print preview be taken after the fact.
 *
 * @param {Object} sale - the hydrated COMPLETED or VOIDED sale (a VOIDED
 *   one prints "VOIDED — NOT VALID", P6-7)
 * @param {Object} [options]
 * @param {string} [options.reprintedAt] - ISO time; a detail-page reprint
 *   prints "REPRINT · <time>" (P6-7). Omit it for the Sale complete panel
 *   and "Last receipt" (unmarked, P5-12).
 * @returns {Promise<number>} the page height used, in mm
 */

const MM_PER_PX = 25.4 / 96;
const ROOT_ID = "receipt-root";
const PAGE_STYLE_ID = "receipt-page-size";

let root = null;

const container = () => {
  let el = document.getElementById(ROOT_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    root = null;
  }
  root ??= createRoot(el);
  return el;
};

const setPageSize = (heightMm) => {
  let style = document.getElementById(PAGE_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = PAGE_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${RECEIPT_LAYOUT.pageWidthMm}mm ${heightMm}mm; margin: 0; }`;
};

/** Never hold a receipt back longer than this for its logo. */
export const IMAGE_WAIT_MS = 2000;

// `complete` also covers a broken image: the receipt then prints without
// the logo rather than not at all.
const imagesLoaded = (el) =>
  Promise.race([
    Promise.all(
      [...el.querySelectorAll("img")].map((img) =>
        img.complete
          ? null
          : new Promise((resolve) => {
              img.addEventListener("load", resolve, { once: true });
              img.addEventListener("error", resolve, { once: true });
            }),
      ),
    ),
    new Promise((resolve) => setTimeout(resolve, IMAGE_WAIT_MS)),
  ]);

/** The page height for a rendered receipt this tall (px). */
export const receiptPageHeightMm = (heightPx) =>
  Math.max(
    Math.ceil(heightPx * MM_PER_PX) + RECEIPT_LAYOUT.slackMm,
    RECEIPT_LAYOUT.minPageHeightMm,
  );

/**
 * Render one paper (a receipt, or one copy of a return slip) into
 * #receipt-root, wait for its logo, size the page to it and print it: one
 * print job. Resolves once window.print() has returned.
 */
const printElement = async (element) => {
  const el = container();
  flushSync(() => root.render(element));
  await imagesLoaded(el);
  const heightMm = receiptPageHeightMm(el.firstElementChild.getBoundingClientRect().height);
  setPageSize(heightMm);
  window.print();
  return heightMm;
};

export const printReceipt = (sale, { reprintedAt } = {}) =>
  printElement(createElement(Receipt, { sale, reprintedAt }));

/** The copies of a return slip, in the order they print (P7-17). */
export const RETURN_SLIP_COPIES = ["customer", "shop"];

/**
 * Print a recorded return's slip (planning doc P7-17): the customer's
 * copy, then the shop's (with a signature line when cash went back), as
 * two print jobs, so each gets its own page height and its own cut. The
 * shop copy is rendered, measured and printed only after the customer
 * copy's window.print() has returned (with --kiosk-printing, once that job
 * is spooled; otherwise when its print dialog closes).
 *
 * @param {Object} sale - the hydrated sale, with returns[]
 * @param {string} returnId - which of its returns
 * @param {Object} [options]
 * @param {string} [options.reprintedAt] - ISO time; a reprint from the
 *   sale's Returns section (step E) prints "REPRINT · <time>". The Return
 *   recorded panel's automatic print and its Print again pass nothing.
 * @returns {Promise<number[]>} the page heights used, in mm, per copy
 */
export const printReturnSlip = async (sale, returnId, { reprintedAt } = {}) => {
  const ret = sale.returns?.find((r) => r.id === returnId);
  if (!ret) throw new Error(`Return ${returnId} is not on sale ${sale.id}`);
  const heights = [];
  for (const copy of RETURN_SLIP_COPIES) {
    heights.push(await printElement(createElement(ReturnSlip, { sale, ret, copy, reprintedAt })));
  }
  return heights;
};
