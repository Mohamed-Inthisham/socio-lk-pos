/**
 * Scroll helpers.
 */

/**
 * True while more than a pixel of content is below the visible part of a
 * scrolling element (ScrollFade's "more below" cue). The pixel absorbs
 * fractional scroll positions at the end.
 *
 * @param {{ scrollTop: number, scrollHeight: number, clientHeight: number }} el
 */
export const hasMoreBelow = ({ scrollTop, scrollHeight, clientHeight }) =>
  scrollHeight - scrollTop - clientHeight > 1;
