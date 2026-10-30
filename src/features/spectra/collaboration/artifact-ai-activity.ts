"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { InteractionActKind } from "./interaction-model";

/**
 * What a card, workspace row or compact surface should say about live AI work.
 *
 * `label` and `detail` come from the same semantic frame the editor renders, so
 * a card describes the actual operation — "adding a slide", "moving Biology" —
 * instead of showing one generic pulse for everything.
 */
export type ArtifactAiActivity = {
  phase: "preparing" | "editing";
  sequence?: number;
  /** Owner-attributed actor name, e.g. "Maya's AI". */
  label?: string;
  /** Short description of the act and its target. */
  detail?: string;
  /** Act kind, for surfaces that pick an icon or motion per operation. */
  kind?: InteractionActKind;
};

const activityByArtifact = new Map<string, Map<string, ArtifactAiActivity>>();
const listeners = new Set<() => void>();

function emit() {
  /* Every cached snapshot is now suspect. Clearing rather than recomputing
     keeps this O(1) on publish; the hooks that still care will re-derive on
     their next render. */
  resolved.clear();
  listeners.forEach((listener) => listener());
}

export function publishArtifactAiActivity(
  artifactId: string,
  sourceId: string,
  activity: ArtifactAiActivity | null,
) {
  const sources = activityByArtifact.get(artifactId) ?? new Map();
  if (activity) {
    sources.set(sourceId, activity);
    activityByArtifact.set(artifactId, sources);
  } else {
    sources.delete(sourceId);
    if (sources.size === 0) activityByArtifact.delete(artifactId);
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The resolved activity per artifact, cached until something publishes.
 *
 * `useSyncExternalStore` calls its snapshot during render and compares the
 * result by identity: deriving a fresh object each call means React sees an
 * endless stream of new values and re-renders until it gives up with "Maximum
 * update depth exceeded". So resolution happens once per change, here, and the
 * hook returns the same reference until the store actually moves.
 */
const resolved = new Map<string, ArtifactAiActivity | null>();

function resolve(artifactId: string): ArtifactAiActivity | null {
  const sources = activityByArtifact.get(artifactId);
  if (!sources?.size) return null;
  const all = [...sources.values()];
  /* A source that can name the actor (the open studio's semantic frame)
     always wins over a coarser feed that only knows the operation. */
  for (let index = all.length - 1; index >= 0; index -= 1) {
    if (all[index]!.label) return all[index]!;
  }
  return all.at(-1) ?? null;
}

function snapshotFor(artifactId: string): ArtifactAiActivity | null {
  if (!resolved.has(artifactId)) {
    resolved.set(artifactId, resolve(artifactId));
  }
  return resolved.get(artifactId) ?? null;
}

export function useArtifactAiActivity(artifactId: string) {
  const getSnapshot = useCallback(() => snapshotFor(artifactId), [artifactId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/** Cards keep their last finished preview until all writers have let go. */
export function useBusyArtifacts(artifactIds: readonly string[]) {
  const ids = artifactIds.join("|");
  const getSnapshot = useCallback(
    () => ids.split("|").filter((id) => activityByArtifact.has(id)).join("|"),
    [ids],
  );
  const busy = useSyncExternalStore(subscribe, getSnapshot, () => "");
  return useMemo(() => new Set(busy ? busy.split("|") : []), [busy]);
}
