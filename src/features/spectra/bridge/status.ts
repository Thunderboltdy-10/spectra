import { formatElapsedSince } from "../../../../shared/human-format";

export type ReplicaState = "current" | "ahead" | "behind" | "diverged" | "pending" | "error" | "unavailable";
export type ReplicaTruth = {
  kind: "cloud" | "local";
  state: ReplicaState;
  lastVerifiedAt?: number;
  errorCode?: string;
  unavailableReason?: string;
};

export type SyncTruthInput = {
  replicas: readonly ReplicaTruth[];
  openConflictCount: number;
  pendingCount: number;
  queuedChangeCount?: number;
  online?: boolean;
};

export type SyncTruth = {
  key: "saved" | "saved-locally" | "synced" | "saving" | "syncing" | "offline" | "conflict" | "unavailable" | "error";
  label: string;
  detail: string;
  tone: "neutral" | "positive" | "warning" | "danger";
};

export function selectSyncTruth(input: SyncTruthInput): SyncTruth {
  const { replicas, openConflictCount, pendingCount } = input;
  if (openConflictCount > 0 || replicas.some((replica) => replica.state === "diverged")) return { key: "conflict", label: openConflictCount > 0 ? `${openConflictCount} conflict${openConflictCount === 1 ? "" : "s"}` : "Edit conflict", detail: "Replicas changed incompatibly. Nothing was overwritten.", tone: "danger" };
  const error = replicas.find((replica) => replica.state === "error");
  if (error) return { key: "error", label: "Could not synchronize", detail: error.errorCode ? `Synchronization stopped: ${error.errorCode}.` : "Synchronization stopped with an error.", tone: "danger" };
  if (pendingCount > 0 || replicas.some((replica) => replica.state === "pending")) return { key: replicas.length > 1 ? "syncing" : "saving", label: replicas.length > 1 ? "Syncing…" : "Saving…", detail: "A verified operation is still in progress.", tone: "neutral" };
  if (input.online === false && (input.queuedChangeCount ?? 0) > 0) return { key: "offline", label: `Offline · ${input.queuedChangeCount} change${input.queuedChangeCount === 1 ? "" : "s"}`, detail: "Changes are queued until this device reconnects.", tone: "warning" };
  const available = replicas.filter((replica) => replica.state !== "unavailable");
  if (!available.length && replicas.length) return { key: "unavailable", label: "Unavailable on this device", detail: replicas[0]?.unavailableReason ?? "The device or selected folder is not available.", tone: "warning" };
  const current = available.filter((replica) => replica.state === "current");
  if (current.length === available.length && current.length > 1) return { key: "synced", label: "Synced", detail: "Every replica agrees at a verified revision.", tone: "positive" };
  if (current.length === 1 && current[0]?.kind === "local") return { key: "saved-locally", label: "Saved locally", detail: "The bytes were read back and verified on this device.", tone: "positive" };
  return { key: "saved", label: "Saved", detail: current.length ? "The cloud revision is verified." : "No replica has reported a verified revision yet.", tone: current.length ? "positive" : "neutral" };
}
export function replicaDisclosure(replicas: readonly ReplicaTruth[], now = Date.now()) {
  return replicas.map((replica) => {
    const location = replica.kind === "local" ? "This device" : "Spectra Cloud";
    const state = replica.state[0]!.toUpperCase() + replica.state.slice(1);
    if (replica.lastVerifiedAt === undefined)
      return `${location} · ${state} · Not yet verified`;
    return `${location} · ${state} · Last verified ${formatElapsedSince(replica.lastVerifiedAt, now)}`;
  });
}
