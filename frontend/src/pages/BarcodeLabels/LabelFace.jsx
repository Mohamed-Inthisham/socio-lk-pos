import { code128Bars } from "../../utils/code128";
import { KIND_ITEMS, LABEL_MM, itemPlacement, layoutFor, textStyle } from "./labelDesign";
import { itemText, labelKind } from "./labelRender";

/**
 * A Code 128 barcode filling its item's box. preserveAspectRatio="none":
 * every bar scales by the same factor, so the code reads the same.
 * `decorative` hides it from assistive tech (the designer's sample).
 */
export const BarcodeSvg = ({ value, decorative = false }) => {
  const encoded = code128Bars(value);
  if (!encoded) return <div className="text-xs text-red-600">Code cannot be printed</div>;
  const quiet = 10;
  return (
    <svg
      viewBox={`0 0 ${encoded.width + quiet * 2} 48`}
      preserveAspectRatio="none"
      className="barcode-svg"
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": `Barcode ${value}` })}
    >
      <rect width="100%" height="100%" fill="white" />
      {encoded.bars.map((bar, index) => (
        <rect key={index} x={bar.x + quiet} y="0" width={bar.width} height="48" fill="black" />
      ))}
    </svg>
  );
};

/** What goes inside an item's box: the barcode, or the item's text. */
export const ItemContent = ({ id, label, item, decorative = false }) =>
  id === "barcode" ? (
    <BarcodeSvg value={label.code} decorative={decorative} />
  ) : (
    <div className="barcode-text" style={textStyle(item)}>{itemText(id, label)}</div>
  );

/**
 * One label at its printed size, its items placed by the layout for its
 * size and kind. The preview and the printed sheet both draw this.
 */
export const LabelFace = ({ label, size, layouts }) => {
  const kind = labelKind(label);
  const layout = layoutFor(layouts, size, kind);
  const { widthMm, heightMm } = LABEL_MM[size];
  return (
    <article className="barcode-label" style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}>
      {KIND_ITEMS[kind].map((id) => {
        const item = layout[id];
        if (!item.show || (id !== "barcode" && itemText(id, label) === null)) return null;
        return (
          <div key={id} className={`barcode-item barcode-${id}`} style={itemPlacement(id, item)}>
            <ItemContent id={id} label={label} item={item} />
          </div>
        );
      })}
    </article>
  );
};
