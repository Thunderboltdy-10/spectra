"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { useSpectraRun } from "../ai/use-spectra-run";

/*
 * The island is one composer for the whole app, but runs belong to the page
 * that shows them: the chat page streams its own conversation, a workspace
 * its own work. So the page that owns a run engine lends it to the island,
 * and the island host lends a general one as the fallback. The latest page
 * lender wins over the fallback whatever order they mounted in (on a fresh
 * load the host mounts after the page), and the island never needs to know
 * which page it is on.
 */

export type SpectraRunEngine = ReturnType<typeof useSpectraRun>;

export type IslandEngine = {
  engine: SpectraRunEngine;
  /** The thread the page has in focus: the composer replies to it by default. */
  focus?: { threadId: string; title: string } | null;
  /** The page's engine is already bound to the focused thread (the chat page). */
  bindsThread?: boolean;
  /** "New thread": the page lets go of its focused thread. */
  startNewThread?: () => void;
  /** Opens a thread on this page instead of in the Side. */
  openThread?: (runId: string, threadId: string, title: string) => void;
};

type Slot = { id: number; value: IslandEngine; fallback: boolean };

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

const current = () => (slots.findLast((slot) => !slot.fallback) ?? slots.at(-1))?.value ?? null;

/**
 * Lend this page's run engine to the island while the page is mounted.
 * `fallback` marks the island host's general engine, used only when no page lends one.
 */
export function useProvideIslandEngine(value: IslandEngine | null, { fallback = false }: { fallback?: boolean } = {}) {
  const id = useRef(0);
  useEffect(() => {
    if (!value) return;
    if (!id.current) id.current = nextId++;
    const slotId = id.current;
    const slot = { id: slotId, value, fallback };
    const index = slots.findIndex((candidate) => candidate.id === slotId);
    if (index >= 0) slots = slots.map((candidate) => (candidate.id === slotId ? slot : candidate));
    else slots = [...slots, slot];
    notify();
  }, [fallback, value]);
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
