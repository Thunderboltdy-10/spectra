import { formatElapsedSince } from "../../../../shared/human-format";
import {
  humanizePublicFailure,
  humanizeReplicaState,
  humanizeUnavailableReason,
  isMachineToken,
} from "./humanize";

export type ReplicaState =
  | "current"
  | "ahead"
  | "behind"
  | "diverged"
  | "pending"
  | "error"
  | "unavailable";
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
  key:
    | "saved"
    | "saved-locally"
    | "synced"
    | "saving"
    | "syncing"
    | "offline"
    | "conflict"
    | "unavailable"
    | "error";
  label: string;
  detail: string;
  tone: "neutral" | "positive" | "warning" | "danger";
};

export type TransportPresentationState =
  | "connecting"
  | "synchronizing"
  | "synchronized"
  | "reconnecting"
  | "unsynchronized"
  | "permission_lost"
  | "closed";

export type StudioPresentationState =
  | "live"
  | "saving"
  | "saved"
  | "pending"
  | "offline"
  | "read_only"
  | "error";

export type SyncPresentation = {
  key: SyncTruth["key"] | "read-only" | "live" | "access";
  state: StudioPresentationState;
  label: string;
  detail: string;
  tone: SyncTruth["tone"];
  action?: { label: string; kind: "retry" | "reconnect" | "review-conflict" };
  ready: boolean;
};

export type PresentSyncInput = {
  replicas: readonly ReplicaTruth[];
  openConflictCount: number;
  replicaPendingCount: number;
  queuedChangeCount?: number;
  online: boolean;
  transportState?: TransportPresentationState;
  dirty?: boolean;
  nativeActivity?: boolean;
  readOnly?: boolean;
  collaborative?: boolean;
};

export function selectSyncTruth(input: SyncTruthInput): SyncTruth {
  const { replicas, openConflictCount, pendingCount } = input;
  if (
    openConflictCount > 0 ||
    replicas.some((replica) => replica.state === "diverged")
  ) {
    return {
      key: "conflict",
      label:
        openConflictCount > 0
          ? `${openConflictCount} conflict${openConflictCount === 1 ? "" : "s"}`
          : "Edit conflict",
      detail: "Both copies changed. Nothing was overwritten.",
      tone: "danger",
    };
  }
  const error = replicas.find((replica) => replica.state === "error");
  if (error) {
    return {
      key: "error",
      label: "Could not synchronize",
      detail: error.errorCode
        ? humanizePublicFailure(error.errorCode)
        : "Synchronization stopped. Try again, or keep working here.",
      tone: "danger",
    };
  }
  if (input.online === false) {
    const queued =
      (input.queuedChangeCount ?? 0) ||
      (pendingCount > 0 || replicas.some((replica) => replica.state === "pending")
        ? Math.max(pendingCount, 1)
        : 0);
    return {
      key: "offline",
      label:
        queued > 0
          ? `Offline · ${queued} change${queued === 1 ? "" : "s"}`
          : "Offline",
      detail:
        queued > 0
          ? "Changes are queued until this device reconnects."
          : "This device is offline. You can keep editing; Spectra will send changes when you reconnect.",
      tone: "warning",
    };
  }
  if (
    pendingCount > 0 ||
    replicas.some((replica) => replica.state === "pending")
  ) {
    return {
      key: replicas.length > 1 ? "syncing" : "saving",
      label: replicas.length > 1 ? "Syncing…" : "Saving…",
      detail: "A verified operation is still in progress.",
      tone: "neutral",
    };
  }
  const available = replicas.filter((replica) => replica.state !== "unavailable");
  if (!available.length && replicas.length) {
    const reason = replicas[0]?.unavailableReason;
    return {
      key: "unavailable",
      label: "Unavailable on this device",
      detail: isMachineToken(reason)
        ? humanizeUnavailableReason(reason)
        : (reason ?? humanizeUnavailableReason(undefined)),
      tone: "warning",
    };
  }
  const current = available.filter((replica) => replica.state === "current");
  if (current.length === available.length && current.length > 1) {
    return {
      key: "synced",
      label: "Synced",
      detail: "Every copy agrees at a verified revision.",
      tone: "positive",
    };
  }
  if (current.length === 1 && current[0]?.kind === "local") {
    return {
      key: "saved-locally",
      label: "Saved locally",
      detail: "The bytes were read back and verified on this device.",
      tone: "positive",
    };
  }
  return {
    key: "saved",
    label: "Saved",
    detail: current.length
      ? "The cloud revision is verified."
      : "No copy has reported a verified revision yet.",
    tone: current.length ? "positive" : "neutral",
  };
}

export function replicaHasNativeLock(replica: ReplicaTruth): boolean {
  return Boolean(replica.errorCode && /office-locked/i.test(replica.errorCode));
}

export function replicaIsPresent(replica: ReplicaTruth): boolean {
  return replica.state !== "unavailable";
}

/** Location, chips, and the replica list must name the same places. */
export function locationLabel(replicas: readonly ReplicaTruth[]): string {
  const local = replicas.some(
    (replica) => replica.kind === "local" && replicaIsPresent(replica),
  );
  const cloud = replicas.some(
    (replica) => replica.kind === "cloud" && replicaIsPresent(replica),
  );
  if (local && cloud) return "This device + Spectra";
  if (local) return "This device";
  if (cloud) return "Spectra";
  return "Not available here";
}

export function replicaDisclosure(
  replicas: readonly ReplicaTruth[],
  now = Date.now(),
  activity?: { nativeLocked?: boolean; nativeActivity?: boolean },
) {
  return replicas.map((replica) => {
    const location = replica.kind === "local" ? "This device" : "Spectra";
    const locked =
      replicaHasNativeLock(replica) ||
      (replica.kind === "local" && Boolean(activity?.nativeLocked));
    if (locked) {
      return `${location} · Waiting for Word to finish saving`;
    }
    if (
      replica.kind === "local" &&
      replica.state === "current" &&
      activity?.nativeActivity
    ) {
      return `${location} · Saving`;
    }
    const state = humanizeReplicaState(replica.state);
    if (replica.state === "unavailable") return `${location} · ${state}`;
    if (replica.lastVerifiedAt === undefined)
      return `${location} · ${state} · Not yet verified`;
    return `${location} · ${state} · Last verified ${formatElapsedSince(replica.lastVerifiedAt, now)}`;
  });
}

function queuedCount(input: PresentSyncInput) {
  return (
    (input.queuedChangeCount ?? 0) +
    (input.dirty ? 1 : 0) +
    (input.nativeActivity ? 1 : 0)
  );
}

function activityPending(input: PresentSyncInput) {
  const transportBusy =
    input.transportState === "connecting" ||
    input.transportState === "synchronizing" ||
    input.transportState === "reconnecting" ||
    input.transportState === "unsynchronized";
  const nativeLocked = input.replicas.some(replicaHasNativeLock);
  return (
    input.replicaPendingCount +
    (input.dirty || input.nativeActivity || nativeLocked || transportBusy ? 1 : 0)
  );
}

export function isPresentationReady(key: SyncPresentation["key"]): boolean {
  return (
    key === "saved" ||
    key === "saved-locally" ||
    key === "synced" ||
    key === "live"
  );
}

/** Quiet labels stay off the header; every other state is spoken in place. */
export function headerSyncMessage(presentation: SyncPresentation): string | undefined {
  if (isPresentationReady(presentation.key) && presentation.key !== "live") {
    return undefined;
  }
  if (presentation.key === "live") return undefined;
  return presentation.label;
}

export function presentSync(input: PresentSyncInput): SyncPresentation {
  if (input.readOnly) {
    return {
      key: "read-only",
      state: "read_only",
      label: "Read-only",
      detail: "You can inspect this work, but only someone with edit access can change it.",
      tone: "neutral",
      ready: false,
    };
  }
  if (input.transportState === "permission_lost") {
    return {
      key: "access",
      state: "pending",
      label: "Refreshing access",
      detail:
        "Spectra is refreshing this work's access. You can keep editing your local draft.",
      tone: "warning",
      ready: false,
    };
  }

  const truth = selectSyncTruth({
    replicas: input.replicas,
    openConflictCount: input.openConflictCount,
    pendingCount: activityPending(input),
    queuedChangeCount: queuedCount(input),
    online: input.online,
  });

  if (truth.key === "conflict") {
    return {
      ...truth,
      state: "error",
      action: { label: "Review", kind: "review-conflict" },
      ready: false,
    };
  }
  if (truth.key === "error") {
    return {
      ...truth,
      state: "error",
      action: { label: "Try again", kind: "retry" },
      ready: false,
    };
  }
  if (truth.key === "unavailable") {
    return {
      ...truth,
      state: "offline",
      action: { label: "Reconnect", kind: "reconnect" },
      ready: false,
    };
  }
  if (truth.key === "offline") {
    return { ...truth, state: "offline", ready: false };
  }
  if (truth.key === "saving" || truth.key === "syncing") {
    const reconnecting =
      input.transportState === "reconnecting" ||
      input.transportState === "unsynchronized";
    if (reconnecting && !input.dirty && !input.nativeActivity) {
      return {
        key: truth.key,
        state: "offline",
        label: "Reconnecting",
        detail: "Connection interrupted. Your draft stays on this device.",
        tone: "warning",
        ready: false,
      };
    }
    if (input.replicas.some(replicaHasNativeLock)) {
      return {
        key: truth.key,
        state: "saving",
        label: "Waiting for Word",
        detail:
          "Word still has this file open. Spectra will verify it after Word finishes saving.",
        tone: "warning",
        ready: false,
      };
    }
    return {
      ...truth,
      state: truth.key === "syncing" ? "pending" : "saving",
      ready: false,
    };
  }

  if (
    input.collaborative &&
    (input.transportState === "synchronized" ||
      input.transportState === undefined) &&
    (truth.key === "saved" ||
      truth.key === "synced" ||
      truth.key === "saved-locally")
  ) {
    return {
      key: "live",
      state: "live",
      label: "Live",
      detail: truth.detail,
      tone: "positive",
      ready: true,
    };
  }

  return {
    ...truth,
    state: "saved",
    ready: isPresentationReady(truth.key),
  };
}
