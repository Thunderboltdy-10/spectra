"use client";

import { useSyncExternalStore } from "react";

export type ArtifactAiActivity = {
  phase: "preparing" | "editing";
  sequence?: number;
};

const activityByArtifact = new Map<string, Map<string, ArtifactAiActivity>>();
const listeners = new Set<() => void>();

function emit() {
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

export function useArtifactAiActivity(artifactId: string) {
  return useSyncExternalStore(
    subscribe,
    () => {
      const sources = activityByArtifact.get(artifactId);
      if (!sources?.size) return null;
      return [...sources.values()].at(-1) ?? null;
    },
    () => null,
  );
}
