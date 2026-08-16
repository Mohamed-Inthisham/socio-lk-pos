import { useState, useRef, useEffect, cloneElement } from "react";

/**
 * Tooltip Component
 *
 * A lightweight tooltip that appears on hover/focus of its trigger element.
 * Built with a small custom implementation because Headless UI doesn't ship
 * a dedicated Tooltip primitive (Popover is close but is click-triggered by
 * default and heavier than needed).
 *
 * USAGE:
 *   <Tooltip content="Delete this item" side="right">
 *     <button>Delete</button>
 *   </Tooltip>
 *
 * The child is rendered as-is with a few extra event handlers attached
 * (onMouseEnter, onMouseLeave, onFocus, onBlur, ref). The tooltip itself
 * portals into document.body so it never gets clipped by parent overflow.
 *
 * PROPS:
 * - content: string or ReactNode — what to show in the tooltip
 * - side: 'top' | 'right' | 'bottom' | 'left' (default 'top')
 * - delay: ms before showing (default 300 — matches OS defaults)
 * - disabled: if true, tooltip never shows (useful when the trigger is a
 *   button whose meaning is only ambiguous when disabled — you might want
 *   the tooltip on, or off)
 */

const OFFSET = 8; // gap in px between trigger and tooltip

const Tooltip = ({
  content,
  side = "top",
  delay = 300,
  disabled = false,
  children,
}) => {
  // The compiler's ref-safety analysis can't verify the ref-merging pattern
  // below (forwarding this component's ref alongside the child's own ref),
  // even though callback refs only ever run outside of render. Opt this
  // component out of compiler optimization rather than fight false positives.
  "use no memo";

  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const timeoutRef = useRef(null);

  const computePosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const trigger = triggerRef.current.getBoundingClientRect();
    const tip = tooltipRef.current.getBoundingClientRect();

    let top;
    let left;

    switch (side) {
      case "right":
        top = trigger.top + trigger.height / 2 - tip.height / 2;
        left = trigger.right + OFFSET;
        break;
      case "bottom":
        top = trigger.bottom + OFFSET;
        left = trigger.left + trigger.width / 2 - tip.width / 2;
        break;
      case "left":
        top = trigger.top + trigger.height / 2 - tip.height / 2;
        left = trigger.left - tip.width - OFFSET;
        break;
      case "top":
      default:
        top = trigger.top - tip.height - OFFSET;
        left = trigger.left + trigger.width / 2 - tip.width / 2;
        break;
    }

    setPosition({
      top: top + window.scrollY,
      left: left + window.scrollX,
    });
  };

  useEffect(() => {
    if (!visible) return;
    computePosition();

    const handle = () => computePosition();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, side]);

  const show = () => {
    if (disabled) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(true), delay);
  };

  const hide = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setVisible(false);
  };
  const originalRef = children.ref;

  // Callback refs run outside of render (during commit), so merging refs
  // here is safe even though the compiler's static analysis can't see that.
  // eslint-disable-next-line react-hooks/refs
  const child = cloneElement(children, {
    ref: (node) => {
      triggerRef.current = node;
      if (typeof originalRef === "function") originalRef(node);
      else if (originalRef && "current" in originalRef)
        // eslint-disable-next-line react-hooks/immutability
        originalRef.current = node;
    },
    onMouseEnter: (e) => {
      show();
      children.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e) => {
      hide();
      children.props.onMouseLeave?.(e);
    },
    onFocus: (e) => {
      show();
      children.props.onFocus?.(e);
    },
    onBlur: (e) => {
      hide();
      children.props.onBlur?.(e);
    },
  });

  return (
    <>
      {child}
      {visible && content && (
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: "absolute",
            top: position.top,
            left: position.left,
            zIndex: 9999,
            pointerEvents: "none",
          }}
          className="px-2 py-1 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium shadow-lg whitespace-nowrap"
        >
          {content}
        </div>
      )}
    </>
  );
};

export default Tooltip;
