"use client";

import { useEffect, useRef } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { spectraBus } from "../events";

/** Several changes in a burst (a run writing its reply) refresh once. */
const SETTLE_MS = 800;

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
    const before = seen.current;
    seen.current = pulse;
    if (!before) return;
    const moved = new Set([...pulse.live, ...before.live].filter((entry) => !pulse.live.includes(entry) || !before.live.includes(entry)));
    for (const runId of new Set([...moved].map((entry) => entry.split(":")[0]!))) spectraBus.emit("run.changed", { runId });
    if (pulse.threadsAt === before.threadsAt && !moved.size) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      spectraBus.emit("threads.changed", {});
    }, SETTLE_MS);
  }, [pulse]);

  return null;
}
