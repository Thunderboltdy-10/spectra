"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { useSpectraRun } from "../ai/use-spectra-run";

/*
 * The island is one composer for the whole app, but runs belong to the page
 * that shows them: the chat page streams its own conversation, a workspace
 * its own work. So the page that owns a run engine lends it to the island,
 * and the island host lends a general one everywhere else. The latest lender
 * wins, and the island never needs to know which page it is on.
 */

export type SpectraRunEngine = ReturnType<typeof useSpectraRun>;

export type IslandEngine = {
  engine: SpectraRunEngine;
  /** The thread the page has in focus: the composer replies to it by default. */
  focus?: { threadId: string; title: string } | null;
  /** The page's engine is already bound to the focused thread (the chat page). */
  bindsThread?: boolean;
  /** Writing is the main action here: the island rests as the reply bar, not the prism. */
  restAsComposer?: boolean;
  /** "New conversation": the page lets go of its focused thread. */
  startNewThread?: () => void;
  /** Opens a thread on this page instead of in the Side. */
  openThread?: (runId: string, threadId: string, title: string) => void;
};

type Slot = { id: number; value: IslandEngine };

let slots: Slot[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const current = () => slots.at(-1)?.value ?? null;

/** Lend this page's run engine to the island while the page is mounted. */
export function useProvideIslandEngine(value: IslandEngine | null) {
  const id = useRef(0);
  useEffect(() => {
    if (!value) return;
    if (!id.current) id.current = nextId++;
    const slotId = id.current;
    const index = slots.findIndex((slot) => slot.id === slotId);
    if (index >= 0) slots = slots.map((slot) => (slot.id === slotId ? { id: slotId, value } : slot));
    else slots = [...slots, { id: slotId, value }];
    notify();
  }, [value]);
  useEffect(
    () => () => {
      const slotId = id.current;
      if (!slotId) return;
      slots = slots.filter((slot) => slot.id !== slotId);
      notify();
    },
    [],
  );
}

/** The run engine the island talks through: the page's, else the host's. */
export function useIslandEngine() {
  return useSyncExternalStore(subscribe, current, () => null);
}
