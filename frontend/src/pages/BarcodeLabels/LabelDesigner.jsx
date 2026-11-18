import { useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eye,
  EyeOff,
  Italic,
  Minus,
  MousePointerClick,
  Package,
  Plus,
  RotateCcw,
  RotateCw,
  Smartphone,
} from "lucide-react";
import {
  FONT_STEP_PT,
  ITEM_INFO,
  KIND_ITEMS,
  LABEL_MM,
  MAX_BARCODE_MM,
  MAX_FONT_PT,
  MIN_BARCODE_MM,
  MIN_FONT_PT,
  MIN_WIDTH_MM,
  POSITION_STEP_MM,
  clampBarcodeHeight,
  clampFont,
  clampPosition,
  clampWidth,
  itemPlacement,
  layoutFor,
  maxWidthMm,
  resizeItem,
  rotateItem,
  updateItem,
} from "./labelDesign";
import { ItemContent } from "./LabelFace";
import { labelProblems } from "./labelRender";

/** Screen pixels per label millimetre on the canvas. */
const SCALE = 10;
const CSS_PX_PER_MM = 96 / 25.4;

/** What the canvas shows: sample text, so it never looks like a real item. */
const SAMPLES = {
  PRODUCT: { kind: "PRODUCT", name: "Sample product name", code: "12345678", identifier: null, price: "1250.00" },
  UNIT: {
    kind: "UNIT",
    name: "Sample phone 128GB",
    code: "87654321",
    identifier: { label: "IMEI", value: "353456789012345" },
    price: "99500.00",
  },
};

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight };
const ALIGN_NAMES = { left: "left", center: "centre", right: "right" };

const group = "flex h-9 items-center overflow-hidden rounded-lg border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800";
const toggle = (on) =>
  `flex h-full w-9 items-center justify-center ${on ? "bg-cyan-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"}`;
const caption = "text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

/**
 * A number with − and + buttons, as one toolbar control. The field can be
 * cleared and retyped: only a readable number is applied, and leaving the
 * field shows the applied value again.
 */
const Stepper = ({ name, label, value, step, min, max, unit, clamp, onChange }) => {
  const [draft, setDraft] = useState(null);
  const shown = Number(value.toFixed(2));
  return (
    <div className="flex flex-col gap-1">
      <span className={caption}>{label}</span>
      <div className={group}>
        <button type="button" aria-label={`Decrease ${name}`} disabled={value <= min} onClick={() => onChange(clamp(value - step))} className={`${toggle(false)} disabled:opacity-30`}><Minus size={14} /></button>
        <input
          type="number"
          aria-label={name}
          value={draft ?? shown}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            setDraft(event.target.value);
            const next = clamp(event.target.value);
            if (next !== null) onChange(next);
          }}
          onBlur={() => setDraft(null)}
          className="h-full w-14 border-x border-slate-300 bg-transparent text-center text-sm tabular-nums text-slate-900 focus:outline-none dark:border-slate-600 dark:text-slate-100"
        />
        <button type="button" aria-label={`Increase ${name}`} disabled={value >= max} onClick={() => onChange(clamp(value + step))} className={`${toggle(false)} disabled:opacity-30`}><Plus size={14} /></button>
        {unit && <span className="pr-2 text-xs text-slate-500 dark:text-slate-400">{unit}</span>}
      </div>
    </div>
  );
};

/**
 * The visual label designer: one label drawn large. Click an item to
 * select it, drag it (or use the arrow keys) to move it, and edit it from
 * the toolbar: position, width, height, text size, bold, italic, alignment,
 * rotation and whether it prints. One layout per label size and kind; the
 * preview and the printed labels use it.
 */
const LabelDesigner = ({ size, layouts, onChange }) => {
  const [kind, setKind] = useState("PRODUCT");
  const [selected, setSelected] = useState(null);
  const [problems, setProblems] = useState(() => new Set());
  const drag = useRef(null);
  const labelRef = useRef(null);
  const layout = layoutFor(layouts, size, kind);
  const { widthMm, heightMm } = LABEL_MM[size];
  const sample = SAMPLES[kind];
  const edited = Boolean(layouts[size]?.[kind]);
  const current = selected && layout[selected] ? selected : null;
  const item = current ? layout[current] : null;
  const info = current ? ITEM_INFO[current] : null;

  const setLayout = (next) => onChange({ ...layouts, [size]: { ...layouts[size], [kind]: next } });
  const change = (id, changes) => setLayout(updateItem(layout, id, changes));
  // A size change that keeps the item on the label.
  const resize = (id, changes) => setLayout(updateItem(layout, id, resizeItem(size, id, layout[id], changes)));
  const moveTo = (id, x, y) => change(id, clampPosition(size, id, layout[id], x, y));
  const resetLayout = () => {
    const rest = { ...layouts[size] };
    delete rest[kind];
    onChange({ ...layouts, [size]: rest });
  };

  useLayoutEffect(() => {
    if (!labelRef.current) return;
    const next = labelProblems(labelRef.current);
    setProblems((prev) => (prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next));
  }, [layout, size, kind]);

  const startDrag = (event, id) => {
    setSelected(id);
    if (event.button !== undefined && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { id, startX: event.clientX, startY: event.clientY, x: layout[id].x, y: layout[id].y };
  };
  const moveDrag = (event) => {
    const active = drag.current;
    if (!active) return;
    moveTo(active.id, active.x + (event.clientX - active.startX) / SCALE, active.y + (event.clientY - active.startY) / SCALE);
  };
  const endDrag = () => {
    drag.current = null;
  };
  const nudge = (event, id) => {
    const step = event.shiftKey ? 2 : POSITION_STEP_MM;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (event.key === "Escape") return setSelected(null);
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setSelected(id);
    moveTo(id, layout[id].x + move[0], layout[id].y + move[1]);
  };

  const kindButton = (value, text, Icon) => (
    <button type="button" aria-pressed={kind === value} onClick={() => { setKind(value); setSelected(null); }} className={`flex items-center gap-1.5 px-3 text-sm font-medium ${kind === value ? "bg-cyan-600 text-white" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"}`}>
      <Icon size={15} />{text}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className={caption}>Template</span>
          <div className={group} role="group" aria-label="Template">
            {kindButton("PRODUCT", "Product label", Package)}
            {kindButton("UNIT", "Unit label (IMEI / serial)", Smartphone)}
          </div>
        </div>
        <button type="button" onClick={resetLayout} disabled={!edited} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          <RotateCcw size={15} />Reset layout
        </button>
      </div>

      {/* Every item, selectable even when another covers it on the canvas */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={caption}>Item</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Select item">
          {KIND_ITEMS[kind].map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={current === id}
              onClick={() => setSelected(id)}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                current === id
                  ? "border-cyan-600 bg-cyan-600 text-white"
                  : problems.has(id)
                    ? "border-red-300 text-red-700 dark:border-red-500/50 dark:text-red-300"
                    : "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              } ${layout[id].show ? "" : "opacity-60"}`}
            >
              {problems.has(id) && <AlertTriangle size={12} />}
              {ITEM_INFO[id].label}
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar for the selected item */}
      <div role="toolbar" aria-label="Selected item" className="min-h-17 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
        {!item ? (
          <p className="flex h-full items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <MousePointerClick size={18} className="shrink-0 text-cyan-600" />
            Click an item on the label to edit it. Drag it to move it, or use the arrow keys (Shift for bigger steps).
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div className="flex flex-col gap-1">
              <span className={caption}>Selected</span>
              <span className="flex h-9 items-center rounded-lg bg-cyan-600/10 px-3 text-sm font-semibold text-cyan-700 dark:text-cyan-300">{info.label}</span>
            </div>
            <Stepper name="X position" label="X" value={item.x} step={POSITION_STEP_MM} min={-item.widthMm} max={widthMm} unit="mm" clamp={(v) => (v === "" || !Number.isFinite(Number(v)) ? null : Number(v))} onChange={(x) => moveTo(current, x, item.y)} />
            <Stepper name="Y position" label="Y" value={item.y} step={POSITION_STEP_MM} min={-item.widthMm} max={heightMm} unit="mm" clamp={(v) => (v === "" || !Number.isFinite(Number(v)) ? null : Number(v))} onChange={(y) => moveTo(current, item.x, y)} />
            <Stepper name="Width" label="Width" value={item.widthMm} step={POSITION_STEP_MM} min={MIN_WIDTH_MM} max={maxWidthMm(size, item)} unit="mm" clamp={(v) => { const w = clampWidth(v, size); return w === null ? null : Math.min(w, maxWidthMm(size, item)); }} onChange={(w) => resize(current, { widthMm: w })} />
            {current === "barcode" ? (
              <Stepper name="Height" label="Height" value={item.heightMm} step={POSITION_STEP_MM} min={MIN_BARCODE_MM} max={MAX_BARCODE_MM} unit="mm" clamp={clampBarcodeHeight} onChange={(h) => resize(current, { heightMm: h })} />
            ) : (
              <>
                <Stepper name="Font size" label="Font size" value={item.sizePt} step={FONT_STEP_PT} min={MIN_FONT_PT} max={MAX_FONT_PT} unit="pt" clamp={clampFont} onChange={(sizePt) => resize(current, { sizePt })} />
                <div className="flex flex-col gap-1">
                  <span className={caption}>Style</span>
                  <div className={group}>
                    <button type="button" aria-label="Bold" aria-pressed={item.bold} onClick={() => change(current, { bold: !item.bold })} className={toggle(item.bold)}><Bold size={15} /></button>
                    <button type="button" aria-label="Italic" aria-pressed={item.italic} onClick={() => change(current, { italic: !item.italic })} className={`${toggle(item.italic)} border-l border-slate-300 dark:border-slate-600`}><Italic size={15} /></button>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className={caption}>Align</span>
                  <div className={group} role="group" aria-label="Align">
                    {Object.entries(ALIGN_ICONS).map(([align, Icon]) => (
                      <button key={align} type="button" aria-label={`Align ${ALIGN_NAMES[align]}`} aria-pressed={item.align === align} onClick={() => change(current, { align })} className={toggle(item.align === align)}><Icon size={15} /></button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <div className="flex flex-col gap-1">
              <span className={caption}>Rotate</span>
              <button type="button" aria-label={`Rotate (now ${item.rotation}°)`} onClick={() => setLayout(updateItem(layout, current, rotateItem(size, current, item)))} className={`${group} gap-1.5 px-3 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700`}>
                <RotateCw size={15} /><span className="tabular-nums">{item.rotation}°</span>
              </button>
            </div>
            {info.hideable && (
              <div className="flex flex-col gap-1">
                <span className={caption}>On label</span>
                <button type="button" aria-pressed={item.show} onClick={() => change(current, { show: !item.show })} className={`${group} gap-1.5 px-3 text-sm ${item.show ? "text-slate-700 dark:text-slate-200" : "text-amber-700 dark:text-amber-300"}`}>
                  {item.show ? <><Eye size={15} />Shown</> : <><EyeOff size={15} />Hidden</>}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* The canvas: the label drawn at SCALE px per mm */}
      <div className="flex justify-center overflow-x-auto rounded-xl bg-slate-200/70 p-6 dark:bg-slate-950/70" onPointerDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <div className="shrink-0" style={{ width: `${widthMm * SCALE}px`, height: `${heightMm * SCALE}px` }}>
          <div style={{ transform: `scale(${SCALE / CSS_PX_PER_MM})`, transformOrigin: "top left", width: "max-content" }}>
            <article ref={labelRef} aria-label={`${kind === "PRODUCT" ? "Product" : "Unit"} label design, ${widthMm} × ${heightMm} mm`} className="barcode-label designer-canvas shadow-xl ring-1 ring-slate-300" style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}>
              {KIND_ITEMS[kind].map((id) => {
                const placed = layout[id];
                const isSelected = current === id;
                const bad = problems.has(id);
                return (
                  <div
                    key={id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${ITEM_INFO[id].label}${placed.show ? "" : " (hidden)"}`}
                    aria-pressed={isSelected}
                    data-item={id}
                    onPointerDown={(event) => startDrag(event, id)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={(event) => nudge(event, id)}
                    onFocus={() => setSelected(id)}
                    className={`barcode-item barcode-${id} designer-item ${isSelected ? "designer-selected" : ""} ${bad ? "designer-bad" : ""} ${placed.show ? "" : "designer-hidden"}`}
                    style={{ ...itemPlacement(id, placed), zIndex: isSelected ? 2 : 1 }}
                  >
                    <ItemContent id={id} label={sample} item={placed} decorative />
                  </div>
                );
              })}
            </article>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>Sample text · {widthMm} × {heightMm} mm · saved in this browser for this size</span>
        {problems.size > 0 && (
          <span role="status" className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle size={14} />
            {KIND_ITEMS[kind].filter((id) => problems.has(id)).map((id) => ITEM_INFO[id].label).join(", ")}: past the label edge, overlapping another item, or cut short.
          </span>
        )}
      </div>

      <style>{`
        .designer-canvas { overflow:visible; }
        .designer-item { cursor:move; touch-action:none; user-select:none; outline:0.15mm dashed transparent; outline-offset:0.2mm; }
        .designer-item:hover { outline-color:#94a3b8; }
        .designer-item:focus-visible, .designer-selected { outline:0.25mm solid #0891b2 !important; }
        .designer-bad { outline:0.25mm solid #dc2626 !important; }
        .designer-hidden { opacity:.3; }
      `}</style>
    </div>
  );
};

export default LabelDesigner;
