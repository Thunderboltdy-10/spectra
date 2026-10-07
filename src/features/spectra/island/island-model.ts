import type { SpectraRunTab } from "../data/api";
import type { PrismStatus } from "../life/prism";
import { deriveLiveDockTab, type LiveDockTruthState } from "../runs/live-dock";
import type { Arrangement } from "./arrange";
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
  /** Where the island would put it on its own; the user may have moved it. */
  automaticSide: IslandSide;
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

/** The side the user chose for a thread, while it still applies. */
function chosenSide(arrangement: Arrangement | undefined, tab: SpectraRunTab, state: LiveDockTruthState): IslandSide | null {
  const choice = arrangement?.sides[tab.threadId];
  // A choice belongs to the run it was made on.
  if (!choice || choice.runId !== tab.runId) return null;
  // Put away or not, a question for the user always comes forward.
  if (choice.side === "done" && state === "needs_input") return null;
  return choice.side;
}

/** Nearest the + first: threads the user never placed, newest first, then the user's order. */
function orderSide(tabs: IslandTab[], saved: readonly string[] | undefined) {
  const newestFirst = (a: IslandTab, b: IslandTab) => b.updatedAt - a.updatedAt;
  const rank = new Map((saved ?? []).map((threadId, index) => [threadId, index]));
  const placed = tabs.filter((tab) => rank.has(tab.threadId)).sort((a, b) => rank.get(a.threadId)! - rank.get(b.threadId)!);
  const unplaced = tabs.filter((tab) => !rank.has(tab.threadId)).sort(newestFirst);
  return [...unplaced, ...placed];
}

/** The island's tabs, in display order on each side (left to right). */
export function arrangeTabs(
  tabs: readonly SpectraRunTab[],
  {
    seen,
    held,
    arrangement,
  }: {
    seen: ReadonlySet<string>;
    /** Sides frozen while the user is looking: a tab never moves under the pointer. */
    held?: ReadonlyMap<string, IslandSide>;
    /** How the user arranged the tabs. */
    arrangement?: Arrangement;
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
    const automaticSide = sideFor(model.state, isSeen);
    all.push({
      runId: tab.runId,
      threadId: tab.threadId,
      title: model.title,
      state: model.state,
      caption: model.state === "needs_input" ? model.inputRequest?.kind === "approval" ? "Needs your OK" : "Has a question" : model.semanticStep,
      status: tabStatus(model.state, isSeen),
      side: held?.get(tab.runId) ?? chosenSide(arrangement, tab, model.state) ?? automaticSide,
      automaticSide,
      seen: isSeen,
      updatedAt: tab.run.updatedAt,
      source: tab,
    });
  }
  // In play reads toward the +, so its nearest tab is the rightmost.
  const play = orderSide(all.filter((tab) => tab.side === "play"), arrangement?.order.play).slice(0, MAX_PLAY).reverse();
  // Done reads away from the +.
  const done = orderSide(all.filter((tab) => tab.side === "done"), arrangement?.order.done).slice(0, MAX_DONE);
  return { play, done };
}

/** The two sides with one tab moved: to `side`, at `index` in display order (left to right). */
export function previewTabs(play: readonly IslandTab[], done: readonly IslandTab[], runId: string, side: IslandSide, index: number) {
  const moving = play.find((tab) => tab.runId === runId) ?? done.find((tab) => tab.runId === runId);
  if (!moving) return { play: [...play], done: [...done] };
  const next = { play: play.filter((tab) => tab.runId !== runId), done: done.filter((tab) => tab.runId !== runId) };
  const row = next[side];
  row.splice(Math.max(0, Math.min(row.length, index)), 0, { ...moving, side });
  return next;
}

/** Where a dropped tab lands: its side, and that side's threads nearest the + first, as the store keeps them. */
export function dropTab(play: readonly IslandTab[], done: readonly IslandTab[], runId: string, side: IslandSide, index: number) {
  const next = previewTabs(play, done, runId, side, index);
  const nearestFirst = side === "play" ? [...next.play].reverse() : next.done;
  return { side, order: nearestFirst.map((tab) => tab.threadId) };
}

/**
 * One keyboard step (Alt + arrow): the tab swaps with its neighbour, and the
 * last step before the + carries it across. Null when it is already at an end.
 */
export function stepTab(play: readonly IslandTab[], done: readonly IslandTab[], runId: string, delta: -1 | 1): { side: IslandSide; index: number } | null {
  const playIndex = play.findIndex((tab) => tab.runId === runId);
  if (playIndex >= 0) {
    if (delta === 1 && playIndex === play.length - 1) return { side: "done", index: 0 };
    const index = playIndex + delta;
    return index < 0 ? null : { side: "play", index };
  }
  const doneIndex = done.findIndex((tab) => tab.runId === runId);
  if (doneIndex < 0) return null;
  // Across the +, it becomes the nearest tab in play: the rightmost.
  if (delta === -1 && doneIndex === 0) return { side: "play", index: play.length };
  const index = doneIndex + delta;
  return index >= done.length ? null : { side: "done", index };
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

/** A message sent from here starts work with its own light (it travels into the prism); later starts are someone else's. */
export const SENT_START_MS = 3000;

/**
 * The light the prism lets out when its status changes, if any: a question
 * for you (warm), or work that starts without a message from here, such as an
 * agent or a schedule (spectrum). Endings answer per run, with the notice.
 * `before` is undefined on the first status, which is simply how things are.
 */
export function statusLight(before: PrismStatus | null | undefined, status: PrismStatus | null, sinceSend: number): "needs" | "spectrum" | null {
  if (before === undefined || before === status) return null;
  if (status === "needs") return "needs";
  if (status === "working" && !before && sinceSend > SENT_START_MS) return "spectrum";
  return null;
}

/** A title cut at a word boundary, about 26 characters (a tab is at most 180 px). */
export function tabTitle(title: string, limit = 26) {
  const clean = title.trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.55 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}
