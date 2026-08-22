import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Active Branch Store (Zustand)
 *
 * Owns which branch the user is currently "acting on" from the header
 * branch selector. Purely a UI preference — the backend doesn't know or
 * care what this value is (yet). Persisted to localStorage under
 * 'socio-lk-active-branch' so it survives refreshes.
 *
 * WHY ZUSTAND (not Redux):
 * The active branch is UI ephemera — a viewing preference — not domain
 * state. It doesn't need action logs, replay, or middleware. Same category
 * as themeStore. See the state-management ADR: Redux for domain state
 * (auth, branches, brands, categories), Zustand for UI preferences
 * (theme, layout, active-branch).
 *
 * WHY IT'S A UI STORE EVEN THOUGH IT REFERENCES DOMAIN DATA:
 * The store holds only an ID string. The list of branches themselves
 * lives in Redux (`branchesSlice`). Selector components read both:
 * this store for "which one is picked", branchesSlice for "what are
 * the options and their names". Keeps concerns cleanly split.
 *
 * NON-GOALS (deferred to R2 / R9):
 * - Wiring active branch into ProductsList's filter — Path B ships the
 *   selector as scaffold-only. When a second branch launches, the filter
 *   subscribes to `activeBranchId` and adds it to list-query params.
 * - Backend-side per-branch scoping. R1 is single-branch; the selector
 *   exists so R2's mental model is already in place.
 */

const STORAGE_KEY = "socio-lk-active-branch";

const useActiveBranchStore = create(
  persist(
    (set) => ({
      // The currently selected branch ID, or null if not yet chosen.
      // Null is a valid transitional state — before branches load, before
      // the user (or defaulting logic) has picked one.
      activeBranchId: null,

      /**
       * Set the active branch by ID. Accepts null to explicitly clear.
       * Called by BranchSelector when the admin picks from the dropdown,
       * and by the defaulting effect on first branches-load.
       */
      setActiveBranch: (id) => {
        // Basic validation: string UUID or null. Silently ignore anything
        // else — better than crashing on a bad caller.
        if (id === null || typeof id === "string") {
          set({ activeBranchId: id });
        }
      },

      /**
       * Reset the store. Called on logout so one user's picked branch
       * doesn't leak into the next login session on the same device.
       */
      clear: () => set({ activeBranchId: null }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Persist only the ID. No derived state to strip.
      partialize: (state) => ({ activeBranchId: state.activeBranchId }),
    },
  ),
);

export default useActiveBranchStore;
