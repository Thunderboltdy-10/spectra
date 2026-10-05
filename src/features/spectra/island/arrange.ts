"use client";

import { useSyncExternalStore } from "react";
import type { IslandSide } from "./island-model";

/*
 * How the user arranged the island's tabs (ISLAND.md, "Arranging tabs"),
 * kept per browser. Threads, not runs, are what the user moves:
 *
 * - `sides`: a thread dragged across the +. A done thread pulled left stays
 *   in play, pinned; a thread in play pushed right is put away. The choice
 *   belongs to the run it was made on: the thread's next run starts fresh.
 * - `order`: each side's threads, nearest the + first, as the user last left
 *   them. Threads the user never placed go nearest the +.
 */

export type SideChoice = { side: IslandSide; runId: string };

export type Arrangement = {
  sides: Readonly<Record<string, SideChoice>>;
  order: Readonly<Record<IslandSide, readonly string[]>>;
};

const KEY = "spectra.island.arrange.v1";
const LIMIT = 60;

export const EMPTY_ARRANGEMENT: Arrangement = { sides: {}, order: { play: [], done: [] } };

let current: Arrangement | null = null;
const listeners = new Set<() => void>();

function load(): Arrangement {
  if (current) return current;
  current = EMPTY_ARRANGEMENT;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Arrangement>;
      current = {
        sides: parsed.sides && typeof parsed.sides === "object" ? parsed.sides : {},
        order: {
          play: Array.isArray(parsed.order?.play) ? parsed.order.play.slice(0, LIMIT) : [],
          done: Array.isArray(parsed.order?.done) ? parsed.order.done.slice(0, LIMIT) : [],
        },
      };
    }
  } catch {
    // Storage can be off; the island arranges itself for this visit.
  }
  return current;
}

function commit(next: Arrangement) {
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not kept; fine.
  }
  listeners.forEach((listener) => listener());
}

/**
 * The user placed a thread: on `side`, at `order` (that side's threads,
 * nearest the + first, already including it).
 */
export function placeThread(threadId: string, runId: string, side: IslandSide, order: readonly string[], automaticSide: IslandSide) {
  const before = load();
  const sides = { ...before.sides };
  if (side === automaticSide) delete sides[threadId];
  else sides[threadId] = { side, runId };
  const kept = order.slice(0, LIMIT);
  const without = (side === "play" ? before.order.done : before.order.play).filter((id) => id !== threadId);
  commit({
    sides: trimSides(sides),
    order: side === "play" ? { play: kept, done: without } : { play: without, done: kept },
  });
}

/** A dismissed thread forgets where it was. */
export function forgetThread(threadId: string) {
  const before = load();
  if (!before.sides[threadId] && !before.order.play.includes(threadId) && !before.order.done.includes(threadId)) return;
  const sides = { ...before.sides };
  delete sides[threadId];
  commit({
    sides,
    order: { play: before.order.play.filter((id) => id !== threadId), done: before.order.done.filter((id) => id !== threadId) },
  });
}

function trimSides(sides: Record<string, SideChoice>) {
  const keys = Object.keys(sides);
  if (keys.length <= LIMIT) return sides;
  return Object.fromEntries(keys.slice(-LIMIT).map((key) => [key, sides[key]]));
}

export function useArrangement(): Arrangement {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    () => EMPTY_ARRANGEMENT,
  );
}

/** For tests. */
export function resetArrangement() {
  current = null;
}
