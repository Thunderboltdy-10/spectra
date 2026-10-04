import type { SpectraRunTab } from "../data/api";
import type { PrismStatus } from "../life/prism";
import { deriveLiveDockTab, type LiveDockTruthState } from "../runs/live-dock";
import { runTabSource } from "./run-tabs";

/*
 * What the island shows, as plain data (ISLAND.md, "The hover structure"):
 * threads in play sit left of the +, newest nearest it; seen, finished
 * threads sit to its right, newest nearest it. One status says the whole
 * island's state on the prism's dot.
 */

export type IslandSide = "play" | "done";

export type IslandTab = {
  runId: string;
  threadId: string;
  title: string;
  state: LiveDockTruthState;
  /** The live caption: what it is doing now, or what it did. */
  caption: string;
  status: PrismStatus | null;
  side: IslandSide;
  seen: boolean;
  updatedAt: number;
  source: SpectraRunTab;
};

const MOVING: ReadonlySet<LiveDockTruthState> = new Set(["working", "waiting", "completing", "reconnecting"]);
const FINISHED: ReadonlySet<LiveDockTruthState> = new Set(["completed", "completed_limited"]);
const FAILED: ReadonlySet<LiveDockTruthState> = new Set(["paused", "failed_terminal"]);

export const MAX_DONE = 8;
export const MAX_PLAY = 10;

export function tabStatus(state: LiveDockTruthState, seen: boolean): PrismStatus | null {
  if (state === "needs_input") return "needs";
  if (MOVING.has(state)) return "working";
  if (FAILED.has(state)) return seen ? null : "problem";
  if (FINISHED.has(state)) return seen ? null : "done";
  return null;
}

export function sideFor(state: LiveDockTruthState, seen: boolean): IslandSide {
  if (state === "needs_input" || MOVING.has(state)) return "play";
  if (state === "cancelled") return "done";
  return seen ? "done" : "play";
}

/** The island's tabs, in display order on each side (left to right). */
export function arrangeTabs(
  tabs: readonly SpectraRunTab[],
  {
    seen,
    held,
  }: {
    seen: ReadonlySet<string>;
    /** Sides frozen while the user is looking: a tab never moves under the pointer. */
    held?: ReadonlyMap<string, IslandSide>;
  },
) {
  const all: IslandTab[] = [];
  const byThread = new Map<string, SpectraRunTab>();
  // One tab per thread: its latest run.
  for (const tab of tabs) {
    if (tab.hiddenAt) continue;
    const existing = byThread.get(tab.threadId);
    if (!existing || existing.run.updatedAt < tab.run.updatedAt) byThread.set(tab.threadId, tab);
  }
  for (const tab of byThread.values()) {
    const model = deriveLiveDockTab(runTabSource(tab));
    const isSeen = seen.has(tab.runId);
    all.push({
      runId: tab.runId,
      threadId: tab.threadId,
      title: model.title,
      state: model.state,
      caption: model.state === "needs_input" ? model.inputRequest?.kind === "approval" ? "Needs your OK" : "Has a question" : model.semanticStep,
      status: tabStatus(model.state, isSeen),
      side: held?.get(tab.runId) ?? sideFor(model.state, isSeen),
      seen: isSeen,
      updatedAt: tab.run.updatedAt,
      source: tab,
    });
  }
  const newestFirst = (a: IslandTab, b: IslandTab) => b.updatedAt - a.updatedAt;
  // In play reads toward the +: oldest at the far left, newest beside it.
  const play = all.filter((tab) => tab.side === "play").sort(newestFirst).slice(0, MAX_PLAY).reverse();
  // Done reads away from the +: newest beside it.
  const done = all.filter((tab) => tab.side === "done").sort(newestFirst).slice(0, MAX_DONE);
  return { play, done };
}

const STATUS_RANK: Record<PrismStatus, number> = { needs: 6, problem: 5, warning: 4, working: 3, done: 2, info: 1, offline: 0 };

/** The one status the prism's dot shows for all of them. */
export function islandStatus(tabs: readonly IslandTab[], { offline = false }: { offline?: boolean } = {}): PrismStatus | null {
  let best: PrismStatus | null = offline ? "offline" : null;
  for (const tab of tabs) {
    if (tab.status && (!best || STATUS_RANK[tab.status] > STATUS_RANK[best])) best = tab.status;
  }
  return best;
}

/** A title cut at a word boundary, about 26 characters (a tab is at most 180 px). */
export function tabTitle(title: string, limit = 26) {
  const clean = title.trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.55 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}
