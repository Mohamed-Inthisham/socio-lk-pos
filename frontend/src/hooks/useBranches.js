import { useEffect, useState, useCallback } from "react";
import { listBranches } from "../services/branchesService";

/**
 * useBranches Hook
 *
 * Fetches and caches the branch list at module scope so multiple components
 * (nav branch selector, product list filter, product forms) share one fetch.
 *
 * WHY MODULE-LEVEL CACHE (not Redux):
 * - Branches are read-mostly reference data — they change every few months,
 *   not every few seconds. A slice of Redux state for it is overkill.
 * - Multiple components need the same list at the same time. Per-component
 *   fetching would issue N parallel requests on page load.
 *
 * WHEN TO REFRESH:
 * - After admin creates or updates a branch (call the returned `refresh`)
 * - When switching users (module state persists across route changes, but a
 *   full page reload resets it — good enough for R1)
 *
 * @returns {{
 *   branches: Array,     // Cached branch list (empty until first load)
 *   loading: boolean,    // True during initial or forced fetch
 *   error: Error|null,   // Last fetch error, cleared on next successful load
 *   refresh: Function    // Force a refetch and update the cache
 * }}
 */

// Module-level state — shared across every component that calls this hook.
// Not exported; access is only through the hook's return value.
let cachedBranches = null;
let inFlightRequest = null;

// Subscribers get notified when the cache updates so all mounted hooks re-render.
const subscribers = new Set();

const notifySubscribers = () => {
  subscribers.forEach((cb) => cb());
};

const fetchBranchesInternal = async ({ includeInactive = false } = {}) => {
  // Coalesce concurrent callers onto a single in-flight request
  if (inFlightRequest) return inFlightRequest;

  inFlightRequest = listBranches({ includeInactive })
    .then((data) => {
      cachedBranches = data;
      notifySubscribers();
      return data;
    })
    .finally(() => {
      inFlightRequest = null;
    });

  return inFlightRequest;
};

const useBranches = ({ includeInactive = false } = {}) => {
  const [branches, setBranches] = useState(cachedBranches ?? []);
  const [loading, setLoading] = useState(cachedBranches === null);
  const [error, setError] = useState(null);

  // Subscribe to cache updates so this component re-renders when another
  // component triggers a refresh.
  useEffect(() => {
    const onCacheUpdate = () => {
      setBranches(cachedBranches ?? []);
    };
    subscribers.add(onCacheUpdate);
    return () => {
      subscribers.delete(onCacheUpdate);
    };
  }, []);

  // Initial load — only fetches if cache is empty
  useEffect(() => {
    if (cachedBranches !== null) return;

    let cancelled = false;
    fetchBranchesInternal({ includeInactive })
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [includeInactive]);

  const refresh = useCallback(async () => {
    // Force a fresh fetch — clear cache first so concurrent callers wait
    // for the new one instead of getting the stale value.
    cachedBranches = null;
    setLoading(true);
    try {
      await fetchBranchesInternal({ includeInactive });
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  return { branches, loading, error, refresh };
};

export default useBranches;
