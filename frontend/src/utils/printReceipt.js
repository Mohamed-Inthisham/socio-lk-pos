import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Receipt from "../components/pos/Receipt";
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
 * @param {Object} sale - the hydrated COMPLETED sale
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

export const printReceipt = async (sale) => {
  const el = container();
  flushSync(() => root.render(createElement(Receipt, { sale })));
  await imagesLoaded(el);
  const heightMm = receiptPageHeightMm(el.firstElementChild.getBoundingClientRect().height);
  setPageSize(heightMm);
  window.print();
  return heightMm;
};
