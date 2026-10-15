/**
 * Touch-only device: the primary pointer is coarse (finger). Programmatic
 * focus on these pops the on-screen keyboard, so the terminal skips its
 * automatic focus hand-offs there (planning doc §6, "Touch").
 */
export const isTouchOnly = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(pointer: coarse)").matches;
