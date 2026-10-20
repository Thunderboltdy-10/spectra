import { formatElapsedSince } from "../../../../shared/human-format";
import {
  humanizePublicFailure,
  humanizeReplicaState,
  humanizeUnavailableReason,
  isMachineToken,
} from "./humanize";
import { PROTECTED_ORIGINAL_TOGGLE } from "./sync-toggles";
import { collaborationNeedsSignIn } from "../collaboration/auth-session";

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
  retryAt?: number;
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
  action?: {
    label: string;
    kind: "retry" | "reconnect" | "review-conflict" | "sign-in";
  };
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
  nativeBridgeAvailable?: boolean;
  readOnly?: boolean;
  protectedOriginal?: boolean;
  collaborative?: boolean;
  transportError?: string;
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
      label: "Couldn't sync",
      detail: error.errorCode
        ? humanizePublicFailure(error.errorCode)
        : "Syncing stopped. Try again, or keep working here.",
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
  const queuedChangeCount = input.queuedChangeCount ?? 0;
  if (
    pendingCount > 0 ||
    queuedChangeCount > 0 ||
    replicas.some((replica) => replica.state === "pending")
  ) {
    const retryingReplica = replicas.find(
      (replica) =>
        replica.state === "pending" &&
        replica.retryAt !== undefined &&
        replica.errorCode,
    );
    return {
      key: replicas.length > 1 ? "syncing" : "saving",
      label: replicas.length > 1 ? "Syncing…" : "Saving…",
      detail: retryingReplica && replicaIsPaused(retryingReplica)
        ? humanizePublicFailure(retryingReplica.errorCode!)
        : retryingReplica
        ? `${humanizePublicFailure(retryingReplica.errorCode!)}. Spectra will retry automatically.`
        : queuedChangeCount > 0 && pendingCount === 0
          ? `${queuedChangeCount} change${queuedChangeCount === 1 ? " is" : "s are"} waiting to sync.`
          : "Saving your latest changes.",
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
      detail: "Up to date everywhere.",
      tone: "positive",
    };
  }
  if (current.length === 1 && current[0]?.kind === "local") {
    return {
      key: "saved-locally",
      label: "Saved locally",
      detail: "Saved on this device.",
      tone: "positive",
    };
  }
  return {
    key: "saved",
    label: "Saved",
    detail: current.length
      ? "Saved to Spectra."
      : "Not saved anywhere yet.",
    tone: current.length ? "positive" : "neutral",
  };
}

export function replicaHasNativeLock(replica: ReplicaTruth): boolean {
  return Boolean(replica.errorCode && /office-locked/i.test(replica.errorCode));
}

/** The copy waits because its folder is paused on that computer. */
export function replicaIsPaused(replica: ReplicaTruth): boolean {
  return Boolean(replica.errorCode && /folder-paused/i.test(replica.errorCode));
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
      return `${location} · Waiting for Office to finish saving`;
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
    if (replica.state === "pending" && replicaIsPaused(replica))
      return `${location} · Paused on this computer`;
    if (replica.state === "pending" && replica.retryAt !== undefined && replica.errorCode)
      return `${location} · Retrying ${humanizePublicFailure(replica.errorCode)}`;
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

export function presentSync(input: PresentSyncInput): SyncPresentation {
  if (input.readOnly) {
    return {
      key: "read-only",
      state: "read_only",
      label: "Read-only",
      detail: input.protectedOriginal
        ? PROTECTED_ORIGINAL_TOGGLE.consequence
        : "You can look, but only people with edit access can change it.",
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
        "Checking your access. Keep editing; your changes are kept.",
      tone: "warning",
      ready: false,
    };
  }
  if (collaborationNeedsSignIn(input.transportError)) {
    return {
      key: "access",
      state: "offline",
      label: "Sign in to continue",
      detail:
        "Your session ended. This draft stays on this device until you sign in again.",
      tone: "warning",
      action: { label: "Sign in", kind: "sign-in" },
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
        label: "Waiting for Office",
        detail:
          "Office still has this file open. It saves here once Office is done.",
        tone: "warning",
        ready: false,
      };
    }
    if (input.nativeBridgeAvailable === false) {
      const queued = queuedCount(input) || activityPending(input);
      return {
        key: truth.key,
        state: "pending",
        label: queued > 0 ? "Queued" : "Not running",
        detail:
          queued > 0
            ? "This file is on your computer, which isn't connected right now. Your changes will sync when it is."
            : "This file is on your computer. Connect it from Devices to open it here.",
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
