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
  );
  pollTimer = window.setTimeout(() => {
    pollTimer = null;
    void refreshRunTabs();
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

export function refreshRunTabs(force = false) {
  if (sharedRefresh && !force) return sharedRefresh;
  if (force) {
    invalidateSpectraRunTabsCache();
    sharedRefresh = null;
  }
  const generation = ++refreshGeneration;
  const pending = getSpectraRunTabs({ limit: ISLAND_TABS, since: islandWindowStart(), force })
    .then((result) => {
      if (generation < appliedRefreshGeneration) return;
      appliedRefreshGeneration = generation;
      sharedTabs = result.runTabs;
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
export function useRunTabs({ enabled = true, demand }: { enabled?: boolean; demand?: string | null } = {}) {
  const [tabs, setTabs] = useState(sharedTabs);
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribeRunTabs(setTabs);
    void refreshRunTabs();
    const removeThreads = spectraBus.on("threads.changed", () => void refreshRunTabs(true));
    const removeRun = spectraBus.on("run.changed", () => void refreshRunTabs());
    return () => {
      unsubscribe();
      removeThreads();
      removeRun();
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
