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
 */

const STORAGE_KEY = "socio-lk-terminal-session";

const useTerminalSessionStore = create(
  persist(
    (set) => ({
      draftSaleId: null,

      setDraftSaleId: (id) => set({ draftSaleId: id ?? null }),

      clear: () => set({ draftSaleId: null }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ draftSaleId: state.draftSaleId }),
    },
  ),
);

export default useTerminalSessionStore;
