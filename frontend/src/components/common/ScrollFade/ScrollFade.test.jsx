import { act, fireEvent, render, screen } from "@testing-library/react";
import ScrollFade from ".";
import { hasMoreBelow } from "../../../utils/scroll";

describe("hasMoreBelow", () => {
  it("is true while content remains below the visible part", () => {
    expect(hasMoreBelow({ scrollTop: 0, scrollHeight: 600, clientHeight: 300 })).toBe(true);
    expect(hasMoreBelow({ scrollTop: 298, scrollHeight: 600, clientHeight: 300 })).toBe(true);
  });

  it("is false at the end, within a pixel (fractional scroll positions)", () => {
    expect(hasMoreBelow({ scrollTop: 300, scrollHeight: 600, clientHeight: 300 })).toBe(false);
    expect(hasMoreBelow({ scrollTop: 299.4, scrollHeight: 600, clientHeight: 300 })).toBe(false);
  });

  it("is false when nothing overflows", () => {
    expect(hasMoreBelow({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 })).toBe(false);
  });
});

describe("ScrollFade", () => {
  // jsdom has no layout: give the scroller the sizes a browser would.
  const size = (el, { scrollHeight, clientHeight, scrollTop = 0 }) => {
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
    el.scrollTop = scrollTop;
  };
  const fade = () => screen.getByTestId("list-fade");
  const scroller = () => screen.getByTestId("list");

  it("shows the fade while there's more below and hides it at the end", () => {
    render(
      <ScrollFade testId="list">
        <p>rows</p>
      </ScrollFade>,
    );
    expect(fade()).toHaveAttribute("data-visible", "false");

    size(scroller(), { scrollHeight: 600, clientHeight: 300 });
    fireEvent.scroll(scroller());
    expect(fade()).toHaveAttribute("data-visible", "true");
    expect(fade()).toHaveClass("opacity-100");

    size(scroller(), { scrollHeight: 600, clientHeight: 300, scrollTop: 300 });
    fireEvent.scroll(scroller());
    expect(fade()).toHaveAttribute("data-visible", "false");
    expect(fade()).toHaveClass("opacity-0");

    size(scroller(), { scrollHeight: 600, clientHeight: 300, scrollTop: 120 });
    fireEvent.scroll(scroller());
    expect(fade()).toHaveAttribute("data-visible", "true");
  });

  it("re-checks when the content changes (rows added)", async () => {
    const { rerender } = render(
      <ScrollFade testId="list">
        <ul><li>one</li></ul>
      </ScrollFade>,
    );
    expect(fade()).toHaveAttribute("data-visible", "false");

    size(scroller(), { scrollHeight: 900, clientHeight: 300 });
    rerender(
      <ScrollFade testId="list">
        <ul><li>one</li><li>two</li></ul>
      </ScrollFade>,
    );
    await act(() => Promise.resolve()); // MutationObserver callbacks are microtasks

    expect(fade()).toHaveAttribute("data-visible", "true");
  });

  it("is decoration only: hidden from assistive tech and never catches clicks", () => {
    render(<ScrollFade testId="list"><p>rows</p></ScrollFade>);
    expect(fade()).toHaveAttribute("aria-hidden", "true");
    expect(fade()).toHaveClass("pointer-events-none");
  });
});
