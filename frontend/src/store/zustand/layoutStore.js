import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Layout Store (Zustand)
 *
 * Owns UI-layout state that persists across page navigation:
 * - sidebarCollapsed: desktop only — whether the sidebar shows icons+labels
 *   (false, default) or icon-only (true). Persisted so admin's preference
 *   survives page reload.
 * - mobileDrawerOpen: mobile only — whether the sidebar drawer is currently
 *   open. NOT persisted (always starts closed on page load).
 *
 * WHY ZUSTAND (not Redux):
 * Layout state is pure UI ephemera — no domain meaning, no side effects
 * worth tracing in DevTools. Same category as theme. Redux stays for
 * domain state (auth, branches, brands, categories).
 */

const STORAGE_KEY = "socio-lk-layout";

const useLayoutStore = create(
  persist(
    (set) => ({
      // DESKTOP
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: Boolean(v) }),

      // MOBILE
      mobileDrawerOpen: false,
      openMobileDrawer: () => set({ mobileDrawerOpen: true }),
      closeMobileDrawer: () => set({ mobileDrawerOpen: false }),
      toggleMobileDrawer: () =>
        set((s) => ({ mobileDrawerOpen: !s.mobileDrawerOpen })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist the desktop preference. Mobile drawer state should
      // always reset on reload — persisting it would confuse users who
      // reload the page expecting a clean state.
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);

export default useLayoutStore;
