import { useCallback, useEffect, useRef, useState } from "react";
import { hasMoreBelow } from "../../../utils/scroll";

/**
 * ScrollFade Component
 *
 * A scroll area with a "more below" cue: a soft fade at its bottom edge,
 * shown only while there is content below the visible part, hidden once
 * scrolled to the end (or when nothing overflows). Used by the sale
 * detail page's Items and Tenders lists (P6-6).
 *
 * The fade is drawn over the bottom of the visible area (pointer-events
 * off), in the card's own background colour (`fadeClassName`), so it works
 * in light and dark mode. The area scrolls only where `scrollClassName`
 * says so (e.g. `lg:overflow-y-auto`): where it doesn't scroll, nothing
 * overflows and the fade never shows.
 *
 * PROPS:
 * - className: the wrapper (sizing in the parent's layout)
 * - scrollClassName: the scrolling element
 * - fadeClassName: gradient colours (default: white / slate-900, the Card)
 * - testId: data-testid of the scrolling element
 */

const ScrollFade = ({
  className = "",
  scrollClassName = "",
  fadeClassName = "from-white dark:from-slate-900",
  testId,
  children,
}) => {
  const ref = useRef(null);
  const [more, setMore] = useState(false);

  const update = useCallback(() => {
    if (ref.current) setMore(hasMoreBelow(ref.current));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    update();
    // Size changes (viewport, a line wrapping) and content changes.
    const resize = new ResizeObserver(update);
    resize.observe(el);
    if (el.firstElementChild) resize.observe(el.firstElementChild);
    const mutation = new MutationObserver(update);
    mutation.observe(el, { childList: true, subtree: true });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [update]);

  return (
    <div className={`relative ${className}`}>
      <div ref={ref} onScroll={update} className={scrollClassName} data-testid={testId}>
        {children}
      </div>
      <div
        aria-hidden="true"
        data-testid={testId ? `${testId}-fade` : undefined}
        data-visible={more ? "true" : "false"}
        className={`
          pointer-events-none absolute inset-x-0 bottom-0 h-8
          bg-linear-to-t ${fadeClassName} to-transparent
          transition-opacity duration-150
          ${more ? "opacity-100" : "opacity-0"}
        `}
      />
    </div>
  );
};

export default ScrollFade;
