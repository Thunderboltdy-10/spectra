"use client";

import { useCallback, useSyncExternalStore } from "react";
import { sendSeenRuns } from "./seen-sync";

/*
 * Which finished runs the user has seen: a seen thread leaves the in-play side
 * of the island and stops marking the prism. Kept per browser and on the
 * server (a run seen on another device arrives as `seenRunId` on its tab);
 * the first visit treats everything already finished as seen.
 */

const KEY = "spectra.island.seen.v1";
const LIMIT = 400;

let seen: Set<string> | null = null;
let firstVisit = false;
const listeners = new Set<() => void>();

function load() {
  if (seen) return seen;
  seen = new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) firstVisit = true;
    else for (const id of JSON.parse(raw) as string[]) seen.add(id);
  } catch {
    // Storage can be off; the island still works for this visit.
  }
  return seen;
}

function save() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...load()].slice(-LIMIT)));
  } catch {
    // Not kept; fine.
  }
}

/** Marks runs seen here; unless the marks came from the server, it is told too, for the user's other devices. */
export function markRunsSeen(runIds: readonly string[], options: { fromServer?: boolean } = {}) {
  const set = load();
  const fresh = runIds.filter((id) => !set.has(id));
  if (!fresh.length) return;
  seen = new Set([...set, ...fresh]);
  save();
  if (!options.fromServer) sendSeenRuns(fresh);
  listeners.forEach((listener) => listener());
}

/** On a first visit, everything already finished counts as seen. Returns whether it applied. */
export function settleFirstVisit(finishedRunIds: readonly string[]) {
  load();
  if (!firstVisit) return false;
  firstVisit = false;
  // Settling a first visit is this browser catching up, not the user reading.
  markRunsSeen(finishedRunIds, { fromServer: true });
  if (!finishedRunIds.length) save();
  return true;
}

const EMPTY = new Set<string>();

export function useSeenRuns() {
  const set = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => load(),
    () => EMPTY,
  );
  const mark = useCallback((runId: string) => markRunsSeen([runId]), []);
  return [set as ReadonlySet<string>, mark] as const;
}
