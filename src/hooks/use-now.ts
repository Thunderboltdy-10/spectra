"use client";

import { useEffect, useState } from "react";

/**
 * Current time for render-time comparisons.
 * Starts at 0 on server + first client paint so SSR HTML matches hydration,
 * then advances after mount.
 */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
