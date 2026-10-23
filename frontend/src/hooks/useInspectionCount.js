import { useEffect, useState } from "react";
import { listInspection } from "../services/saleReturnsService";

/**
 * How many returned phones are waiting to be checked at a branch (planning
 * doc P7-7): the count on the terminal header's Phones to check link.
 *
 * No polling (the API's per-IP limit is shared by the shop's tills). It is
 * read from GET /sale-returns/inspection:
 * - when the terminal mounts (and when the branch changes);
 * - when the tab becomes visible again;
 * - on a `pos:inspection-changed` window event (announceInspectionChange):
 *   with a count, that count is used as is (the Phones to check screen
 *   sends its own list's length, so the badge and the list agree); without
 *   one, the count is read again (a return that sent a phone to
 *   inspection).
 *
 * A failed read gives null: no badge, no error (the link still works).
 *
 * @param {string|undefined} branchId - the terminal branch
 * @param {boolean} enabled - admins and managers only (PASS_INSPECTION)
 * @returns {number|null}
 */

export const INSPECTION_CHANGED = "pos:inspection-changed";

/** Tell the header the phones waiting changed; pass the new count when known. */
export const announceInspectionChange = (count) =>
  window.dispatchEvent(new CustomEvent(INSPECTION_CHANGED, { detail: { count } }));

const useInspectionCount = (branchId, enabled) => {
  const [count, setCount] = useState(null);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (!enabled || !branchId) return undefined;
    let live = true;
    listInspection(branchId)
      .then((rows) => {
        if (live) setCount(rows.length);
      })
      .catch(() => {
        if (live) setCount(null);
      });
    return () => {
      live = false;
    };
  }, [branchId, enabled, reads]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onChange = (e) => {
      if (typeof e.detail?.count === "number") setCount(e.detail.count);
      else setReads((n) => n + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") setReads((n) => n + 1);
    };
    window.addEventListener(INSPECTION_CHANGED, onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(INSPECTION_CHANGED, onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  return enabled ? count : null;
};

export default useInspectionCount;
