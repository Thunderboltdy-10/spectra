"use client";

import { useEffect, useState } from "react";
import { spectraBus } from "../events";
import {
  getSpectraRunTabs,
  invalidateSpectraRunTabsCache,
  type SpectraRunTab,
} from "../data/api";
import type { ResultCardStreamView } from "../ai/stream-events";
import type { LiveDockTabSource } from "../runs/live-dock";
import {
  SYNC_RETRY_POLICY,
  syncRetryDelayMs,
} from "../../../../shared/sync-retry-policy";

/*
 * The user's run tabs, shared by everything that shows them (the island, the
 * landing story's dock). One fetch serves every reader, and while a run is
 * moving the store polls with backoff, only while the page is visible.
 */

const activeStatuses = new Set([
  "queued",
  "running",
  "awaiting_confirmation",
  "awaiting_resolution",
]);

/* A saved run whose file on the computer has not confirmed yet is watched
   briefly, so Bridge read-back shows up without a reload. */
const NATIVE_CONFIRM_WATCH_MS = 10 * 60_000;

let sharedTabs: SpectraRunTab[] = [];
let sharedRefresh: Promise<void> | null = null;
let refreshGeneration = 0;
let appliedRefreshGeneration = 0;
let pollTimer: number | null = null;
let pollConsumers = 0;
let activePollAttempt = 0;
let activePollSignature = "";
const pollDemands = new Map<string, number>();
const listeners = new Set<(tabs: SpectraRunTab[]) => void>();
/*
 * Polling only asks what changed since the last read, so each tick costs the
 * few tabs that moved rather than the whole list. A full read still happens on
 * mount, on a thread change, on return to the page, and now and then, so a tab
 * hidden from another device goes away too.
 */
const FIRST_POLL_DELAY_MS = 3_000;
const POLL_OVERLAP_MS = 10_000;
const POLL_CHANGED_LIMIT = 20;
const FULL_READ_EVERY_POLLS = 12;
let lastFullReadAt = 0;
let pollsSinceFullRead = 0;

export function isActiveRunStatus(status: string) {
  return activeStatuses.has(status);
}

function pollSignature() {
  const now = Date.now();
  const activeRuns = sharedTabs
    .filter(
      (tab) =>
        activeStatuses.has(tab.run.status) ||
        (tab.run.status === "completed" &&
          tab.run.outcome === "native_pending" &&
          now - tab.run.updatedAt < NATIVE_CONFIRM_WATCH_MS),
    )
    .map((tab) => `${tab.runId}:${tab.run.status}:${tab.run.outcome ?? ""}`);
  return [...activeRuns, ...pollDemands.keys()].sort().join("|");
}

function clearPoll() {
  if (pollTimer !== null) window.clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll() {
  const shouldPoll = pollConsumers > 0 && document.visibilityState === "visible";
  const signature = pollSignature();
  if (!shouldPoll || !signature) {
    clearPoll();
    activePollAttempt = 0;
    activePollSignature = signature;
    return;
  }
  if (signature !== activePollSignature) {
    clearPoll();
    activePollAttempt = 0;
    activePollSignature = signature;
  }
  if (pollTimer !== null) return;
  activePollAttempt += 1;
  const delay = syncRetryDelayMs(
    activePollAttempt,
    `run-tabs:${signature}`,
    SYNC_RETRY_POLICY.activeRunPollMaxDelayMs,
    FIRST_POLL_DELAY_MS,
  );
  pollTimer = window.setTimeout(() => {
    pollTimer = null;
    void refreshRunTabs(false, true);
  }, delay);
}

function syncVisibility() {
  if (pollConsumers > 0 && document.visibilityState === "visible") void refreshRunTabs();
  else clearPoll();
}

export function getRunTabs() {
  return sharedTabs;
}

/** The run that belongs to an open thread, so Follow AI locks the right actor. */
export function runIdForLiveThread(threadId: string): string | null {
  const id = threadId.trim();
  if (!id) return null;
  return sharedTabs.find((tab) => tab.threadId === id)?.runId ?? null;
}

/** The most tabs the island reads, and how long a thread no one touches stays on it. */
const ISLAND_TABS = 60;
const ISLAND_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** A week ago, to the hour, so repeated reads within the hour ask the same question. */
function islandWindowStart() {
  return Math.floor((Date.now() - ISLAND_IDLE_MS) / HOUR_MS) * HOUR_MS;
}

/** Changed tabs over the list: each thread has one tab, newest first. */
function mergeTabs(current: SpectraRunTab[], changed: SpectraRunTab[]) {
  const byThread = new Map(current.map((tab) => [tab.threadId, tab]));
  for (const tab of changed) byThread.set(tab.threadId, tab);
  return [...byThread.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function refreshRunTabs(force = false, changedOnly = false) {
  if (sharedRefresh && !force) return sharedRefresh;
  if (force) {
    invalidateSpectraRunTabsCache();
    sharedRefresh = null;
  }
  const generation = ++refreshGeneration;
  const delta = changedOnly && !force && lastFullReadAt > 0 && pollsSinceFullRead < FULL_READ_EVERY_POLLS;
  const startedAt = Date.now();
  const pending = (delta
    ? getSpectraRunTabs({ limit: POLL_CHANGED_LIMIT, since: lastFullReadAt - POLL_OVERLAP_MS })
    : getSpectraRunTabs({ limit: ISLAND_TABS, since: islandWindowStart(), force })
  )
    .then((result) => {
      if (generation < appliedRefreshGeneration) return;
      appliedRefreshGeneration = generation;
      sharedTabs = delta ? mergeTabs(sharedTabs, result.runTabs) : result.runTabs;
      pollsSinceFullRead = delta ? pollsSinceFullRead + 1 : 0;
      lastFullReadAt = startedAt;
      listeners.forEach((listener) => listener(sharedTabs));
    })
    .catch(() => undefined)
    .finally(() => {
      if (sharedRefresh === pending) sharedRefresh = null;
      schedulePoll();
    });
  sharedRefresh = pending;
  return pending;
}

/** Forget the tabs without reading again; whoever mounts next reads its own. */
export function clearRunTabs() {
  refreshGeneration += 1;
  appliedRefreshGeneration = refreshGeneration;
  sharedRefresh = null;
  clearPoll();
  sharedTabs = [];
  lastFullReadAt = 0;
  listeners.forEach((listener) => listener(sharedTabs));
}

export function subscribeRunTabs(listener: (tabs: SpectraRunTab[]) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Keep the store polling while something is moving. `demand` names an
 * optimistic run the server may not list yet. */
export function beginRunTabsPolling(demand?: string) {
  pollConsumers += 1;
  if (demand) pollDemands.set(demand, (pollDemands.get(demand) ?? 0) + 1);
  if (pollConsumers === 1) document.addEventListener("visibilitychange", syncVisibility);
  syncVisibility();
  return () => {
    pollConsumers = Math.max(0, pollConsumers - 1);
    if (demand) {
      const remaining = (pollDemands.get(demand) ?? 1) - 1;
      if (remaining > 0) pollDemands.set(demand, remaining);
      else pollDemands.delete(demand);
    }
    if (pollConsumers === 0) {
      document.removeEventListener("visibilitychange", syncVisibility);
      syncVisibility();
    }
  };
}

export function runTabSource(tab: SpectraRunTab): LiveDockTabSource {
  return {
    runId: tab.runId,
    threadId: tab.threadId,
    threadTitle: tab.thread.title,
    run: tab.run,
    card: tab.card,
    checkpointSummary: tab.checkpointSummary,
    recentSteps: tab.recentSteps,
    inputRequest: tab.inputRequest,
  };
}

/** The live run tabs: fetched once, refreshed when threads or runs change,
 * polled while any of them is moving (or `demand` names one about to). */
let busReaders = 0;
let leaveBus: (() => void) | null = null;

/*
 * A burst of changes (a run writing its reply, several tabs moving) is one
 * read: at most one a second, after the first change, so the read sees them
 * all (LAUNCH-REVIEW E3).
 */
const BUS_READ_EVERY_MS = 1_000;
let busTimer: ReturnType<typeof setTimeout> | null = null;

function readAfterBurst() {
  if (busTimer) return;
  busTimer = setTimeout(() => {
    busTimer = null;
    void refreshRunTabs(false, true);
  }, BUS_READ_EVERY_MS);
}

/** The first reader joins the bus and the last leaves it. */
function joinRunTabsBus() {
  busReaders += 1;
  if (!leaveBus) {
    const removeThreads = spectraBus.on("threads.changed", readAfterBurst);
    const removeRun = spectraBus.on("run.changed", readAfterBurst);
    leaveBus = () => {
      removeThreads();
      removeRun();
      if (busTimer) clearTimeout(busTimer);
      busTimer = null;
    };
  }
  return () => {
    busReaders -= 1;
    if (busReaders === 0) {
      leaveBus?.();
      leaveBus = null;
    }
  };
}

export function useRunTabs({ enabled = true, demand }: { enabled?: boolean; demand?: string | null } = {}) {
  const [tabs, setTabs] = useState(sharedTabs);
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribeRunTabs(setTabs);
    void refreshRunTabs();
    const leave = joinRunTabsBus();
    return () => {
      unsubscribe();
      leave();
    };
  }, [enabled]);
  const moving = enabled && tabs.some((tab) => activeStatuses.has(tab.run.status));
  useEffect(() => (moving ? beginRunTabsPolling() : undefined), [moving]);
  useEffect(() => (enabled && demand ? beginRunTabsPolling(demand) : undefined), [enabled, demand]);
  return tabs;
}

/** The run's result card, in the shape the run engine acts on (confirm, revert). */
export function runTabCard(tab: SpectraRunTab): ResultCardStreamView | null {
  if (!tab.card) return null;
  return {
    id: tab.card._id,
    runId: tab.card.runId,
    status: tab.card.status,
    title: tab.card.title,
    summary: tab.card.summary,
    variant: tab.card.variant,
    actions: tab.card.actions,
    provenance: tab.card.provenance,
    updatedAt: tab.card.updatedAt,
  };
}
