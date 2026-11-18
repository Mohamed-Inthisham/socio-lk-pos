import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { BarcodeSvg } from "../BarcodeLabels/LabelFace";
import { LABEL_CSS } from "../BarcodeLabels/labelRender";

const SIZES = {
  "30x20": { width: 30, height: 20 },
  "40x20": { width: 40, height: 20 },
  "50x25": { width: 50, height: 25 },
};

const BarcodeTest = () => {
  const [value, setValue] = useState("12345678");
  const [size, setSize] = useState("30x20");
  const [printRoot] = useState(() => {
    const element = document.createElement("div");
    element.id = "barcode-test-print-root";
    return element;
  });
  const dimensions = SIZES[size];
  const labelWidth = `${dimensions.width}mm`;
  const labelHeight = `${dimensions.height}mm`;

  useEffect(() => {
    document.body.appendChild(printRoot);
    return () => printRoot.remove();
  }, [printRoot]);

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Barcode Scanner Test</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Enter a value, print one sticker, then scan it. Try the same value at each label size.
        </p>
      </header>

      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-[1fr_220px]">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          Barcode value
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={80}
            placeholder="Type letters or numbers"
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-slate-900 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          Sticker size
          <select
            value={size}
            onChange={(event) => setSize(event.target.value)}
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-900 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {Object.keys(SIZES).map((option) => <option key={option} value={option}>{option} mm</option>)}
          </select>
        </label>
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">Value length: {value.length} characters</p>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!value.trim()}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-cyan-600 px-4 text-sm font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer size={16} /> Print test label
          </button>
        </div>
      </section>

      <section className="space-y-2" aria-label="Label preview">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Preview ({size} mm)</p>
        <div className="inline-block rounded-lg bg-slate-200 p-5 dark:bg-slate-800">
          <div className="test-preview-frame" style={{ width: `${dimensions.width * 3}mm`, height: `${dimensions.height * 3}mm` }}>
            <div className="test-label test-preview-label" style={{ width: labelWidth, height: labelHeight }}>
              {value.trim() && <>
                <div className="test-bars"><BarcodeSvg value={value} /></div>
                <div className="test-value">{value}</div>
              </>}
            </div>
          </div>
        </div>
      </section>

      <p className="text-sm text-slate-500 dark:text-slate-400">
        For a fair comparison, keep the print scale at 100% and change only the sticker size or barcode value.
      </p>

      {createPortal(
        <div className="barcode-test-print" aria-hidden="true">
          <div className="test-label" style={{ width: labelWidth, height: labelHeight }}>
            {value.trim() && <>
              <div className="test-bars"><BarcodeSvg value={value} /></div>
              <div className="test-value">{value}</div>
            </>}
          </div>
        </div>,
        printRoot,
      )}

      <style>{`
        ${LABEL_CSS}
        .test-label { box-sizing:border-box; position:relative; overflow:hidden; background:white; color:#111; }
        .test-preview-label { transform:scale(3); transform-origin:top left; }
        .test-bars { position:absolute; left:1.5mm; right:1.5mm; top:2mm; height:${Math.min(10, dimensions.height * 0.5)}mm; }
        .test-value { position:absolute; left:1mm; right:1mm; bottom:1mm; overflow:hidden; text-align:center; white-space:nowrap; font:7pt Arial,sans-serif; }
        .barcode-test-print { display:none; }
        @media print {
          @page { size:${labelWidth} ${labelHeight}; margin:0; }
          body * { visibility:hidden !important; }
          .barcode-test-print, .barcode-test-print * { visibility:visible !important; }
          .barcode-test-print { display:block !important; position:absolute !important; inset:0 auto auto 0 !important; width:${labelWidth} !important; margin:0 !important; padding:0 !important; }
          .barcode-test-print .test-label { break-after:page; page-break-after:always; }
          .barcode-test-print .barcode-svg { shape-rendering:crispEdges; }
        }
      `}</style>
    </main>
  );
};

export default BarcodeTest;
