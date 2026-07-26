"use client";

/**
 * AI change traces.
 *
 * When an AI operation completes, the interface must not simply forget it
 * happened — nor keep pulsing forever. A trace is a calm, precise, persistent
 * mark on the *exact* fields an AI changed, carrying who changed them, what the
 * previous value was, and the affordances to accept or revert.
 *
 * The rules encoded here are what keep traces trustworthy:
 *  - a trace is scoped to one semantic target, never to a parent container;
 *  - content stays fully editable while a trace is present;
 *  - a human edit to that exact target clears the trace automatically, because
 *    the human has now reviewed it by acting on it;
 *  - traces survive closing and reopening the artifact, so opening after a run
 *    completes still tells the story;
 *  - traces expire, so a stale mark cannot become permanent furniture.
 */

import { useEffect, useState } from "react";
import {
  canonicalPath,
  pathsIntersect,
  targetKey,
  type SemanticTarget,
} from "./interaction-model";

export type AiTrace = {
  id: string;
  target: SemanticTarget;
  runId: string;
  operationId?: string;
  /** Display label, always owner-attributed: "Nadia M.'s AI". */
  actorLabel: string;
  ownerAccountId?: string;
  /** Value before the AI touched it, for one-click revert. */
  previousValue: unknown;
  /** Value the AI wrote, so a later divergence can be detected. */
  nextValue: unknown;
  /** Short description of the change, e.g. "Rewrote Summary". */
  summary: string;
  changedAt: number;
  /** History version that restores the pre-AI state. */
  restoreVersionId?: string;
  /** `fresh` traces animate in once; `reviewed` are quiet marks. */
  status: "fresh" | "reviewed";
};

/** Traces older than this are dropped, so marks never become permanent. */
export const TRACE_TTL_MS = 1000 * 60 * 60 * 24;
/** Bounded so a large multi-region run cannot flood an editor with marks. */
export const MAX_TRACES_PER_ARTIFACT = 200;

type ArtifactTraces = Map<string, AiTrace>;

const store = new Map<string, ArtifactTraces>();
const listeners = new Map<string, Set<() => void>>();

function storageKey(artifactId: string): string {
  return `spectra.ai-traces.${artifactId}`;
}

function readPersisted(artifactId: string): AiTrace[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(artifactId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTrace);
  } catch {
    return [];
  }
}

function isTrace(value: unknown): value is AiTrace {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.runId === "string" &&
    typeof record.actorLabel === "string" &&
    typeof record.changedAt === "number" &&
    Boolean(record.target) &&
    typeof (record.target as Record<string, unknown>).path === "string"
  );
}

function persist(artifactId: string, traces: ArtifactTraces): void {
  if (typeof window === "undefined") return;
  try {
    const values = [...traces.values()];
    if (!values.length) {
      window.localStorage.removeItem(storageKey(artifactId));
      return;
    }
    window.localStorage.setItem(storageKey(artifactId), JSON.stringify(values));
  } catch {
    // A full or unavailable storage must never break the editor; traces simply
    // become session-scoped.
  }
}

function bucket(artifactId: string): ArtifactTraces {
  let traces = store.get(artifactId);
  if (!traces) {
    traces = new Map();
    for (const trace of readPersisted(artifactId)) {
      if (Date.now() - trace.changedAt > TRACE_TTL_MS) continue;
      traces.set(traceKeyOf(trace), trace);
    }
    store.set(artifactId, traces);
  }
  return traces;
}

/**
 * Traces are keyed by target, so a second AI edit to the same field replaces the
 * first mark instead of stacking two marks on one control.
 */
function traceKeyOf(trace: AiTrace): string {
  return targetKey(trace.target);
}

function notify(artifactId: string): void {
  for (const listener of listeners.get(artifactId) ?? []) listener();
}

function prune(traces: ArtifactTraces): boolean {
  const now = Date.now();
  let changed = false;
  for (const [key, trace] of traces) {
    if (now - trace.changedAt > TRACE_TTL_MS) {
      traces.delete(key);
      changed = true;
    }
  }
  if (traces.size > MAX_TRACES_PER_ARTIFACT) {
    const ordered = [...traces.entries()].sort(
      (left, right) => left[1].changedAt - right[1].changedAt,
    );
    for (const [key] of ordered.slice(0, traces.size - MAX_TRACES_PER_ARTIFACT)) {
      traces.delete(key);
      changed = true;
    }
  }
  return changed;
}

export type RecordTraceInput = Omit<AiTrace, "id" | "changedAt" | "status"> & {
  changedAt?: number;
};

/** Record a completed AI change. Called once the change is durable, never during streaming. */
export function recordAiTrace(input: RecordTraceInput): AiTrace | null {
  const artifactId = input.target.artifactId;
  if (!artifactId) return null;
  // A change that did not change anything must not leave a mark.
  if (Object.is(input.previousValue, input.nextValue)) return null;

  const traces = bucket(artifactId);
  const key = targetKey(input.target);
  const existing = traces.get(key);
  const trace: AiTrace = {
    ...input,
    target: { ...input.target, path: canonicalPath(input.target.path) },
    // Chaining edits keeps the *original* pre-AI value so revert goes all the
    // way back rather than to an intermediate AI state.
    previousValue: existing ? existing.previousValue : input.previousValue,
    id: existing?.id ?? `${input.runId}:${key}`,
    changedAt: input.changedAt ?? Date.now(),
    status: "fresh",
  };
  traces.set(key, trace);
  prune(traces);
  persist(artifactId, traces);
  notify(artifactId);
  return trace;
}

/** Hydrate traces from a server snapshot, e.g. when opening an artifact after a run. */
export function hydrateAiTraces(
  artifactId: string,
  incoming: readonly AiTrace[],
): void {
  const traces = bucket(artifactId);
  let changed = false;
  for (const trace of incoming) {
    if (Date.now() - trace.changedAt > TRACE_TTL_MS) continue;
    const key = traceKeyOf(trace);
    const existing = traces.get(key);
    if (existing && existing.changedAt >= trace.changedAt) continue;
    traces.set(key, trace);
    changed = true;
  }
  if (prune(traces)) changed = true;
  if (changed) {
    persist(artifactId, traces);
    notify(artifactId);
  }
}

export function listAiTraces(artifactId: string): AiTrace[] {
  const traces = bucket(artifactId);
  if (prune(traces)) {
    persist(artifactId, traces);
  }
  return [...traces.values()].sort((left, right) => right.changedAt - left.changedAt);
}

/** All traces whose target intersects a path — the test the editor uses per control. */
export function tracesAtPath(artifactId: string, path: string): AiTrace[] {
  const canonical = canonicalPath(path);
  return listAiTraces(artifactId).filter((trace) =>
    pathsIntersect(trace.target.path, canonical),
  );
}

/** Mark a trace as seen so it stops animating but remains legible. */
export function reviewAiTrace(artifactId: string, traceId: string): void {
  const traces = bucket(artifactId);
  for (const [key, trace] of traces) {
    if (trace.id !== traceId) continue;
    if (trace.status === "reviewed") return;
    traces.set(key, { ...trace, status: "reviewed" });
    persist(artifactId, traces);
    notify(artifactId);
    return;
  }
}

/** Accept a change: the mark is removed and the AI value stands. */
export function dismissAiTrace(artifactId: string, traceId: string): void {
  const traces = bucket(artifactId);
  for (const [key, trace] of traces) {
    if (trace.id !== traceId) continue;
    traces.delete(key);
    persist(artifactId, traces);
    notify(artifactId);
    return;
  }
}

export function dismissTracesForRun(artifactId: string, runId: string): void {
  const traces = bucket(artifactId);
  let changed = false;
  for (const [key, trace] of traces) {
    if (trace.runId !== runId) continue;
    traces.delete(key);
    changed = true;
  }
  if (changed) {
    persist(artifactId, traces);
    notify(artifactId);
  }
}

export function clearAiTraces(artifactId: string): void {
  const traces = bucket(artifactId);
  if (!traces.size) return;
  traces.clear();
  persist(artifactId, traces);
  notify(artifactId);
}

/**
 * A human edited a control. Any trace on that exact control — or on a descendant
 * of it — is cleared, because acting on the content is the most complete form of
 * reviewing it. Traces on *sibling* controls are untouched.
 */
export function noteHumanEdit(artifactId: string, path: string): void {
  const traces = bucket(artifactId);
  const canonical = canonicalPath(path);
  let changed = false;
  for (const [key, trace] of traces) {
    if (!pathsIntersect(trace.target.path, canonical)) continue;
    traces.delete(key);
    changed = true;
  }
  if (changed) {
    persist(artifactId, traces);
    notify(artifactId);
  }
}

export function subscribeAiTraces(
  artifactId: string,
  listener: () => void,
): () => void {
  let set = listeners.get(artifactId);
  if (!set) {
    set = new Set();
    listeners.set(artifactId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (!set!.size) listeners.delete(artifactId);
  };
}

/** React binding. Returns a stable-sorted trace list that re-renders on change. */
export function useAiTraces(artifactId: string | null | undefined): AiTrace[] {
  const [traces, setTraces] = useState<AiTrace[]>(() =>
    artifactId ? listAiTraces(artifactId) : [],
  );
  useEffect(() => {
    if (!artifactId) {
      setTraces([]);
      return;
    }
    setTraces(listAiTraces(artifactId));
    return subscribeAiTraces(artifactId, () => {
      setTraces(listAiTraces(artifactId));
    });
  }, [artifactId]);
  return traces;
}

/** Index traces by canonical path for O(1) lookup while rendering many controls. */
export function indexTracesByPath(
  traces: readonly AiTrace[],
): Map<string, AiTrace> {
  const index = new Map<string, AiTrace>();
  for (const trace of traces) {
    const existing = index.get(trace.target.path);
    if (!existing || existing.changedAt < trace.changedAt)
      index.set(trace.target.path, trace);
  }
  return index;
}

/** Test-only reset. */
export function __resetAiTraces(): void {
  store.clear();
  listeners.clear();
  if (typeof window !== "undefined") {
    try {
      const keys: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith("spectra.ai-traces.")) keys.push(key);
      }
      for (const key of keys) window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}
