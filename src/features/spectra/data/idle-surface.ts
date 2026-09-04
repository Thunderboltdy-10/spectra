/** Shared idle refresh for parked Library subscriptions (ARCHITECTURE-PLATFORM §4). */
export const IDLE_SURFACE_REFRESH_MS = 180_000;

/** Refresh on an idle cadence, focus, and becoming visible — never while hidden. */
export function subscribeIdleSurfaceRefresh(refresh: () => void): () => void {
  const tick = () => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      return;
    }
    refresh();
  };
  const interval = window.setInterval(tick, IDLE_SURFACE_REFRESH_MS);
  window.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", tick);
  return () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", tick);
    document.removeEventListener("visibilitychange", tick);
  };
}
