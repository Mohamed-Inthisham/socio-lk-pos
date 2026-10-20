import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Terminal Session Store (Zustand)
 *
 * Persists a pointer to the terminal's current DRAFT sale so a page reload
 * resumes the same cart (planning doc Q8, option a). The sale itself lives
 * in Redux (`posTerminalSlice`) and on the server — this store only holds
 * the id, same category as activeBranchStore.
 *
 * Written by the posTerminal thunks (create / resume / discard), cleared
 * on logout so the next user on a shared till doesn't resume someone
 * else's draft.
 *
 * lastCompletedSaleId (P5-12): the sale the terminal last completed, for
 * "Reprint last receipt" — it survives a reload and a discarded next
 * draft, and is replaced when the next sale completes. `clear()` (logout)
 * drops it with the draft pointer; `clearDraftSaleId()` drops only the
 * pointer.
 */

const STORAGE_KEY = "socio-lk-terminal-session";

const useTerminalSessionStore = create(
  persist(
    (set) => ({
      draftSaleId: null,
      lastCompletedSaleId: null,

      setDraftSaleId: (id) => set({ draftSaleId: id ?? null }),

      clearDraftSaleId: () => set({ draftSaleId: null }),

      setLastCompletedSaleId: (id) => set({ lastCompletedSaleId: id ?? null }),

      clear: () => set({ draftSaleId: null, lastCompletedSaleId: null }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        draftSaleId: state.draftSaleId,
        lastCompletedSaleId: state.lastCompletedSaleId,
      }),
    },
  ),
);

export default useTerminalSessionStore;
