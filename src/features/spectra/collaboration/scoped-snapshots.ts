import { stateIsVisible } from "./interaction-model";
import type {
  CollaborationPresence,
  CollaborationSyncSnapshot,
  CollaborationTransportSnapshot,
  PresencePreviewSnapshot,
} from "./types";

export type { CollaborationSyncSnapshot, PresencePreviewSnapshot };

export const EMPTY_PRESENCE: CollaborationPresence[] = [];

export const EMPTY_SYNC_SNAPSHOT: CollaborationSyncSnapshot = {
  state: "closed",
  level: null,
  unsynchronizedChanges: 0,
};

export const EMPTY_PREVIEW_SNAPSHOT: PresencePreviewSnapshot = {
  signature: "",
  aiCollaborator: null,
  patches: [],
  people: EMPTY_PRESENCE,
};

export const EMPTY_TRANSPORT_SNAPSHOT: CollaborationTransportSnapshot = {
  state: "closed",
  level: null,
  unsynchronizedChanges: 0,
  presence: EMPTY_PRESENCE,
};

function syncEqual(
  left: CollaborationSyncSnapshot,
  right: CollaborationSyncSnapshot,
) {
  return (
    left.state === right.state &&
    left.level === right.level &&
    left.accountId === right.accountId &&
    left.displayName === right.displayName &&
    left.unsynchronizedChanges === right.unsynchronizedChanges &&
    left.error === right.error
    && left.recoveryConflict === right.recoveryConflict
  );
}

export function presencePreviewSignature(
  presence: readonly CollaborationPresence[],
) {
  return presence
    .map((person) => {
      const patches =
        person.interactionState?.speculation?.patches ??
        person.previewPatches ??
        [];
      return [
        person.clientId,
        person.actorKind ?? "",
        person.previewPhase ?? "",
        person.previewSequence ?? "",
        person.interactionState?.actor.kind ?? "",
        person.interactionState?.lifecycle ?? "",
        person.interactionState?.act.kind ?? "",
        person.interactionState?.target?.path ?? "",
        person.interactionState?.speculation?.sequence ?? "",
        patches.length,
        patches
          .map(
            (patch) =>
              `${patch.path}:${typeof patch.value === "string" ? patch.value.length : typeof patch.value}`,
          )
          .join(","),
      ].join("~");
    })
    .join("|");
}

function derivePreview(
  presence: readonly CollaborationPresence[],
): PresencePreviewSnapshot {
  const aiCollaborators = presence.filter(
    (person) =>
      person.actorKind === "ai" ||
      person.interactionState?.actor.kind === "ai",
  );
  const aiCollaborator =
    aiCollaborators.find(
      (person) =>
        person.interactionState && stateIsVisible(person.interactionState),
    ) ??
    aiCollaborators.find((person) => person.previewPhase === "streaming") ??
    aiCollaborators.find((person) => (person.previewPatches?.length ?? 0) > 0) ??
    null;
  const patches = aiCollaborator?.interactionState?.speculation?.patches?.length
    ? aiCollaborator.interactionState.speculation.patches
    : (aiCollaborator?.previewPatches ?? []);
  return {
    signature: presencePreviewSignature(presence),
    aiCollaborator,
    patches,
    people: presence.length ? [...presence] : EMPTY_PRESENCE,
  };
}

function emit(listeners: Set<() => void>) {
  for (const listener of listeners) listener();
}

/**
 * One transport, three snapshot identities. Cursor frames notify presence
 * subscribers only; connection/durability notifies sync subscribers; AI
 * streaming patches are a derived identity so the studio body does not render
 * on peer pointermove.
 */
export class ScopedCollaborationSnapshots {
  private readonly syncListeners = new Set<() => void>();
  private readonly presenceListeners = new Set<() => void>();
  private readonly previewListeners = new Set<() => void>();
  private readonly combinedListeners = new Set<() => void>();
  private sync: CollaborationSyncSnapshot;
  private presence: CollaborationPresence[] = EMPTY_PRESENCE;
  private presencePreview: PresencePreviewSnapshot = EMPTY_PREVIEW_SNAPSHOT;
  private combined: CollaborationTransportSnapshot;

  constructor(initial?: Partial<CollaborationSyncSnapshot>) {
    this.sync = {
      state: initial?.state ?? "connecting",
      level: initial?.level ?? null,
      unsynchronizedChanges: initial?.unsynchronizedChanges ?? 0,
      ...(initial?.accountId ? { accountId: initial.accountId } : {}),
      ...(initial?.displayName ? { displayName: initial.displayName } : {}),
      ...(initial?.error ? { error: initial.error } : {}),
    };
    this.combined = this.buildCombined();
  }

  getSyncSnapshot = (): CollaborationSyncSnapshot => this.sync;
  getPresenceSnapshot = (): CollaborationPresence[] => this.presence;
  getPresencePreviewSnapshot = (): PresencePreviewSnapshot =>
    this.presencePreview;
  getSnapshot = (): CollaborationTransportSnapshot => this.combined;

  subscribeSync = (listener: () => void) => {
    this.syncListeners.add(listener);
    return () => {
      this.syncListeners.delete(listener);
    };
  };

  subscribePresence = (listener: () => void) => {
    this.presenceListeners.add(listener);
    return () => {
      this.presenceListeners.delete(listener);
    };
  };

  subscribePresencePreview = (listener: () => void) => {
    this.previewListeners.add(listener);
    return () => {
      this.previewListeners.delete(listener);
    };
  };

  subscribe = (listener: () => void) => {
    this.combinedListeners.add(listener);
    return () => {
      this.combinedListeners.delete(listener);
    };
  };

  clear() {
    this.syncListeners.clear();
    this.presenceListeners.clear();
    this.previewListeners.clear();
    this.combinedListeners.clear();
  }

  apply(patch: Partial<CollaborationTransportSnapshot>) {
    const nextSync: CollaborationSyncSnapshot = {
      recoveryConflict: patch.recoveryConflict ?? this.sync.recoveryConflict,
      state: patch.state ?? this.sync.state,
      level: patch.level !== undefined ? patch.level : this.sync.level,
      unsynchronizedChanges:
        patch.unsynchronizedChanges !== undefined
          ? patch.unsynchronizedChanges
          : this.sync.unsynchronizedChanges,
      ...(patch.accountId !== undefined
        ? patch.accountId
          ? { accountId: patch.accountId }
          : {}
        : this.sync.accountId
          ? { accountId: this.sync.accountId }
          : {}),
      ...(patch.displayName !== undefined
        ? patch.displayName
          ? { displayName: patch.displayName }
          : {}
        : this.sync.displayName
          ? { displayName: this.sync.displayName }
          : {}),
      ...(patch.error !== undefined
        ? patch.error
          ? { error: patch.error }
          : {}
        : this.sync.error
          ? { error: this.sync.error }
          : {}),
    };
    const syncChanged = !syncEqual(this.sync, nextSync);
    if (syncChanged) this.sync = nextSync;

    let presenceChanged = false;
    let previewChanged = false;
    if (patch.presence) {
      const nextPresence = patch.presence.length
        ? patch.presence
        : EMPTY_PRESENCE;
      if (nextPresence !== this.presence) {
        this.presence = nextPresence;
        presenceChanged = true;
        const preview = derivePreview(this.presence);
        if (preview.signature !== this.presencePreview.signature) {
          this.presencePreview = preview;
          previewChanged = true;
        }
      }
    }

    if (!syncChanged && !presenceChanged) return;
    this.combined = this.buildCombined();
    if (syncChanged) emit(this.syncListeners);
    if (presenceChanged) emit(this.presenceListeners);
    if (previewChanged) emit(this.previewListeners);
    emit(this.combinedListeners);
  }

  private buildCombined(): CollaborationTransportSnapshot {
    return {
      state: this.sync.state,
      level: this.sync.level,
      unsynchronizedChanges: this.sync.unsynchronizedChanges,
      presence: this.presence,
      ...(this.sync.accountId ? { accountId: this.sync.accountId } : {}),
      ...(this.sync.displayName ? { displayName: this.sync.displayName } : {}),
      ...(this.sync.error ? { error: this.sync.error } : {}),
    };
  }
}
