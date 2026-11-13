import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  Italic,
  Lock,
  Minus,
  Palette,
  Plus,
  RotateCcw,
} from "lucide-react";
import {
  DEFAULT_DESIGN,
  FONT_STEP_PT,
  LINE_INFO,
  MAX_BARCODE_MM,
  MAX_FONT_PT,
  MIN_BARCODE_MM,
  MIN_FONT_PT,
  ROTATIONS,
  clampBarcodeHeight,
  clampFont,
  moveLine,
  updateLine,
} from "./labelDesign";

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight };
const ALIGN_NAMES = { left: "left", center: "centre", right: "right" };

const toggleClass = (on) =>
  `flex h-8 w-8 items-center justify-center ${on ? "bg-cyan-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"}`;
const groupClass = "flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-600";
const iconButton =
  "flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100";

/** A number with − and + buttons; typed values are clamped by `clamp`. */
const Stepper = ({ label, value, step, min, max, unit, clamp, onChange }) => (
  <div className="flex items-center gap-1.5">
    <div className={groupClass}>
      <button type="button" aria-label={`Smaller ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - step))} className={`${toggleClass(false)} disabled:opacity-30`}><Minus size={13} /></button>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = clamp(event.target.value);
          if (next !== null) onChange(next);
        }}
        className="h-8 w-12 border-x border-slate-300 bg-white text-center text-sm tabular-nums text-slate-900 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      />
      <button type="button" aria-label={`Larger ${label}`} disabled={value >= max} onClick={() => onChange(clamp(value + step))} className={`${toggleClass(false)} disabled:opacity-30`}><Plus size={13} /></button>
    </div>
    <span className="text-xs text-slate-500 dark:text-slate-400">{unit}</span>
  </div>
);

/**
 * Label design: the order of the lines, each text line's size, bold,
 * italic and alignment, the barcode's height and the content's rotation.
 * The brand, barcode and IMEI/serial line can't be hidden.
 */
const LabelDesignPanel = ({ design, onChange }) => {
  const isDefault = JSON.stringify(design) === JSON.stringify(DEFAULT_DESIGN);
  return (
    <section aria-labelledby="label-design-heading" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2">
        <h3 id="label-design-heading" className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100"><Palette size={17} className="text-cyan-600" />Label design</h3>
        <button type="button" onClick={() => onChange(DEFAULT_DESIGN)} disabled={isDefault} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800">
          <RotateCcw size={13} />Reset design
        </button>
      </div>

      <div role="group" aria-label="Rotation">
        <span aria-hidden="true" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Rotation</span>
        <div className={`${groupClass} w-fit`}>
          {ROTATIONS.map((rotation) => (
            <button key={rotation} type="button" aria-pressed={design.rotation === rotation} onClick={() => onChange({ ...design, rotation })} className={`h-8 px-3 text-sm tabular-nums ${design.rotation === rotation ? "bg-cyan-600 font-semibold text-white" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"}`}>
              {rotation}°
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Turns the content inside the label; the label size stays the same.</p>
      </div>

      <ol className="space-y-2" aria-label="Label lines">
        {design.order.map((id, index) => {
          const info = LINE_INFO[id];
          const line = design.lines[id];
          const hidden = line && !line.show;
          return (
            <li key={id} className={`rounded-lg border p-2.5 ${hidden ? "border-dashed border-slate-300 opacity-70 dark:border-slate-700" : "border-slate-200 dark:border-slate-700"}`}>
              <div className="flex items-center gap-2">
                <span className="w-4 text-right text-xs tabular-nums text-slate-400">{index + 1}</span>
                {info.hideable ? (
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                    <input type="checkbox" checked={line.show} onChange={(event) => onChange(updateLine(design, id, { show: event.target.checked }))} className="accent-cyan-600" />
                    <span className="truncate">{info.label}</span>
                  </label>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                    <span title="Always printed"><Lock size={13} className="text-slate-400" aria-label="Always printed" /></span>
                    <span className="truncate">{info.label}</span>
                  </span>
                )}
                <button type="button" aria-label={`Move ${info.label} up`} disabled={index === 0} onClick={() => onChange(moveLine(design, id, -1))} className={iconButton}><ArrowUp size={15} /></button>
                <button type="button" aria-label={`Move ${info.label} down`} disabled={index === design.order.length - 1} onClick={() => onChange(moveLine(design, id, 1))} className={iconButton}><ArrowDown size={15} /></button>
              </div>

              {!hidden && (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                  {id === "barcode" ? (
                    <Stepper label="Barcode height" value={design.barcodeHeightMm} step={1} min={MIN_BARCODE_MM} max={MAX_BARCODE_MM} unit="mm" clamp={clampBarcodeHeight} onChange={(barcodeHeightMm) => onChange({ ...design, barcodeHeightMm })} />
                  ) : (
                    <>
                      <Stepper label={`${info.label} text size`} value={line.sizePt} step={FONT_STEP_PT} min={MIN_FONT_PT} max={MAX_FONT_PT} unit="pt" clamp={clampFont} onChange={(sizePt) => onChange(updateLine(design, id, { sizePt }))} />
                      <div className={groupClass}>
                        <button type="button" aria-label={`Bold ${info.label}`} aria-pressed={line.bold} onClick={() => onChange(updateLine(design, id, { bold: !line.bold }))} className={toggleClass(line.bold)}><Bold size={14} /></button>
                        <button type="button" aria-label={`Italic ${info.label}`} aria-pressed={line.italic} onClick={() => onChange(updateLine(design, id, { italic: !line.italic }))} className={`${toggleClass(line.italic)} border-l border-slate-300 dark:border-slate-600`}><Italic size={14} /></button>
                      </div>
                      <div className={groupClass} role="group" aria-label={`${info.label} alignment`}>
                        {Object.entries(ALIGN_ICONS).map(([align, Icon]) => (
                          <button key={align} type="button" aria-label={`Align ${info.label} ${ALIGN_NAMES[align]}`} aria-pressed={line.align === align} onClick={() => onChange(updateLine(design, id, { align }))} className={toggleClass(line.align === align)}><Icon size={14} /></button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-slate-500 dark:text-slate-400">A long name is shortened with “…”; any other line that doesn’t fit is flagged in the preview. Saved in this browser. The preview and the printed labels use the same design.</p>
    </section>
  );
};

export default LabelDesignPanel;
