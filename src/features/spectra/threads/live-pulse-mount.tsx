"use client";

import { useEffect, useRef } from "react";
import { useConvexAuth } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../convex/_generated/api";
import { spectraBus } from "../events";
import { setRunLive } from "../data/use-calm-query";

/** Several changes in a burst (a run writing its reply) refresh once. */
const SETTLE_MS = 800;
/** While a run is live its own stream shows its progress, so the lists can wait. */
const SETTLE_DURING_RUN_MS = 20_000;

type Pulse = { threadsAt: number; live: string[] };

/*
 * Keeps every open page in step with the account's threads and runs, across
 * tabs and devices: a thread started on the phone, a run finishing in another
 * tab or a title arriving shows on this page too. It subscribes to one small
 * pulse (spectraThreads.pulse) instead of polling the lists, and turns its
 * changes into the events the rail and the island already refresh on.
 */
export function LivePulseMount() {
  const { isAuthenticated } = useConvexAuth();
  const pulse = useQuery(api.spectraThreads.pulse, isAuthenticated ? {} : "skip") as Pulse | null | undefined;
  const seen = useRef<Pulse | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!pulse) return;
    setRunLive(pulse.live.length > 0);
    const before = seen.current;
    seen.current = pulse;
    if (!before) return;
    const moved = new Set([...pulse.live, ...before.live].filter((entry) => !pulse.live.includes(entry) || !before.live.includes(entry)));
    for (const runId of new Set([...moved].map((entry) => entry.split(":")[0]!))) spectraBus.emit("run.changed", { runId });
    if (pulse.threadsAt === before.threadsAt && !moved.size) return;
    // A run's writes only move the timestamp: keep the pending refresh rather than restart it.
    const quiet = !moved.size && pulse.live.length > 0;
    if (quiet && timer.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      spectraBus.emit("threads.changed", {});
    }, quiet ? SETTLE_DURING_RUN_MS : SETTLE_MS);
  }, [pulse]);

  return null;
}
