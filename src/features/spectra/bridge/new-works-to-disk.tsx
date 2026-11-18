"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** A work still being written (by a person or the AI) waits this long after its last change. */
const QUIET_MS = 60_000;

const asked = new Set<string>();

/*
 * With new files syncing both ways, a work made in Spectra inside a synced
 * folder gets its file on this computer too: the browser asks for it once,
 * after the work has been quiet for a minute, and the usual write to the
 * computer follows. Native Spectra documents have no file form, so the
 * server lists only the works that do.
 */
export function NewWorksToDisk({ deviceId }: { deviceId: string }) {
  const waiting = useQuery(api.bridgeSync.waitingForDisk, { deviceId: deviceId as Id<"bridgeDevices"> });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!waiting?.length) return;
    const now = Date.now();
    let soonest = Infinity;
    for (const work of waiting) {
      const key = `${deviceId}:${work.artifactId}`;
      if (asked.has(key)) continue;
      const quietFor = now - work.updatedAt;
      if (quietFor < QUIET_MS) {
        soonest = Math.min(soonest, QUIET_MS - quietFor);
        continue;
      }
      asked.add(key);
      void fetch("/api/spectra/native", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactId: work.artifactId, deviceId, mountId: work.mountId, folderPath: work.folderPath }),
      }).catch(() => undefined);
    }
    if (soonest === Infinity) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), soonest + 1_000);
    return () => window.clearTimeout(timer);
  }, [deviceId, tick, waiting]);
  return null;
}
