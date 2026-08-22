import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Theme Store (Zustand)
 *
 * Owns light/dark mode. Persists explicit user choice to localStorage under
 * 'socio-lk-theme'. Follows OS preference when the user hasn't chosen.
 *
 * WHY ZUSTAND (not Redux):
 * Theme is pure UI ephemera — one boolean, one mutator, no side effects worth
 * tracing in DevTools, no audit value. Redux is reserved for domain state
 * (auth, branches, cart, sales). See ADR in commit history.
 *
 * FIRST PAINT:
 * The store initializes from localStorage synchronously (via zustand's persist
 * middleware), and applyTheme() runs eagerly on module import so <html> gets
 * the correct class before React mounts. This eliminates the light->dark flash.
 */

const STORAGE_KEY = "socio-lk-theme";

// Apply the resolved theme to <html> so Tailwind's dark: variants activate.
const applyTheme = (theme) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
};

// Resolve OS preference synchronously.
const systemPrefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

const useThemeStore = create(
  persist(
    (set, get) => ({
      // Explicit user choice: 'light' | 'dark' | null (null = follow system)
      preference: null,

      // Resolved theme actually in use: 'light' | 'dark'
      resolvedTheme: systemPrefersDark() ? "dark" : "light",

      // Set an explicit theme choice.
      setTheme: (next) => {
        if (next !== "light" && next !== "dark") return;
        set({ preference: next, resolvedTheme: next });
        applyTheme(next);
      },

      // Flip between light and dark. Sets an explicit choice — no longer follows system.
      toggle: () => {
        const next = get().resolvedTheme === "dark" ? "light" : "dark";
        set({ preference: next, resolvedTheme: next });
        applyTheme(next);
      },

      // Return to following OS preference.
      useSystem: () => {
        const next = systemPrefersDark() ? "dark" : "light";
        set({ preference: null, resolvedTheme: next });
        applyTheme(next);
      },

      // Called on rehydration from localStorage — recompute resolvedTheme
      // based on persisted preference (or system if none).
      _hydrate: () => {
        const { preference } = get();
        const next =
          preference === "light" || preference === "dark"
            ? preference
            : systemPrefersDark()
              ? "dark"
              : "light";
        set({ resolvedTheme: next });
        applyTheme(next);
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist the user's explicit choice, not the derived resolvedTheme.
      partialize: (state) => ({ preference: state.preference }),
      onRehydrateStorage: () => (state) => {
        // Called after localStorage read completes.
        state?._hydrate();
      },
    },
  ),
);

// Apply the initial theme immediately on module import so first paint is correct.
// This runs before React mounts, avoiding the flash of wrong theme.
if (typeof window !== "undefined") {
  applyTheme(useThemeStore.getState().resolvedTheme);

  // Subscribe to OS preference changes — only apply if user is following system.
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", (e) => {
    if (useThemeStore.getState().preference === null) {
      const next = e.matches ? "dark" : "light";
      useThemeStore.setState({ resolvedTheme: next });
      applyTheme(next);
    }
  });
}

export default useThemeStore;
