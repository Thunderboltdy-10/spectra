/**
 * position-persistence.ts
 *
 * Two-layer position persistence for workspace layout:
 * 1. Canonical layout (computed, never stored)
 * 2. User overrides (localStorage + batched Convex sync)
 *
 * localStorage is immediate. Convex sync is debounced (minimum 45s).
 * beforeunload triggers final sync.
 */

const STORAGE_KEY = "workspace:position-overrides";
const SYNC_DEBOUNCE_MS = 45_000; // 45 seconds

type PositionMap = Record<string, { x: number; y: number; ts: number }>;

let pendingSync = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncCallback: ((overrides: PositionMap) => Promise<void>) | null = null;

/**
 * Load local position overrides from localStorage.
 */
export function loadLocalOverrides(): Map<string, { x: number; y: number }> {
  if (typeof window === "undefined") return new Map();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as PositionMap;
    const result = new Map<string, { x: number; y: number }>();
    for (const [id, { x, y }] of Object.entries(parsed)) {
      result.set(id, { x, y });
    }
    return result;
  } catch {
    return new Map();
  }
}

/**
 * Save a position override to localStorage immediately.
 * Schedules a debounced Convex sync.
 */
export function saveLocalOverride(
  workstreamId: string,
  x: number,
  y: number,
): void {
  if (typeof window === "undefined") return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const current: PositionMap = raw ? JSON.parse(raw) : {};
    current[workstreamId] = { x: Math.round(x), y: Math.round(y), ts: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    pendingSync = true;
    scheduleSyncToConvex();
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * Register a callback for syncing overrides to Convex.
 */
export function registerSyncCallback(
  cb: (overrides: PositionMap) => Promise<void>,
): void {
  syncCallback = cb;
}

/**
 * Schedule a debounced sync to Convex.
 */
function scheduleSyncToConvex(): void {
  if (syncTimer) return; // already scheduled
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void flushToConvex();
  }, SYNC_DEBOUNCE_MS);
}

/**
 * Flush pending overrides to Convex immediately.
 * Called on beforeunload and visibilitychange.
 */
export async function flushToConvex(): Promise<void> {
  if (!pendingSync || !syncCallback) return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const overrides: PositionMap = JSON.parse(raw);
    await syncCallback(overrides);
    pendingSync = false;
  } catch {
    // Will retry on next schedule
  }
}

/**
 * Initialize beforeunload and visibilitychange listeners.
 */
export function initPersistenceListeners(): () => void {
  const handleBeforeUnload = () => {
    void flushToConvex();
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      void flushToConvex();
    }
  };

  window.addEventListener("beforeunload", handleBeforeUnload);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    window.removeEventListener("beforeunload", handleBeforeUnload);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
  };
}

/**
 * Clear all local overrides. Returns to canonical layout.
 */
export function clearLocalOverrides(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
