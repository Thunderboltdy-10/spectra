// Observation bookkeeping must not make unchanged content look like progress.
// Source revisions and coverage stay significant. Keys inside actual
// user content are data, even when they happen to have one of these names.
const observationFields = new Set([
  "readSnapshot", "telemetry", "observedAt", "retrievedAt", "refreshedAt",
  "generatedAt", "fetchedAt", "checkedAt", "refreshCount",
]);
const contentFields = new Set(["content", "contentPatch", "blocks", "cells"]);
const progressTimestamps = new Set(["updatedAt", "lastUpdatedAt", "lastSyncAt", "lastSynchronizedAt"]);
const revisionFields = new Set([
  "revision", "sourceRevision", "versionId", "currentVersionId", "contentHash",
  "liveStateVectorHash", "updatedAt", "lastUpdatedAt",
]);

export function stableReadObservation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableReadObservation);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !observationFields.has(key) && !progressTimestamps.has(key))
    .map(([key, item]) => [key, contentFields.has(key) ? item : stableReadObservation(item)]));
}

export type ReadSnapshot = {
  toolCallId: string;
  observedAt: number;
  revisions: Record<string, string | number>;
  revisionsTruncated: boolean;
};

export function readSnapshot(value: unknown, toolCallId: string): ReadSnapshot {
  const revisions: ReadSnapshot["revisions"] = {};
  let revisionsTruncated = false;
  const visit = (item: unknown, path: string, depth: number) => {
    if (!item || typeof item !== "object" || depth > 7) return;
    for (const [key, entry] of Object.entries(item)) {
      if (contentFields.has(key) || observationFields.has(key)) continue;
      const entryPath = path ? `${path}.${key}` : key;
      if (revisionFields.has(key) && (typeof entry === "string" || typeof entry === "number")) {
        if (Object.keys(revisions).length < 32) revisions[entryPath] = entry;
        else revisionsTruncated = true;
      } else visit(entry, entryPath, depth + 1);
    }
  };
  visit(value, "", 0);
  return { toolCallId, observedAt: Date.now(), revisions, revisionsTruncated };
}
