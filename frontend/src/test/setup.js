import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom lacks these; themeStore (matchMedia) and Headless UI anchoring
// (ResizeObserver) touch them at import / mount time.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom doesn't implement printing (it only logs "Not implemented").
// Receipts call window.print() (utils/printReceipt.js); tests spy on it.
window.print = () => {};

// jsdom never loads images, so an <img> never becomes `complete` and
// printReceipt would wait out its 2s cap for the logo on every print.
Object.defineProperty(HTMLImageElement.prototype, "complete", {
  configurable: true,
  get: () => true,
});

afterEach(() => {
  cleanup();
});
