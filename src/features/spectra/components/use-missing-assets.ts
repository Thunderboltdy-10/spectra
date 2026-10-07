"use client";

import { useEffect, useRef, useState } from "react";

/** When to look again for an asset the content names but the list lacks: a peer's upload can land just after. */
export const MISSING_ASSET_RETRIES_MS = [300, 1500, 5000];

/**
 * A work's asset list loads once; a collaborator's new image arrives in the
 * content first. When the content names an asset the list does not have,
 * this reloads the list a few times, then gives up on that asset.
 */
export function useMissingAssets(
  referenced: readonly string[],
  known: { has(assetId: string): boolean },
  reload: () => Promise<unknown>,
) {
  const [tries, setTries] = useState<Record<string, number>>({});
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });
  // Each missing asset with its tries so far: the key changes after every look, so the next one is scheduled.
  const missing = [...new Set(referenced)]
    .filter((assetId) => assetId && !known.has(assetId) && (tries[assetId] ?? 0) < MISSING_ASSET_RETRIES_MS.length)
    .sort()
    .map((assetId) => `${assetId}:${tries[assetId] ?? 0}`)
    .join(" ");
  useEffect(() => {
    if (!missing) return;
    const entries = missing.split(" ").map((entry) => entry.split(":") as [string, string]);
    const attempt = Math.min(...entries.map(([, count]) => Number(count)));
    const timer = window.setTimeout(() => {
      setTries((current) => {
        const next = { ...current };
        for (const [assetId] of entries) next[assetId] = (next[assetId] ?? 0) + 1;
        return next;
      });
      void reloadRef.current().catch(() => undefined);
    }, MISSING_ASSET_RETRIES_MS[attempt]);
    return () => window.clearTimeout(timer);
  }, [missing]);
}
