import { isDurableContentRef } from "./durable-content";

export const BRIDGE_CLAIM_REDRIVE_MS = 2 * 60_000;
export const BRIDGE_WRITE_EXPIRES_MS = 30 * 60_000;
export const STRATEGY_TRANSITION_EXPIRES_MS = 30 * 60_000;
/** F6 without an in-flight write must not lock the radios for the 30-minute write window. */
export const STRATEGY_TRANSITION_STALL_MS = 2 * 60_000;
export const PAYLOAD_RELEASE_GRACE_MS = 24 * 60 * 60_000;

export type SyncIntentDirection =
  | "cloud-to-local"
  | "local-to-cloud"
  | "external"
  | "migration";

export type SyncIntent = {
  workId: string;
  target: string;
  baseRevision: string;
  targetRevision: string;
  direction: SyncIntentDirection;
};

function framed(value: string) {
  return `${value.length}:${value}`;
}

async function deriveKey(prefix: string, parts: readonly string[]) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(parts.map(framed).join("|")),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${prefix}_${hash}`;
}

export function canonicalSyncIntent(intent: SyncIntent) {
  return [
    "spectra-sync-v1",
    intent.direction,
    intent.workId,
    intent.target,
    intent.baseRevision,
    intent.targetRevision,
  ]
    .map(framed)
    .join("|");
}

export async function deriveSyncIdempotencyKey(intent: SyncIntent) {
  return deriveKey("sync", [canonicalSyncIntent(intent)]);
}

export function deriveStorageTransitionIdempotencyKey(intent: {
  workId: string;
  fromPreset: string;
  toPreset: string;
  target: string;
}) {
  return deriveKey("strategy", [
    "spectra-storage-transition-v1",
    intent.workId,
    intent.fromPreset,
    intent.toPreset,
    intent.target,
  ]);
}

export async function deriveProjectionSnapshotHash(value: unknown) {
  if (isDurableContentRef(value) && value.spectraContentRef.path === "value")
    return value.spectraContentRef.digest;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Mechanical compensation contract for every non-terminal truth-machine state.
 * This is executable product specification: focused tests assert that every
 * state names both ordinary exits and the indexed maintenance path that owns
 * actor-death recovery.
 */
export const REPLICA_COMPENSATION_TABLE = [
  {
    state: "bridgeWriteRequests.pending",
    entry: "A verified payload and an active local target are queued.",
    verifiedExits: ["claimed", "verified"],
    failureExits: ["failed", "conflicted"],
    sweeper: "replicas.sweepReplicaTruth",
  },
  {
    state: "bridgeWriteRequests.claimed",
    entry: "One Bridge has claimed the write request.",
    verifiedExits: ["verified"],
    failureExits: ["pending", "failed", "conflicted"],
    sweeper: "replicas.sweepReplicaTruth",
  },
  {
    state: "workReplicas.pending",
    entry: "A matching write or filesystem request is active.",
    verifiedExits: ["current"],
    failureExits: ["diverged", "error", "unavailable"],
    sweeper: "replicas.sweepReplicaTruth",
  },
  {
    state: "storageStrategyTransitions.pending",
    entry: "The target policy is staged while required bytes are verified.",
    verifiedExits: ["verified"],
    failureExits: ["failed"],
    sweeper: "replicas.sweepReplicaTruth",
  },
  {
    state: "syncOperations.pending",
    entry: "A matching active write request exists.",
    verifiedExits: ["applied", "verified"],
    failureExits: ["failed", "conflicted"],
    sweeper: "replicas.sweepReplicaTruth",
  },
  {
    state: "syncConflicts.resolving-spectra",
    entry: "A specific conflict is bound to a specific byte-write request.",
    verifiedExits: ["resolved-spectra"],
    failureExits: ["open", "abandoned"],
    sweeper: "replicas.sweepReplicaTruth",
  },
  {
    state: "syncConflicts.open",
    entry: "Both revisions and the affected regions are durably named.",
    verifiedExits: ["resolved-local", "resolved-spectra", "resolved-merged", "forked"],
    failureExits: ["abandoned"],
    sweeper: "replicas.sweepReplicaTruth",
  },
  {
    state: "payloadObjects.active-unreferenced",
    entry: "An upload completed but no live replica or request references it yet.",
    verifiedExits: ["active-referenced"],
    failureExits: ["released"],
    sweeper: "replicas.sweepReplicaTruth",
  },
] as const;
