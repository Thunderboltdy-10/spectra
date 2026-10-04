"use client";

import { useCallback, useSyncExternalStore } from "react";

/*
 * Which finished runs the user has seen: a seen thread leaves the in-play side
 * of the island and stops marking the prism. Kept per browser; the first
 * visit treats everything already finished as seen, so nothing floods in.
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

export function markRunsSeen(runIds: readonly string[]) {
  const set = load();
  const fresh = runIds.filter((id) => !set.has(id));
  if (!fresh.length) return;
  seen = new Set([...set, ...fresh]);
  save();
  listeners.forEach((listener) => listener());
}

/** On a first visit, everything already finished counts as seen. Returns whether it applied. */
export function settleFirstVisit(finishedRunIds: readonly string[]) {
  load();
  if (!firstVisit) return false;
  firstVisit = false;
  markRunsSeen(finishedRunIds);
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
